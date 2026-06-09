package handlers

import (
	"testing"

	"github.com/flexinfer/flexdeck/internal/workspace"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func gitRepoObj(name, namespace, url string) unstructured.Unstructured {
	return unstructured.Unstructured{Object: map[string]any{
		"metadata": map[string]any{"name": name, "namespace": namespace},
		"spec":     map[string]any{"url": url},
	}}
}

func ksObj(name, namespace, sourceName, sourceNamespace, targetNamespace string) unstructured.Unstructured {
	sourceRef := map[string]any{"kind": "GitRepository", "name": sourceName}
	if sourceNamespace != "" {
		sourceRef["namespace"] = sourceNamespace
	}
	spec := map[string]any{"sourceRef": sourceRef}
	if targetNamespace != "" {
		spec["targetNamespace"] = targetNamespace
	}
	return unstructured.Unstructured{Object: map[string]any{
		"metadata": map[string]any{"name": name, "namespace": namespace},
		"spec":     spec,
	}}
}

func fluxLabels(ksName, ksNamespace string) map[string]string {
	return map[string]string{
		"kustomize.toolkit.fluxcd.io/name":      ksName,
		"kustomize.toolkit.fluxcd.io/namespace": ksNamespace,
	}
}

// The builders default to a fully rolled-out revision (updated == desired) so
// `ready < desired` reads as degraded; rollout tests override `updated`.
func deployObj(name, namespace, ksName, ksNamespace string, desired, ready int32) appsv1.Deployment {
	replicas := desired
	return appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, Labels: fluxLabels(ksName, ksNamespace)},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
		Status:     appsv1.DeploymentStatus{ReadyReplicas: ready, UpdatedReplicas: desired},
	}
}

func stsObj(name, namespace, ksName, ksNamespace string, desired, ready int32) appsv1.StatefulSet {
	replicas := desired
	return appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, Labels: fluxLabels(ksName, ksNamespace)},
		Spec:       appsv1.StatefulSetSpec{Replicas: &replicas},
		Status:     appsv1.StatefulSetStatus{ReadyReplicas: ready, UpdatedReplicas: desired},
	}
}

func dsObj(name, namespace, ksName, ksNamespace string, desired, ready int32) appsv1.DaemonSet {
	return appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: namespace, Labels: fluxLabels(ksName, ksNamespace)},
		Status:     appsv1.DaemonSetStatus{DesiredNumberScheduled: desired, NumberReady: ready, UpdatedNumberScheduled: desired},
	}
}

// Shapes mirror the live cluster: internal git host, sources in flux-system,
// one source owning several kustomizations.
func bindingFixtures() (gitRepos, kustomizations []unstructured.Unstructured) {
	gitRepos = []unstructured.Unstructured{
		gitRepoObj("flexdeck", "flux-system", "http://gitlab-vm.gitlab.svc.cluster.local/services/flexdeck.git"),
		gitRepoObj("flexinfer", "flux-system", "http://gitlab-vm.gitlab.svc.cluster.local/services/flexinfer.git"),
		gitRepoObj("smarthome", "flux-system", "http://gitlab-vm.gitlab.svc.cluster.local/services/smarthome.git"),
	}
	kustomizations = []unstructured.Unstructured{
		ksObj("flexdeck", "flux-system", "flexdeck", "", ""),
		ksObj("flexinfer-system", "flux-system", "flexinfer", "", ""),
		ksObj("flexinfer-models", "flux-system", "flexinfer", "", ""),
		ksObj("smarthome", "flux-system", "smarthome", "flux-system", ""),
	}
	return gitRepos, kustomizations
}

func TestAppsWorkloadUnits(t *testing.T) {
	t.Parallel()

	deployments := []appsv1.Deployment{
		deployObj("nil-replicas", "x", "ks-x", "flux-system", 0, 0),
	}
	deployments[0].Spec.Replicas = nil // a nil replica count defaults to 1
	statefulSets := []appsv1.StatefulSet{stsObj("db", "y", "ks-y", "flux-system", 2, 1)}
	daemonSets := []appsv1.DaemonSet{dsObj("agent", "z", "ks-z", "flux-system", 4, 3)}
	// Workloads without the Flux name label are dropped.
	unlabeled := appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Name: "orphan", Namespace: "n"}}

	units := appsWorkloadUnits(append(deployments, unlabeled), statefulSets, daemonSets)

	if len(units) != 3 {
		t.Fatalf("got %d units, want 3 (unlabeled dropped): %#v", len(units), units)
	}
	byKind := map[string]workloadUnit{}
	for _, u := range units {
		byKind[u.kind] = u
	}
	if d := byKind[workloadKindDeployment]; d.desired != 1 {
		t.Errorf("deployment nil replicas desired = %d, want 1", d.desired)
	}
	if s := byKind[workloadKindStatefulSet]; s.desired != 2 || s.ready != 1 {
		t.Errorf("statefulset = %d/%d, want 1/2", s.ready, s.desired)
	}
	if ds := byKind[workloadKindDaemonSet]; ds.desired != 4 || ds.ready != 3 {
		t.Errorf("daemonset = %d/%d, want 3/4 (scheduling counts)", ds.ready, ds.desired)
	}
}

func TestBuildFluxTargetsWithWorkloads(t *testing.T) {
	t.Parallel()

	gitRepos, kustomizations := bindingFixtures()
	deployments := []appsv1.Deployment{
		deployObj("flexdeck", "flexdeck", "flexdeck", "flux-system", 1, 1),
		deployObj("flexdeck-public", "flexdeck", "flexdeck", "flux-system", 1, 1),
		deployObj("redis", "flexdeck", "flexdeck", "flux-system", 1, 0),
	}
	statefulSets := []appsv1.StatefulSet{
		// smarthome runs ONLY as a StatefulSet — invisible before this slice.
		stsObj("home-assistant", "smarthome", "smarthome", "flux-system", 1, 1),
		// flexinfer's workloads live under the flexinfer-system kustomization.
		stsObj("vllm", "flexinfer-system", "flexinfer-system", "flux-system", 2, 2),
	}
	daemonSets := []appsv1.DaemonSet{
		// Belongs to a platform kustomization (not a service source) -> ignored.
		dsObj("node-exporter", "kube-system", "apps", "flux-system", 3, 3),
	}

	targets := buildFluxTargets(gitRepos, kustomizations, appsWorkloadUnits(deployments, statefulSets, daemonSets))

	flexdeck := targets["services/flexdeck"].Workload
	if flexdeck == nil || flexdeck.Deployments != 3 || flexdeck.StatefulSets != 0 || flexdeck.Ready != 2 || flexdeck.Desired != 3 {
		t.Fatalf("flexdeck workload = %#v, want 3 deploys 2/3 ready", flexdeck)
	}
	// redis is 0/1 with the revision rolled out -> the source aggregates degraded.
	if flexdeck.Status != workspace.WorkloadDegraded {
		t.Errorf("flexdeck status = %q, want degraded", flexdeck.Status)
	}

	// StatefulSet-only service is now visible.
	smarthome := targets["services/smarthome"]
	if smarthome.Workload == nil || smarthome.Workload.StatefulSets != 1 || smarthome.Workload.Ready != 1 {
		t.Fatalf("smarthome workload = %#v, want 1 statefulset 1/1", smarthome.Workload)
	}
	if smarthome.Workload.Status != workspace.WorkloadHealthy {
		t.Errorf("smarthome status = %q, want healthy", smarthome.Workload.Status)
	}
	if len(smarthome.Workload.Namespaces) != 1 || smarthome.Workload.Namespaces[0] != "smarthome" {
		t.Errorf("smarthome namespaces = %#v, want [smarthome]", smarthome.Workload.Namespaces)
	}

	// The StatefulSet drives the workload-owning kustomization pick for flexinfer.
	flexinfer := targets["services/flexinfer"]
	if flexinfer.Kustomization != "flexinfer-system" {
		t.Errorf("flexinfer kustomization = %q, want flexinfer-system", flexinfer.Kustomization)
	}
	if flexinfer.Workload == nil || flexinfer.Workload.StatefulSets != 1 || flexinfer.Workload.Desired != 2 {
		t.Fatalf("flexinfer workload = %#v, want 1 statefulset 2/2", flexinfer.Workload)
	}
}

func TestBuildFluxTargetsWithoutWorkloads(t *testing.T) {
	t.Parallel()

	gitRepos, kustomizations := bindingFixtures()
	targets := buildFluxTargets(gitRepos, kustomizations, nil)

	if flexinfer := targets["services/flexinfer"]; flexinfer.Kustomization != "flexinfer-models" {
		t.Errorf("flexinfer kustomization = %q, want flexinfer-models fallback", flexinfer.Kustomization)
	}
	if flexdeck := targets["services/flexdeck"]; flexdeck.Workload != nil {
		t.Errorf("flexdeck workload = %#v, want nil without workloads", flexdeck.Workload)
	}
}

func TestRolloutStatus(t *testing.T) {
	t.Parallel()

	cases := []struct {
		desired, ready, updated int
		stuck                   bool
		want                    string
	}{
		{2, 2, 2, false, workspace.WorkloadHealthy},
		{3, 2, 1, false, workspace.WorkloadProgressing}, // new revision rolling out
		{2, 1, 2, false, workspace.WorkloadDegraded},    // rolled out but a replica is down
		{2, 1, 2, true, workspace.WorkloadDegraded},     // explicitly stuck
		{0, 0, 0, false, workspace.WorkloadHealthy},     // scaled to zero
	}
	for _, tc := range cases {
		if got := rolloutStatus(tc.desired, tc.ready, tc.updated, tc.stuck); got != tc.want {
			t.Errorf("rolloutStatus(%d,%d,%d,%v) = %q, want %q", tc.desired, tc.ready, tc.updated, tc.stuck, got, tc.want)
		}
	}
}

func TestDeploymentRolloutStatusUsesConditions(t *testing.T) {
	t.Parallel()

	mk := func(desired, ready, updated int32, progressing, available corev1.ConditionStatus) *appsv1.Deployment {
		replicas := desired
		return &appsv1.Deployment{
			Spec: appsv1.DeploymentSpec{Replicas: &replicas},
			Status: appsv1.DeploymentStatus{
				ReadyReplicas: ready, UpdatedReplicas: updated,
				Conditions: []appsv1.DeploymentCondition{
					{Type: appsv1.DeploymentProgressing, Status: progressing},
					{Type: appsv1.DeploymentAvailable, Status: available},
				},
			},
		}
	}

	if s := deploymentRolloutStatus(mk(2, 2, 2, corev1.ConditionTrue, corev1.ConditionTrue)); s != workspace.WorkloadHealthy {
		t.Errorf("healthy deployment = %q, want healthy", s)
	}
	// ProgressDeadlineExceeded surfaces as Progressing=False -> degraded.
	if s := deploymentRolloutStatus(mk(2, 1, 2, corev1.ConditionFalse, corev1.ConditionTrue)); s != workspace.WorkloadDegraded {
		t.Errorf("progress-deadline deployment = %q, want degraded", s)
	}
	// Available=False -> degraded even though a rollout may look in-flight.
	if s := deploymentRolloutStatus(mk(2, 0, 1, corev1.ConditionTrue, corev1.ConditionFalse)); s != workspace.WorkloadDegraded {
		t.Errorf("unavailable deployment = %q, want degraded", s)
	}
}

func TestWorkloadStatusAggregatesWorst(t *testing.T) {
	t.Parallel()

	gitRepos := []unstructured.Unstructured{
		gitRepoObj("svc", "flux-system", "http://gitlab-vm.gitlab.svc.cluster.local/services/svc.git"),
	}
	kustomizations := []unstructured.Unstructured{ksObj("svc", "flux-system", "svc", "", "")}
	// One healthy deployment + one progressing deployment -> aggregate progressing.
	healthy := deployObj("web", "svc", "svc", "flux-system", 2, 2)
	progressing := deployObj("worker", "svc", "svc", "flux-system", 3, 2)
	progressing.Status.UpdatedReplicas = 1 // new revision still rolling out

	targets := buildFluxTargets(gitRepos, kustomizations, appsWorkloadUnits([]appsv1.Deployment{healthy, progressing}, nil, nil))
	if got := targets["services/svc"].Workload.Status; got != workspace.WorkloadProgressing {
		t.Fatalf("aggregate status = %q, want progressing", got)
	}
}

func TestBuildFluxTargetsSkipsUnparseableAndEmpty(t *testing.T) {
	t.Parallel()

	targets := buildFluxTargets(
		[]unstructured.Unstructured{gitRepoObj("blank", "flux-system", "")},
		nil,
		nil,
	)
	if len(targets) != 0 {
		t.Fatalf("expected no targets for empty url, got %#v", targets)
	}
}
