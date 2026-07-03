package handlers

import (
	"context"
	"sort"
	"strings"

	"github.com/flexinfer/flexdeck/internal/k8s"
	"github.com/flexinfer/flexdeck/internal/workspace"
	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	k8slabels "k8s.io/apimachinery/pkg/labels"
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
	// Pods add the "why" behind a degraded workload (CrashLoopBackOff,
	// ImagePullBackOff, ...); missing pods just leave the reason empty.
	var pods []corev1.Pod
	if list, err := kc.GetPods(ctx, ""); err == nil {
		pods = list.Items
	}
	// Jobs/CronJobs make batch-backed services visible (a failed Job also reads
	// as degraded); both dimensions are best-effort.
	var jobs []batchv1.Job
	if list, err := kc.GetJobs(ctx, ""); err == nil {
		jobs = list.Items
	}
	var cronJobs []batchv1.CronJob
	if list, err := kc.GetCronJobs(ctx, ""); err == nil {
		cronJobs = list.Items
	}

	units := appsWorkloadUnits(deployments, statefulSets, daemonSets, pods)
	units = append(units, batchWorkloadUnits(jobs, cronJobs, pods)...)
	return buildFluxTargets(gitRepos.Items, kustomizations, units)
}

const (
	workloadKindDeployment  = "Deployment"
	workloadKindStatefulSet = "StatefulSet"
	workloadKindDaemonSet   = "DaemonSet"
	workloadKindJob         = "Job"
	workloadKindCronJob     = "CronJob"
)

// workloadUnit is a kind-agnostic view of a single Flux-managed workload, with
// replica counts and rollout health already normalized across
// Deployment/StatefulSet/DaemonSet.
type workloadUnit struct {
	ksKey     string // kustomization namespace/name from the Flux labels
	namespace string
	kind      string
	desired   int
	ready     int
	status    string // healthy | progressing | degraded
	reason    string // notable pod container reason, if any (e.g. CrashLoopBackOff)
}

// appsWorkloadUnits flattens the three apps/v1 workload kinds into a single
// slice, normalizing the kind-specific replica fields (DaemonSets report
// scheduling counts rather than spec replicas) and classifying rollout health.
// Pods matching a workload's selector supply the failure reason behind a
// non-healthy rollout. Workloads without a Flux Kustomization name label are
// dropped.
func appsWorkloadUnits(deployments []appsv1.Deployment, statefulSets []appsv1.StatefulSet, daemonSets []appsv1.DaemonSet, pods []corev1.Pod) []workloadUnit {
	unhealthy := indexUnhealthyPods(pods)
	units := make([]workloadUnit, 0, len(deployments)+len(statefulSets)+len(daemonSets))
	for i := range deployments {
		d := &deployments[i]
		reason := workloadPodReason(unhealthy, d.Namespace, d.Spec.Selector)
		if unit, ok := workloadUnitFromMeta(d.Labels, d.Namespace, workloadKindDeployment, replicaInt(d.Spec.Replicas), int(d.Status.ReadyReplicas), deploymentRolloutStatus(d), reason); ok {
			units = append(units, unit)
		}
	}
	for i := range statefulSets {
		s := &statefulSets[i]
		desired := replicaInt(s.Spec.Replicas)
		reason := workloadPodReason(unhealthy, s.Namespace, s.Spec.Selector)
		if unit, ok := workloadUnitFromMeta(s.Labels, s.Namespace, workloadKindStatefulSet, desired, int(s.Status.ReadyReplicas), rolloutStatus(desired, int(s.Status.ReadyReplicas), int(s.Status.UpdatedReplicas), false), reason); ok {
			units = append(units, unit)
		}
	}
	for i := range daemonSets {
		ds := &daemonSets[i]
		desired := int(ds.Status.DesiredNumberScheduled)
		reason := workloadPodReason(unhealthy, ds.Namespace, ds.Spec.Selector)
		if unit, ok := workloadUnitFromMeta(ds.Labels, ds.Namespace, workloadKindDaemonSet, desired, int(ds.Status.NumberReady), rolloutStatus(desired, int(ds.Status.NumberReady), int(ds.Status.UpdatedNumberScheduled), false), reason); ok {
			units = append(units, unit)
		}
	}
	return units
}

// batchWorkloadUnits flattens Flux-managed batch/v1 Jobs and CronJobs into
// workloadUnits. Neither has a replica model, so they contribute presence and
// kind counts (desired/ready stay 0) rather than a ready ratio — this makes a
// Job/CronJob-backed service visible without inflating replica health. A Job
// with a Failed condition folds into the aggregate as degraded and still
// surfaces its crashing pods' reason via its selector; CronJobs are count-only
// (their run-history health is out of scope for this slice). Ephemeral Jobs
// spawned by a CronJob carry no Flux label and are dropped by workloadUnitFromMeta.
func batchWorkloadUnits(jobs []batchv1.Job, cronJobs []batchv1.CronJob, pods []corev1.Pod) []workloadUnit {
	unhealthy := indexUnhealthyPods(pods)
	units := make([]workloadUnit, 0, len(jobs)+len(cronJobs))
	for i := range jobs {
		job := &jobs[i]
		reason := workloadPodReason(unhealthy, job.Namespace, job.Spec.Selector)
		if unit, ok := workloadUnitFromMeta(job.Labels, job.Namespace, workloadKindJob, 0, 0, jobStatus(job), reason); ok {
			units = append(units, unit)
		}
	}
	for i := range cronJobs {
		cronJob := &cronJobs[i]
		if unit, ok := workloadUnitFromMeta(cronJob.Labels, cronJob.Namespace, workloadKindCronJob, 0, 0, workspace.WorkloadHealthy, ""); ok {
			units = append(units, unit)
		}
	}
	return units
}

// jobStatus classifies a Job: an explicit Failed condition (backoff/deadline
// exceeded) is degraded; a running or completed Job is not "degraded".
func jobStatus(job *batchv1.Job) string {
	for _, cond := range job.Status.Conditions {
		if cond.Type == batchv1.JobFailed && cond.Status == corev1.ConditionTrue {
			return workspace.WorkloadDegraded
		}
	}
	return workspace.WorkloadHealthy
}

func workloadUnitFromMeta(labels map[string]string, namespace, kind string, desired, ready int, status, reason string) (workloadUnit, bool) {
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
		status:    status,
		reason:    reason,
	}, true
}

func replicaInt(replicas *int32) int {
	if replicas == nil {
		return 1
	}
	return int(*replicas)
}

// notableContainerReasons ranks the container waiting/terminated reasons worth
// surfacing on a non-healthy workload, most actionable first. Benign transitional
// states (ContainerCreating, PodInitializing, Completed) are intentionally absent
// so a healthy rollout stays quiet.
var notableContainerReasons = map[string]int{
	"CrashLoopBackOff":           7,
	"OOMKilled":                  6,
	"CreateContainerConfigError": 5,
	"CreateContainerError":       4,
	"RunContainerError":          3,
	"InvalidImageName":           2,
	"ImagePullBackOff":           1,
	"ErrImagePull":               1,
}

// worsePodReason returns the more actionable of two container reasons, with a
// lexical tiebreak so aggregation is deterministic regardless of pod ordering.
func worsePodReason(current, next string) string {
	if next == "" {
		return current
	}
	if current == "" {
		return next
	}
	switch cs, ns := notableContainerReasons[current], notableContainerReasons[next]; {
	case ns > cs:
		return next
	case ns == cs && next < current:
		return next
	default:
		return current
	}
}

// notablePodReason keeps a reason only if it is in the surfaced set, so benign
// transitional states collapse to "".
func notablePodReason(reason string) string {
	if _, ok := notableContainerReasons[reason]; ok {
		return reason
	}
	return ""
}

// podNotableReason returns the most actionable container reason explaining why a
// pod is not ready, or "" when it looks healthy or is only transiently starting.
// Init containers are inspected first since they gate the main containers.
func podNotableReason(pod *corev1.Pod) string {
	reason := containerStatusesReason(pod.Status.InitContainerStatuses)
	return worsePodReason(reason, containerStatusesReason(pod.Status.ContainerStatuses))
}

func containerStatusesReason(statuses []corev1.ContainerStatus) string {
	reason := ""
	for i := range statuses {
		status := &statuses[i]
		switch {
		case status.State.Waiting != nil:
			reason = worsePodReason(reason, notablePodReason(status.State.Waiting.Reason))
		case status.State.Terminated != nil && !status.Ready:
			reason = worsePodReason(reason, notablePodReason(status.State.Terminated.Reason))
		}
	}
	return reason
}

// labeledPodReason pairs a pod's labels with its notable failure reason so a
// workload can claim only the pods its selector matches.
type labeledPodReason struct {
	labels map[string]string
	reason string
}

// indexUnhealthyPods buckets pods that carry a notable failure reason by
// namespace. Healthy pods are dropped, so the index is empty on a healthy fleet.
func indexUnhealthyPods(pods []corev1.Pod) map[string][]labeledPodReason {
	if len(pods) == 0 {
		return nil
	}
	index := map[string][]labeledPodReason{}
	for i := range pods {
		pod := &pods[i]
		reason := podNotableReason(pod)
		if reason == "" {
			continue
		}
		index[pod.Namespace] = append(index[pod.Namespace], labeledPodReason{labels: pod.Labels, reason: reason})
	}
	return index
}

// workloadPodReason returns the worst notable reason among the unhealthy pods in
// the workload's namespace that match its selector, or "" when none apply.
func workloadPodReason(index map[string][]labeledPodReason, namespace string, selector *metav1.LabelSelector) string {
	candidates := index[namespace]
	if len(candidates) == 0 || selector == nil {
		return ""
	}
	sel, err := metav1.LabelSelectorAsSelector(selector)
	if err != nil || sel.Empty() {
		return ""
	}
	reason := ""
	for _, candidate := range candidates {
		if sel.Matches(k8slabels.Set(candidate.labels)) {
			reason = worsePodReason(reason, candidate.reason)
		}
	}
	return reason
}

// rolloutStatus classifies a single workload from normalized counts. A workload
// rolling out a new revision (updated < desired) is progressing, not degraded;
// a workload whose current revision is fully rolled out but missing ready
// replicas (or explicitly stuck) is degraded.
func rolloutStatus(desired, ready, updated int, stuck bool) string {
	if stuck {
		return workspace.WorkloadDegraded
	}
	if desired > 0 && updated < desired {
		return workspace.WorkloadProgressing
	}
	if ready < desired {
		return workspace.WorkloadDegraded
	}
	return workspace.WorkloadHealthy
}

// deploymentRolloutStatus uses the Deployment's Progressing/Available conditions
// (which StatefulSets and DaemonSets do not have) to detect a stuck rollout
// before falling back to the numeric classification.
func deploymentRolloutStatus(d *appsv1.Deployment) string {
	stuck := false
	for _, cond := range d.Status.Conditions {
		switch cond.Type {
		case appsv1.DeploymentProgressing:
			if cond.Status == corev1.ConditionFalse {
				stuck = true // ProgressDeadlineExceeded
			}
		case appsv1.DeploymentAvailable:
			if cond.Status == corev1.ConditionFalse {
				stuck = true
			}
		}
	}
	return rolloutStatus(replicaInt(d.Spec.Replicas), int(d.Status.ReadyReplicas), int(d.Status.UpdatedReplicas), stuck)
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
		// A reason only makes sense alongside a problem; a healthy aggregate
		// drops any reason carried by a since-recovered pod.
		if workload.Status == workspace.WorkloadHealthy {
			workload.Reason = ""
		}
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
		case workloadKindJob:
			workload.Jobs++
		case workloadKindCronJob:
			workload.CronJobs++
		default:
			workload.Deployments++
		}
		workload.Desired += unit.desired
		workload.Ready += unit.ready
		workload.Status = worseRolloutStatus(workload.Status, unit.status)
		workload.Reason = worsePodReason(workload.Reason, unit.reason)
		namespacesByPath[path][unit.namespace] = true
		kustomizationsWithWorkloads[unit.ksKey] = true
	}

	return workloadByPath, namespacesByPath, kustomizationsWithWorkloads
}

var rolloutSeverity = map[string]int{
	workspace.WorkloadHealthy:     0,
	workspace.WorkloadProgressing: 1,
	workspace.WorkloadDegraded:    2,
}

// worseRolloutStatus returns the more severe of two rollout statuses so a
// source's aggregate reflects its unhealthiest workload.
func worseRolloutStatus(current, next string) string {
	if current == "" {
		return next
	}
	if rolloutSeverity[next] > rolloutSeverity[current] {
		return next
	}
	return current
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
