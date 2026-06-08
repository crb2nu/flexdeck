package handlers

import (
	"testing"

	appsv1 "k8s.io/api/apps/v1"
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

func deployObj(name, namespace, ksName, ksNamespace string, desired, ready int32) appsv1.Deployment {
	replicas := desired
	return appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			Labels: map[string]string{
				"kustomize.toolkit.fluxcd.io/name":      ksName,
				"kustomize.toolkit.fluxcd.io/namespace": ksNamespace,
			},
		},
		Spec:   appsv1.DeploymentSpec{Replicas: &replicas},
		Status: appsv1.DeploymentStatus{ReadyReplicas: ready},
	}
}

// Shapes mirror the live cluster: internal git host, sources in flux-system,
// one source owning several kustomizations, mostly without targetNamespace.
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
		ksObj("smarthome", "flux-system", "smarthome", "flux-system", "home"),
	}
	return gitRepos, kustomizations
}

func TestBuildFluxTargetsWithWorkloads(t *testing.T) {
	t.Parallel()

	gitRepos, kustomizations := bindingFixtures()
	// flexdeck's kustomization owns 3 deployments in ns flexdeck; flexinfer's
	// running deployments belong to the flexinfer-system kustomization in a
	// different namespace than the inferred guess.
	deployments := []appsv1.Deployment{
		deployObj("flexdeck", "flexdeck", "flexdeck", "flux-system", 1, 1),
		deployObj("flexdeck-public", "flexdeck", "flexdeck", "flux-system", 1, 1),
		deployObj("redis", "flexdeck", "flexdeck", "flux-system", 1, 0),
		deployObj("kokoro-tts", "flexinfer-system", "flexinfer-system", "flux-system", 1, 1),
		deployObj("pyannote", "flexinfer-system", "flexinfer-system", "flux-system", 2, 2),
	}

	targets := buildFluxTargets(gitRepos, kustomizations, deployments)

	flexdeck := targets["services/flexdeck"]
	if flexdeck.Kustomization != "flexdeck" {
		t.Errorf("flexdeck kustomization = %q, want flexdeck", flexdeck.Kustomization)
	}
	if flexdeck.Workload == nil {
		t.Fatalf("flexdeck workload is nil")
	}
	if flexdeck.Workload.Deployments != 3 || flexdeck.Workload.Desired != 3 || flexdeck.Workload.Ready != 2 {
		t.Errorf("flexdeck workload = %#v, want 3 deploys 2/3 ready", flexdeck.Workload)
	}
	if len(flexdeck.Workload.Namespaces) != 1 || flexdeck.Workload.Namespaces[0] != "flexdeck" {
		t.Errorf("flexdeck workload namespaces = %#v, want [flexdeck]", flexdeck.Workload.Namespaces)
	}

	// The kustomization that actually owns workloads is preferred for display.
	flexinfer := targets["services/flexinfer"]
	if flexinfer.Kustomization != "flexinfer-system" {
		t.Errorf("flexinfer kustomization = %q, want flexinfer-system (owns workloads)", flexinfer.Kustomization)
	}
	if flexinfer.Workload == nil || flexinfer.Workload.Deployments != 2 {
		t.Fatalf("flexinfer workload = %#v, want 2 deployments", flexinfer.Workload)
	}
	if len(flexinfer.Workload.Namespaces) != 1 || flexinfer.Workload.Namespaces[0] != "flexinfer-system" {
		t.Errorf("flexinfer workload namespaces = %#v, want [flexinfer-system]", flexinfer.Workload.Namespaces)
	}

	// A source with no workloads keeps its targetNamespace and a nil workload.
	smarthome := targets["services/smarthome"]
	if smarthome.TargetNamespace != "home" {
		t.Errorf("smarthome targetNamespace = %q, want home", smarthome.TargetNamespace)
	}
	if smarthome.Workload != nil {
		t.Errorf("smarthome workload = %#v, want nil", smarthome.Workload)
	}
}

func TestBuildFluxTargetsWithoutWorkloads(t *testing.T) {
	t.Parallel()

	gitRepos, kustomizations := bindingFixtures()
	targets := buildFluxTargets(gitRepos, kustomizations, nil)

	// With no workload signal, the deterministic pick falls back to the
	// lexicographically smallest kustomization name.
	if flexinfer := targets["services/flexinfer"]; flexinfer.Kustomization != "flexinfer-models" {
		t.Errorf("flexinfer kustomization = %q, want flexinfer-models fallback", flexinfer.Kustomization)
	}
	if flexdeck := targets["services/flexdeck"]; flexdeck.Workload != nil {
		t.Errorf("flexdeck workload = %#v, want nil without deployments", flexdeck.Workload)
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
