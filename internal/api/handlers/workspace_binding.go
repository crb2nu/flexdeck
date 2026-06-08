package handlers

import (
	"context"
	"sort"
	"strings"

	"github.com/flexinfer/flexdeck/internal/k8s"
	"github.com/flexinfer/flexdeck/internal/workspace"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const (
	fluxKustomizationNameLabel      = "kustomize.toolkit.fluxcd.io/name"
	fluxKustomizationNamespaceLabel = "kustomize.toolkit.fluxcd.io/namespace"
)

var (
	bindingGitRepositoryGVR = schema.GroupVersionResource{
		Group: "source.toolkit.fluxcd.io", Version: "v1", Resource: "gitrepositories",
	}
	bindingKustomizationGVR = schema.GroupVersionResource{
		Group: "kustomize.toolkit.fluxcd.io", Version: "v1", Resource: "kustomizations",
	}
)

// fluxBindingTargets lists live Flux GitRepository sources, Kustomizations, and
// Deployments and builds a project-path keyed lookup used to verify repository
// bindings. It is best-effort: any missing client or list error yields a nil
// map (or skips the workload dimension) so the caller leaves bindings at their
// inferred confidence.
func (h *Handler) fluxBindingTargets(ctx context.Context, kc *k8s.Client) map[string]workspace.FluxTarget {
	if kc == nil {
		return nil
	}
	dynamicClient, err := h.newDynamicClient(kc.Config())
	if err != nil {
		return nil
	}

	gitRepos, err := dynamicClient.Resource(bindingGitRepositoryGVR).Namespace("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil
	}

	var kustomizations []unstructured.Unstructured
	if list, err := dynamicClient.Resource(bindingKustomizationGVR).Namespace("").List(ctx, metav1.ListOptions{}); err == nil {
		kustomizations = list.Items
	}

	var deployments []appsv1.Deployment
	if list, err := kc.GetDeployments(ctx, ""); err == nil {
		deployments = list.Items
	}

	return buildFluxTargets(gitRepos.Items, kustomizations, deployments)
}

type fluxKustomizationInfo struct {
	name, namespace, targetNamespace string
}

// buildFluxTargets is the pure join. It normalizes each GitRepository URL to a
// project path, attaches the owning Kustomization, and aggregates the live
// Deployment health across all of the source's kustomizations (a source can own
// several). Deployments are joined back to a source through the
// kustomize.toolkit.fluxcd.io/{name,namespace} labels Flux stamps on everything
// it applies, so the namespace they run in is authoritative.
func buildFluxTargets(gitRepos, kustomizations []unstructured.Unstructured, deployments []appsv1.Deployment) map[string]workspace.FluxTarget {
	targets := map[string]workspace.FluxTarget{}
	sourceKeyToPath := map[string]string{}

	for i := range gitRepos {
		obj := &gitRepos[i]
		rawURL, _, _ := unstructured.NestedString(obj.Object, "spec", "url")
		projectPath := workspace.ProjectPathFromURL(rawURL)
		if projectPath == "" {
			continue
		}
		key := strings.ToLower(projectPath)
		if _, exists := targets[key]; exists {
			continue // first source for a path wins
		}
		targets[key] = workspace.FluxTarget{
			ProjectPath:     key,
			SourceName:      obj.GetName(),
			SourceNamespace: obj.GetNamespace(),
		}
		sourceKeyToPath[obj.GetNamespace()+"/"+obj.GetName()] = key
	}

	byPath := map[string][]fluxKustomizationInfo{}
	ksKeyToPath := map[string]string{}
	for i := range kustomizations {
		obj := &kustomizations[i]
		sourceName, _, _ := unstructured.NestedString(obj.Object, "spec", "sourceRef", "name")
		if sourceName == "" {
			continue
		}
		sourceNamespace, _, _ := unstructured.NestedString(obj.Object, "spec", "sourceRef", "namespace")
		if sourceNamespace == "" {
			sourceNamespace = obj.GetNamespace()
		}
		key, ok := sourceKeyToPath[sourceNamespace+"/"+sourceName]
		if !ok {
			continue
		}
		targetNamespace, _, _ := unstructured.NestedString(obj.Object, "spec", "targetNamespace")
		info := fluxKustomizationInfo{name: obj.GetName(), namespace: obj.GetNamespace(), targetNamespace: targetNamespace}
		byPath[key] = append(byPath[key], info)
		ksKeyToPath[info.namespace+"/"+info.name] = key
	}

	workloadByPath, namespacesByPath, kustomizationsWithWorkloads := aggregateWorkloads(deployments, ksKeyToPath)
	for path, workload := range workloadByPath {
		workload.Namespaces = sortedSetKeys(namespacesByPath[path])
	}

	for key, candidates := range byPath {
		basename := key
		if idx := strings.LastIndex(key, "/"); idx >= 0 {
			basename = key[idx+1:]
		}
		chosen := pickKustomization(candidates, basename, kustomizationsWithWorkloads)
		target := targets[key]
		target.Kustomization = chosen.name
		target.TargetNamespace = chosen.targetNamespace
		target.Workload = workloadByPath[key]
		targets[key] = target
	}

	return targets
}

// aggregateWorkloads joins Deployments to source project paths via the Flux
// Kustomization labels and sums replica health per path.
func aggregateWorkloads(deployments []appsv1.Deployment, ksKeyToPath map[string]string) (
	map[string]*workspace.Workload, map[string]map[string]bool, map[string]bool,
) {
	workloadByPath := map[string]*workspace.Workload{}
	namespacesByPath := map[string]map[string]bool{}
	kustomizationsWithWorkloads := map[string]bool{}

	for i := range deployments {
		deployment := &deployments[i]
		ksName := deployment.Labels[fluxKustomizationNameLabel]
		if ksName == "" {
			continue
		}
		ksKey := deployment.Labels[fluxKustomizationNamespaceLabel] + "/" + ksName
		path, ok := ksKeyToPath[ksKey]
		if !ok {
			continue
		}
		desired := 1
		if deployment.Spec.Replicas != nil {
			desired = int(*deployment.Spec.Replicas)
		}

		workload := workloadByPath[path]
		if workload == nil {
			workload = &workspace.Workload{}
			workloadByPath[path] = workload
			namespacesByPath[path] = map[string]bool{}
		}
		workload.Deployments++
		workload.Desired += desired
		workload.Ready += int(deployment.Status.ReadyReplicas)
		namespacesByPath[path][deployment.Namespace] = true
		kustomizationsWithWorkloads[ksKey] = true
	}

	return workloadByPath, namespacesByPath, kustomizationsWithWorkloads
}

// pickKustomization chooses the Kustomization to display for a source: the one
// named after the repo wins, else the (lexicographically smallest) one that
// actually owns workloads, else the smallest overall.
func pickKustomization(candidates []fluxKustomizationInfo, basename string, withWorkloads map[string]bool) fluxKustomizationInfo {
	var best, bestWithWorkload fluxKustomizationInfo
	for _, candidate := range candidates {
		if candidate.name == basename {
			return candidate
		}
		if best.name == "" || candidate.name < best.name {
			best = candidate
		}
		if withWorkloads[candidate.namespace+"/"+candidate.name] {
			if bestWithWorkload.name == "" || candidate.name < bestWithWorkload.name {
				bestWithWorkload = candidate
			}
		}
	}
	if bestWithWorkload.name != "" {
		return bestWithWorkload
	}
	return best
}

func sortedSetKeys(set map[string]bool) []string {
	if len(set) == 0 {
		return nil
	}
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
