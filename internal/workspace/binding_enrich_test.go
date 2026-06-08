package workspace

import "testing"

func TestProjectPathFromURL(t *testing.T) {
	t.Parallel()

	cases := map[string]string{
		"http://gitlab-vm.gitlab.svc.cluster.local/services/flexdeck.git": "services/flexdeck",
		"https://gitlab.flexinfer.ai/services/flexdeck":                   "services/flexdeck",
		"git@gitlab.flexinfer.ai:services/flexdeck.git":                   "services/flexdeck",
		"https://user:token@gitlab.flexinfer.ai/libs/visual-kit.git":      "libs/visual-kit",
		"": "",
	}
	for input, want := range cases {
		if got := ProjectPathFromURL(input); got != want {
			t.Errorf("ProjectPathFromURL(%q) = %q, want %q", input, got, want)
		}
	}
}

func serviceInventory() *Inventory {
	return &Inventory{
		Repositories: []Repository{
			{
				Name: "flexdeck", Bucket: BucketServices,
				Binding: &RepoBinding{
					Kind: BindingKindService, Confidence: BindingConfidenceInferred,
					GitLabProject: "services/flexdeck", Namespace: "flexdeck",
					FluxSource: "flexdeck", Kustomization: "flexdeck", Signals: []string{"repo-name"},
				},
			},
			{
				Name: "orphan", Bucket: BucketServices,
				Binding: &RepoBinding{
					Kind: BindingKindService, Confidence: BindingConfidenceInferred,
					GitLabProject: "services/orphan", Namespace: "orphan",
					FluxSource: "orphan", Signals: []string{"repo-name"},
				},
			},
			{
				Name: "visual-kit", Bucket: BucketLibs,
				Binding: &RepoBinding{
					Kind: BindingKindLibrary, Confidence: BindingConfidenceNone,
					GitLabProject: "libs/visual-kit", Signals: []string{"bucket"},
				},
			},
		},
	}
}

func TestEnrichBindingsVerifiesMatchedService(t *testing.T) {
	t.Parallel()

	inv := serviceInventory()
	EnrichBindings(inv, map[string]FluxTarget{
		"services/flexdeck": {
			ProjectPath: "services/flexdeck", SourceName: "flexdeck", SourceNamespace: "flux-system",
			Kustomization: "flexdeck", TargetNamespace: "deck-system",
		},
	})

	flexdeck := inv.Repositories[0].Binding
	if flexdeck.Confidence != BindingConfidenceVerified {
		t.Fatalf("confidence = %q, want verified", flexdeck.Confidence)
	}
	if flexdeck.FluxSource != "flexdeck" || flexdeck.FluxNamespace != "flux-system" {
		t.Fatalf("flux source/ns = %q/%q", flexdeck.FluxSource, flexdeck.FluxNamespace)
	}
	if flexdeck.Kustomization != "flexdeck" {
		t.Fatalf("kustomization = %q, want flexdeck", flexdeck.Kustomization)
	}
	if flexdeck.Namespace != "deck-system" {
		t.Fatalf("namespace = %q, want targetNamespace deck-system", flexdeck.Namespace)
	}
	if !equalStrings(flexdeck.Signals, []string{"repo-name", "flux-source", "flux-kustomization"}) {
		t.Fatalf("signals = %#v", flexdeck.Signals)
	}

	if orphan := inv.Repositories[1].Binding; orphan.Confidence != BindingConfidenceInferred {
		t.Fatalf("unmatched service confidence = %q, want inferred", orphan.Confidence)
	}
	if lib := inv.Repositories[2].Binding; lib.Confidence != BindingConfidenceNone || lib.Kind != BindingKindLibrary {
		t.Fatalf("library binding was altered: %#v", lib)
	}
}

func TestEnrichBindingsKeepsInferredNamespaceWithoutTargetNamespace(t *testing.T) {
	t.Parallel()

	inv := serviceInventory()
	EnrichBindings(inv, map[string]FluxTarget{
		// Case-insensitive project path; no targetNamespace set.
		"services/flexdeck": {
			ProjectPath: "services/flexdeck", SourceName: "flexdeck", SourceNamespace: "flux-system",
			Kustomization: "flexdeck",
		},
	})

	flexdeck := inv.Repositories[0].Binding
	if flexdeck.Confidence != BindingConfidenceVerified {
		t.Fatalf("confidence = %q, want verified", flexdeck.Confidence)
	}
	if flexdeck.Namespace != "flexdeck" {
		t.Fatalf("namespace = %q, want inferred flexdeck preserved", flexdeck.Namespace)
	}
}

func TestEnrichBindingsNoTargetsIsNoop(t *testing.T) {
	t.Parallel()

	inv := serviceInventory()
	EnrichBindings(inv, nil)
	if inv.Repositories[0].Binding.Confidence != BindingConfidenceInferred {
		t.Fatalf("nil targets should leave bindings inferred")
	}
}
