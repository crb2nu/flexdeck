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
	Name       string `json:"name"`
	Namespace  string `json:"namespace"`
	Kind       string `json:"kind"`
	Ready      bool   `json:"ready"`
	Message    string `json:"message,omitempty"`
	LastApplied string `json:"lastApplied,omitempty"`
}

// FluxReconcileRequest represents a reconcile request
type FluxReconcileRequest struct {
	WithSource bool `json:"withSource"`
}

// FluxListKustomizations lists Flux Kustomization resources
func (h *Handler) FluxListKustomizations(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	gvr := schema.GroupVersionResource{
		Group:    "kustomize.toolkit.fluxcd.io",
		Version:  "v1",
		Resource: "kustomizations",
	}

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

	gvr := schema.GroupVersionResource{
		Group:    "helm.toolkit.fluxcd.io",
		Version:  "v2",
		Resource: "helmreleases",
	}

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
	var gvr schema.GroupVersionResource
	switch kind {
	case "kustomization", "ks":
		gvr = schema.GroupVersionResource{
			Group:    "kustomize.toolkit.fluxcd.io",
			Version:  "v1",
			Resource: "kustomizations",
		}
	case "helmrelease", "hr":
		gvr = schema.GroupVersionResource{
			Group:    "helm.toolkit.fluxcd.io",
			Version:  "v2",
			Resource: "helmreleases",
		}
	case "gitrepository", "gitrepo":
		gvr = schema.GroupVersionResource{
			Group:    "source.toolkit.fluxcd.io",
			Version:  "v1",
			Resource: "gitrepositories",
		}
	case "helmrepository", "helmrepo":
		gvr = schema.GroupVersionResource{
			Group:    "source.toolkit.fluxcd.io",
			Version:  "v1",
			Resource: "helmrepositories",
		}
	default:
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

	conditions, found, _ := unstructured.NestedSlice(obj.Object, "status", "conditions")
	if found {
		for _, c := range conditions {
			cond, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			condType, _, _ := unstructured.NestedString(cond, "type")
			if condType == "Ready" {
				condStatus, _, _ := unstructured.NestedString(cond, "status")
				status.Ready = condStatus == "True"
				status.Message, _, _ = unstructured.NestedString(cond, "message")
				break
			}
		}
	}

	lastApplied, found, _ := unstructured.NestedString(obj.Object, "status", "lastAppliedRevision")
	if found {
		status.LastApplied = lastApplied
	}

	return status
}
