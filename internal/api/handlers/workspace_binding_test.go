package handlers

import (
	"testing"

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

func TestBuildFluxTargets(t *testing.T) {
	t.Parallel()

	// Shapes mirror the live cluster: internal git host, sources in flux-system,
	// one source owning several kustomizations, mostly without targetNamespace.
	gitRepos := []unstructured.Unstructured{
		gitRepoObj("flexdeck", "flux-system", "http://gitlab-vm.gitlab.svc.cluster.local/services/flexdeck.git"),
		gitRepoObj("flexinfer", "flux-system", "http://gitlab-vm.gitlab.svc.cluster.local/services/flexinfer.git"),
		gitRepoObj("smarthome", "flux-system", "http://gitlab-vm.gitlab.svc.cluster.local/services/smarthome.git"),
	}
	kustomizations := []unstructured.Unstructured{
		ksObj("flexdeck", "flux-system", "flexdeck", "", ""),
		ksObj("flexinfer-system", "flux-system", "flexinfer", "", ""),
		ksObj("flexinfer-models", "flux-system", "flexinfer", "", ""),
		ksObj("smarthome", "flux-system", "smarthome", "flux-system", "home"),
	}

	targets := buildFluxTargets(gitRepos, kustomizations)

	flexdeck, ok := targets["services/flexdeck"]
	if !ok {
		t.Fatalf("missing services/flexdeck target: %#v", targets)
	}
	if flexdeck.SourceName != "flexdeck" || flexdeck.SourceNamespace != "flux-system" {
		t.Errorf("flexdeck source = %q/%q", flexdeck.SourceNamespace, flexdeck.SourceName)
	}
	if flexdeck.Kustomization != "flexdeck" || flexdeck.TargetNamespace != "" {
		t.Errorf("flexdeck ks = %q targetNS = %q", flexdeck.Kustomization, flexdeck.TargetNamespace)
	}

	// One source, two kustomizations, none name-matching -> smallest name wins.
	if flexinfer := targets["services/flexinfer"]; flexinfer.Kustomization != "flexinfer-models" {
		t.Errorf("flexinfer kustomization = %q, want flexinfer-models", flexinfer.Kustomization)
	}

	// targetNamespace propagates when the kustomization sets it.
	if smarthome := targets["services/smarthome"]; smarthome.TargetNamespace != "home" {
		t.Errorf("smarthome targetNamespace = %q, want home", smarthome.TargetNamespace)
	}
}

func TestBuildFluxTargetsSkipsUnparseableAndEmpty(t *testing.T) {
	t.Parallel()

	targets := buildFluxTargets(
		[]unstructured.Unstructured{gitRepoObj("blank", "flux-system", "")},
		nil,
	)
	if len(targets) != 0 {
		t.Fatalf("expected no targets for empty url, got %#v", targets)
	}
}
