package workspace

import (
	"context"
	"path/filepath"
	"testing"
)

func TestDeriveBindingForServices(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name          string
		repo          Repository
		wantKind      BindingKind
		wantConf      BindingConfidence
		wantNamespace string
		wantFlux      string
		wantProject   string
		wantMatchKey  string
		wantSignals   []string
	}{
		{
			name: "https remote",
			repo: Repository{
				Name:   "flexdeck",
				Bucket: BucketServices,
				Git: GitState{Remotes: []GitRemote{
					{Name: "origin", URL: "https://gitlab.flexinfer.ai/services/flexdeck.git"},
				}},
			},
			wantKind:      BindingKindService,
			wantConf:      BindingConfidenceInferred,
			wantNamespace: "flexdeck",
			wantFlux:      "flexdeck",
			wantProject:   "services/flexdeck",
			wantMatchKey:  "gitlab.flexinfer.ai/services/flexdeck",
			wantSignals:   []string{"repo-name", "gitlab-path", "remote-url"},
		},
		{
			name: "scp remote",
			repo: Repository{
				Name:   "flexinfer",
				Bucket: BucketServices,
				Git: GitState{Remotes: []GitRemote{
					{Name: "origin", URL: "git@gitlab.flexinfer.ai:services/flexinfer.git"},
				}},
			},
			wantKind:      BindingKindService,
			wantConf:      BindingConfidenceInferred,
			wantNamespace: "flexinfer",
			wantFlux:      "flexinfer",
			wantProject:   "services/flexinfer",
			wantMatchKey:  "gitlab.flexinfer.ai/services/flexinfer",
			wantSignals:   []string{"repo-name", "gitlab-path", "remote-url"},
		},
		{
			name: "no remote falls back to bucket/name",
			repo: Repository{
				Name:   "loom-core",
				Bucket: BucketServices,
			},
			wantKind:      BindingKindService,
			wantConf:      BindingConfidenceInferred,
			wantNamespace: "loom-core",
			wantFlux:      "loom-core",
			wantProject:   "services/loom-core",
			wantMatchKey:  "",
			wantSignals:   []string{"repo-name"},
		},
		{
			name: "mixed-case name is sanitized",
			repo: Repository{
				Name:   "Story_Board",
				Bucket: BucketServices,
			},
			wantKind:      BindingKindService,
			wantConf:      BindingConfidenceInferred,
			wantNamespace: "story-board",
			wantFlux:      "story-board",
			wantProject:   "services/Story_Board",
			wantMatchKey:  "",
			wantSignals:   []string{"repo-name"},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := deriveBinding(tc.repo)
			if got == nil {
				t.Fatalf("deriveBinding returned nil")
			}
			if got.Kind != tc.wantKind {
				t.Errorf("kind = %q, want %q", got.Kind, tc.wantKind)
			}
			if got.Confidence != tc.wantConf {
				t.Errorf("confidence = %q, want %q", got.Confidence, tc.wantConf)
			}
			if got.Namespace != tc.wantNamespace {
				t.Errorf("namespace = %q, want %q", got.Namespace, tc.wantNamespace)
			}
			if got.FluxSource != tc.wantFlux {
				t.Errorf("fluxSource = %q, want %q", got.FluxSource, tc.wantFlux)
			}
			if got.Kustomization != tc.wantFlux {
				t.Errorf("kustomization = %q, want %q", got.Kustomization, tc.wantFlux)
			}
			if got.GitLabProject != tc.wantProject {
				t.Errorf("gitlabProject = %q, want %q", got.GitLabProject, tc.wantProject)
			}
			if got.MatchKey != tc.wantMatchKey {
				t.Errorf("matchKey = %q, want %q", got.MatchKey, tc.wantMatchKey)
			}
			if !equalStrings(got.Signals, tc.wantSignals) {
				t.Errorf("signals = %#v, want %#v", got.Signals, tc.wantSignals)
			}
		})
	}
}

func TestDeriveBindingForLibrary(t *testing.T) {
	t.Parallel()

	got := deriveBinding(Repository{
		Name:   "visual-kit",
		Bucket: BucketLibs,
		Git: GitState{Remotes: []GitRemote{
			{Name: "origin", URL: "https://gitlab.flexinfer.ai/libs/visual-kit.git"},
		}},
	})
	if got == nil {
		t.Fatalf("deriveBinding returned nil")
	}
	if got.Kind != BindingKindLibrary {
		t.Errorf("kind = %q, want %q", got.Kind, BindingKindLibrary)
	}
	if got.Confidence != BindingConfidenceNone {
		t.Errorf("confidence = %q, want %q", got.Confidence, BindingConfidenceNone)
	}
	if got.Namespace != "" || got.FluxSource != "" {
		t.Errorf("library should have no cluster target, got ns=%q flux=%q", got.Namespace, got.FluxSource)
	}
	if got.GitLabProject != "libs/visual-kit" {
		t.Errorf("gitlabProject = %q, want libs/visual-kit", got.GitLabProject)
	}
}

func TestScanPopulatesBinding(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeFile(t, filepath.Join(root, "services", "api", "go.mod"), "module example.com/api\n")
	writeFile(t, filepath.Join(root, "libs", "ui", "package.json"), `{"name":"ui"}`)

	inv, err := Scan(context.Background(), root, ScanOptions{})
	if err != nil {
		t.Fatalf("Scan returned error: %v", err)
	}

	api := findRepo(t, inv, "services", "api")
	if api.Binding == nil || api.Binding.Kind != BindingKindService {
		t.Fatalf("expected service binding for api, got %#v", api.Binding)
	}
	if api.Binding.Namespace != "api" || api.Binding.FluxSource != "api" {
		t.Fatalf("unexpected inferred target: %#v", api.Binding)
	}

	ui := findRepo(t, inv, "libs", "ui")
	if ui.Binding == nil || ui.Binding.Kind != BindingKindLibrary {
		t.Fatalf("expected library binding for ui, got %#v", ui.Binding)
	}
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}
