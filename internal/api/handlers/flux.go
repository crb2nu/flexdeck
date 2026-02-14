package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
)

// FluxStatus represents the status of a Flux resource
type FluxStatus struct {
	Name        string          `json:"name"`
	Namespace   string          `json:"namespace"`
	Kind        string          `json:"kind"`
	Ready       bool            `json:"ready"`
	Message     string          `json:"message,omitempty"`
	LastApplied string          `json:"lastApplied,omitempty"`
	Suspended   bool            `json:"suspended"`
	SourceRef   *FluxSourceRef  `json:"sourceRef,omitempty"`
	Conditions  []FluxCondition `json:"conditions,omitempty"`
	DependsOn   []string        `json:"dependsOn,omitempty"`
}

// FluxSourceRef references the source of a Flux resource
type FluxSourceRef struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
}

// FluxCondition represents a Flux resource condition
type FluxCondition struct {
	Type               string `json:"type"`
	Status             string `json:"status"`
	Reason             string `json:"reason,omitempty"`
	Message            string `json:"message,omitempty"`
	LastTransitionTime string `json:"lastTransitionTime,omitempty"`
}

// FluxSource represents a Flux source resource (GitRepository, HelmRepository)
type FluxSource struct {
	Name        string          `json:"name"`
	Namespace   string          `json:"namespace"`
	Kind        string          `json:"kind"`
	URL         string          `json:"url,omitempty"`
	Branch      string          `json:"branch,omitempty"`
	Ready       bool            `json:"ready"`
	Revision    string          `json:"revision,omitempty"`
	LastFetched string          `json:"lastFetched,omitempty"`
	Conditions  []FluxCondition `json:"conditions,omitempty"`
}

// FluxReconcileRequest represents a reconcile request
type FluxReconcileRequest struct {
	WithSource bool `json:"withSource"`
}

// FluxSuspendRequest represents a suspend/resume request
type FluxSuspendRequest struct {
	Suspend bool `json:"suspend"`
}

// resolveFluxGVR maps a kind string to the corresponding GVR.
func resolveFluxGVR(kind string) (schema.GroupVersionResource, bool) {
	switch kind {
	case "kustomization", "ks":
		return schema.GroupVersionResource{
			Group: "kustomize.toolkit.fluxcd.io", Version: "v1", Resource: "kustomizations",
		}, true
	case "helmrelease", "hr":
		return schema.GroupVersionResource{
			Group: "helm.toolkit.fluxcd.io", Version: "v2", Resource: "helmreleases",
		}, true
	case "gitrepository", "gitrepo":
		return schema.GroupVersionResource{
			Group: "source.toolkit.fluxcd.io", Version: "v1", Resource: "gitrepositories",
		}, true
	case "helmrepository", "helmrepo":
		return schema.GroupVersionResource{
			Group: "source.toolkit.fluxcd.io", Version: "v1", Resource: "helmrepositories",
		}, true
	default:
		return schema.GroupVersionResource{}, false
	}
}

// FluxListKustomizations lists Flux Kustomization resources
func (h *Handler) FluxListKustomizations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	gvr, _ := resolveFluxGVR("kustomization")

	dynamicClient, err := dynamic.NewForConfig(h.k8s.Config())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	list, err := dynamicClient.Resource(gvr).Namespace("").List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	statuses := make([]FluxStatus, 0, len(list.Items))
	for _, item := range list.Items {
		status := extractFluxStatus(&item, "Kustomization")
		statuses = append(statuses, status)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(statuses)
}

// FluxListHelmReleases lists Flux HelmRelease resources
func (h *Handler) FluxListHelmReleases(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	gvr, _ := resolveFluxGVR("helmrelease")

	dynamicClient, err := dynamic.NewForConfig(h.k8s.Config())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	list, err := dynamicClient.Resource(gvr).Namespace("").List(ctx, metav1.ListOptions{})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	statuses := make([]FluxStatus, 0, len(list.Items))
	for _, item := range list.Items {
		status := extractFluxStatus(&item, "HelmRelease")
		statuses = append(statuses, status)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(statuses)
}

// FluxReconcile triggers reconciliation of a Flux resource
func (h *Handler) FluxReconcile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	kind := chi.URLParam(r, "kind")
	namespace := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	if kind == "" || namespace == "" || name == "" {
		http.Error(w, "missing kind, namespace, or name", http.StatusBadRequest)
		return
	}

	var req FluxReconcileRequest
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}

	// Determine GVR based on kind
	gvr, ok := resolveFluxGVR(kind)
	if !ok {
		http.Error(w, "unsupported kind: "+kind, http.StatusBadRequest)
		return
	}

	dynamicClient, err := dynamic.NewForConfig(h.k8s.Config())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Get the current resource
	resource, err := dynamicClient.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to get %s/%s: %v", namespace, name, err), http.StatusNotFound)
		return
	}

	// Set the reconcile annotation to trigger reconciliation
	annotations := resource.GetAnnotations()
	if annotations == nil {
		annotations = make(map[string]string)
	}
	annotations["reconcile.fluxcd.io/requestedAt"] = time.Now().Format(time.RFC3339)
	resource.SetAnnotations(annotations)

	// Update the resource
	_, err = dynamicClient.Resource(gvr).Namespace(namespace).Update(ctx, resource, metav1.UpdateOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to update %s/%s: %v", namespace, name, err), http.StatusInternalServerError)
		return
	}

	// If withSource, also reconcile the source
	if req.WithSource && (kind == "kustomization" || kind == "ks" || kind == "helmrelease" || kind == "hr") {
		go h.reconcileSource(context.Background(), dynamicClient, resource)
	}

	// Invalidate cached K8s data for the affected namespace
	if h.cache != nil {
		h.cache.InvalidatePattern(r.Context(), fmt.Sprintf("k8s:*:%s", namespace))
		h.cache.Invalidate(r.Context(), "topology:public")
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":      true,
		"message": fmt.Sprintf("Reconciliation triggered for %s/%s", namespace, name),
	})
}

func (h *Handler) reconcileSource(ctx context.Context, client dynamic.Interface, resource *unstructured.Unstructured) {
	// Extract source reference from the resource
	spec, _, _ := unstructured.NestedMap(resource.Object, "spec")
	if spec == nil {
		return
	}

	sourceRef, _, _ := unstructured.NestedMap(spec, "sourceRef")
	if sourceRef == nil {
		return
	}

	sourceKind, _, _ := unstructured.NestedString(sourceRef, "kind")
	sourceName, _, _ := unstructured.NestedString(sourceRef, "name")
	sourceNS, _, _ := unstructured.NestedString(sourceRef, "namespace")
	if sourceNS == "" {
		sourceNS = resource.GetNamespace()
	}

	if sourceKind == "" || sourceName == "" {
		return
	}

	var gvr schema.GroupVersionResource
	switch sourceKind {
	case "GitRepository":
		gvr = schema.GroupVersionResource{
			Group:    "source.toolkit.fluxcd.io",
			Version:  "v1",
			Resource: "gitrepositories",
		}
	case "HelmRepository":
		gvr = schema.GroupVersionResource{
			Group:    "source.toolkit.fluxcd.io",
			Version:  "v1",
			Resource: "helmrepositories",
		}
	case "OCIRepository":
		gvr = schema.GroupVersionResource{
			Group:    "source.toolkit.fluxcd.io",
			Version:  "v1beta2",
			Resource: "ocirepositories",
		}
	default:
		return
	}

	source, err := client.Resource(gvr).Namespace(sourceNS).Get(ctx, sourceName, metav1.GetOptions{})
	if err != nil {
		return
	}

	annotations := source.GetAnnotations()
	if annotations == nil {
		annotations = make(map[string]string)
	}
	annotations["reconcile.fluxcd.io/requestedAt"] = time.Now().Format(time.RFC3339)
	source.SetAnnotations(annotations)

	client.Resource(gvr).Namespace(sourceNS).Update(ctx, source, metav1.UpdateOptions{})
}

func extractFluxStatus(obj *unstructured.Unstructured, kind string) FluxStatus {
	status := FluxStatus{
		Name:      obj.GetName(),
		Namespace: obj.GetNamespace(),
		Kind:      kind,
		Ready:     false,
	}

	// Suspended flag
	suspended, found, _ := unstructured.NestedBool(obj.Object, "spec", "suspend")
	if found {
		status.Suspended = suspended
	}

	// Source reference
	sourceRef, found, _ := unstructured.NestedMap(obj.Object, "spec", "sourceRef")
	if found && sourceRef != nil {
		sr := &FluxSourceRef{}
		sr.Kind, _, _ = unstructured.NestedString(sourceRef, "kind")
		sr.Name, _, _ = unstructured.NestedString(sourceRef, "name")
		sr.Namespace, _, _ = unstructured.NestedString(sourceRef, "namespace")
		if sr.Kind != "" || sr.Name != "" {
			status.SourceRef = sr
		}
	}

	// DependsOn
	dependsOn, found, _ := unstructured.NestedSlice(obj.Object, "spec", "dependsOn")
	if found {
		for _, dep := range dependsOn {
			depMap, ok := dep.(map[string]interface{})
			if !ok {
				continue
			}
			name, _, _ := unstructured.NestedString(depMap, "name")
			if name != "" {
				status.DependsOn = append(status.DependsOn, name)
			}
		}
	}

	// Conditions
	conditions, found, _ := unstructured.NestedSlice(obj.Object, "status", "conditions")
	if found {
		for _, c := range conditions {
			cond, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			fc := FluxCondition{}
			fc.Type, _, _ = unstructured.NestedString(cond, "type")
			fc.Status, _, _ = unstructured.NestedString(cond, "status")
			fc.Reason, _, _ = unstructured.NestedString(cond, "reason")
			fc.Message, _, _ = unstructured.NestedString(cond, "message")
			fc.LastTransitionTime, _, _ = unstructured.NestedString(cond, "lastTransitionTime")
			status.Conditions = append(status.Conditions, fc)

			if fc.Type == "Ready" {
				status.Ready = fc.Status == "True"
				status.Message = fc.Message
			}
		}
	}

	lastApplied, found, _ := unstructured.NestedString(obj.Object, "status", "lastAppliedRevision")
	if found {
		status.LastApplied = lastApplied
	}

	return status
}

// FluxSuspend toggles spec.suspend on a Flux resource.
func (h *Handler) FluxSuspend(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s client unavailable", http.StatusServiceUnavailable)
		return
	}

	kind := chi.URLParam(r, "kind")
	namespace := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")
	ctx := r.Context()

	var req FluxSuspendRequest
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}

	gvr, ok := resolveFluxGVR(kind)
	if !ok {
		http.Error(w, "unsupported kind: "+kind, http.StatusBadRequest)
		return
	}

	dynamicClient, err := dynamic.NewForConfig(h.k8s.Config())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	resource, err := dynamicClient.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to get %s/%s: %v", namespace, name, err), http.StatusNotFound)
		return
	}

	if err := unstructured.SetNestedField(resource.Object, req.Suspend, "spec", "suspend"); err != nil {
		http.Error(w, fmt.Sprintf("failed to set suspend: %v", err), http.StatusInternalServerError)
		return
	}

	_, err = dynamicClient.Resource(gvr).Namespace(namespace).Update(ctx, resource, metav1.UpdateOptions{})
	if err != nil {
		http.Error(w, fmt.Sprintf("failed to update %s/%s: %v", namespace, name, err), http.StatusInternalServerError)
		return
	}

	// Invalidate cached K8s data for the affected namespace
	if h.cache != nil {
		h.cache.InvalidatePattern(r.Context(), fmt.Sprintf("k8s:*:%s", namespace))
		h.cache.Invalidate(r.Context(), "topology:public")
	}

	action := "resumed"
	if req.Suspend {
		action = "suspended"
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"ok":      true,
		"message": fmt.Sprintf("%s %s/%s %s", kind, namespace, name, action),
	})
}

// FluxListSources lists GitRepositories and HelmRepositories.
func (h *Handler) FluxListSources(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s client unavailable", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()

	dynamicClient, err := dynamic.NewForConfig(h.k8s.Config())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	sources := []FluxSource{}

	// List GitRepositories
	gitGVR := schema.GroupVersionResource{
		Group: "source.toolkit.fluxcd.io", Version: "v1", Resource: "gitrepositories",
	}
	gitRepos, err := dynamicClient.Resource(gitGVR).Namespace("").List(ctx, metav1.ListOptions{})
	if err == nil {
		for _, item := range gitRepos.Items {
			sources = append(sources, extractFluxSource(&item, "GitRepository"))
		}
	}

	// List HelmRepositories
	helmGVR := schema.GroupVersionResource{
		Group: "source.toolkit.fluxcd.io", Version: "v1", Resource: "helmrepositories",
	}
	helmRepos, err := dynamicClient.Resource(helmGVR).Namespace("").List(ctx, metav1.ListOptions{})
	if err == nil {
		for _, item := range helmRepos.Items {
			sources = append(sources, extractFluxSource(&item, "HelmRepository"))
		}
	}

	respondJSON(w, http.StatusOK, sources)
}

func extractFluxSource(obj *unstructured.Unstructured, kind string) FluxSource {
	src := FluxSource{
		Name:      obj.GetName(),
		Namespace: obj.GetNamespace(),
		Kind:      kind,
	}

	src.URL, _, _ = unstructured.NestedString(obj.Object, "spec", "url")

	ref, found, _ := unstructured.NestedMap(obj.Object, "spec", "ref")
	if found {
		src.Branch, _, _ = unstructured.NestedString(ref, "branch")
	}

	// Artifact revision
	src.Revision, _, _ = unstructured.NestedString(obj.Object, "status", "artifact", "revision")

	// Last fetched from artifact lastUpdateTime
	src.LastFetched, _, _ = unstructured.NestedString(obj.Object, "status", "artifact", "lastUpdateTime")

	// Conditions
	conditions, found, _ := unstructured.NestedSlice(obj.Object, "status", "conditions")
	if found {
		for _, c := range conditions {
			cond, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			fc := FluxCondition{}
			fc.Type, _, _ = unstructured.NestedString(cond, "type")
			fc.Status, _, _ = unstructured.NestedString(cond, "status")
			fc.Reason, _, _ = unstructured.NestedString(cond, "reason")
			fc.Message, _, _ = unstructured.NestedString(cond, "message")
			fc.LastTransitionTime, _, _ = unstructured.NestedString(cond, "lastTransitionTime")
			src.Conditions = append(src.Conditions, fc)

			if fc.Type == "Ready" {
				src.Ready = fc.Status == "True"
			}
		}
	}

	return src
}
