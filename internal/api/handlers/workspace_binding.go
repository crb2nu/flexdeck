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
	var statefulSets []appsv1.StatefulSet
	if list, err := kc.GetStatefulSets(ctx, ""); err == nil {
		statefulSets = list.Items
	}
	var daemonSets []appsv1.DaemonSet
	if list, err := kc.GetDaemonSets(ctx, ""); err == nil {
		daemonSets = list.Items
	}

	return buildFluxTargets(gitRepos.Items, kustomizations, appsWorkloadUnits(deployments, statefulSets, daemonSets))
}

const (
	workloadKindDeployment  = "Deployment"
	workloadKindStatefulSet = "StatefulSet"
	workloadKindDaemonSet   = "DaemonSet"
)

// workloadUnit is a kind-agnostic view of a single Flux-managed workload, with
// replica counts already normalized across Deployment/StatefulSet/DaemonSet.
type workloadUnit struct {
	ksKey     string // kustomization namespace/name from the Flux labels
	namespace string
	kind      string
	desired   int
	ready     int
}

// appsWorkloadUnits flattens the three apps/v1 workload kinds into a single
// slice, normalizing the kind-specific replica fields (DaemonSets report
// scheduling counts rather than spec replicas). Workloads without a Flux
// Kustomization name label are dropped.
func appsWorkloadUnits(deployments []appsv1.Deployment, statefulSets []appsv1.StatefulSet, daemonSets []appsv1.DaemonSet) []workloadUnit {
	units := make([]workloadUnit, 0, len(deployments)+len(statefulSets)+len(daemonSets))
	for i := range deployments {
		d := &deployments[i]
		if unit, ok := workloadUnitFromMeta(d.Labels, d.Namespace, workloadKindDeployment, replicaInt(d.Spec.Replicas), int(d.Status.ReadyReplicas)); ok {
			units = append(units, unit)
		}
	}
	for i := range statefulSets {
		s := &statefulSets[i]
		if unit, ok := workloadUnitFromMeta(s.Labels, s.Namespace, workloadKindStatefulSet, replicaInt(s.Spec.Replicas), int(s.Status.ReadyReplicas)); ok {
			units = append(units, unit)
		}
	}
	for i := range daemonSets {
		ds := &daemonSets[i]
		if unit, ok := workloadUnitFromMeta(ds.Labels, ds.Namespace, workloadKindDaemonSet, int(ds.Status.DesiredNumberScheduled), int(ds.Status.NumberReady)); ok {
			units = append(units, unit)
		}
	}
	return units
}

func workloadUnitFromMeta(labels map[string]string, namespace, kind string, desired, ready int) (workloadUnit, bool) {
	ksName := labels[fluxKustomizationNameLabel]
	if ksName == "" {
		return workloadUnit{}, false
	}
	return workloadUnit{
		ksKey:     labels[fluxKustomizationNamespaceLabel] + "/" + ksName,
		namespace: namespace,
		kind:      kind,
		desired:   desired,
		ready:     ready,
	}, true
}

func replicaInt(replicas *int32) int {
	if replicas == nil {
		return 1
	}
	return int(*replicas)
}

type fluxKustomizationInfo struct {
	name, namespace, targetNamespace string
}

// buildFluxTargets is the pure join. It normalizes each GitRepository URL to a
// project path, attaches the owning Kustomization, and aggregates live workload
// health across all of the source's kustomizations (a source can own several).
// Workloads are joined back to a source through the
// kustomize.toolkit.fluxcd.io/{name,namespace} labels Flux stamps on everything
// it applies, so the namespace they run in is authoritative.
func buildFluxTargets(gitRepos, kustomizations []unstructured.Unstructured, workloads []workloadUnit) map[string]workspace.FluxTarget {
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

	workloadByPath, namespacesByPath, kustomizationsWithWorkloads := aggregateWorkloads(workloads, ksKeyToPath)
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

// aggregateWorkloads joins workloads to source project paths via the Flux
// Kustomization labels and sums replica health (and per-kind counts) per path.
func aggregateWorkloads(workloads []workloadUnit, ksKeyToPath map[string]string) (
	map[string]*workspace.Workload, map[string]map[string]bool, map[string]bool,
) {
	workloadByPath := map[string]*workspace.Workload{}
	namespacesByPath := map[string]map[string]bool{}
	kustomizationsWithWorkloads := map[string]bool{}

	for _, unit := range workloads {
		path, ok := ksKeyToPath[unit.ksKey]
		if !ok {
			continue
		}

		workload := workloadByPath[path]
		if workload == nil {
			workload = &workspace.Workload{}
			workloadByPath[path] = workload
			namespacesByPath[path] = map[string]bool{}
		}
		switch unit.kind {
		case workloadKindStatefulSet:
			workload.StatefulSets++
		case workloadKindDaemonSet:
			workload.DaemonSets++
		default:
			workload.Deployments++
		}
		workload.Desired += unit.desired
		workload.Ready += unit.ready
		namespacesByPath[path][unit.namespace] = true
		kustomizationsWithWorkloads[unit.ksKey] = true
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
