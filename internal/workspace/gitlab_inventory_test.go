package workspace

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestScanGitLab(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v4/projects", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("PRIVATE-TOKEN") == "" {
			t.Errorf("missing PRIVATE-TOKEN header")
		}
		if r.URL.Query().Get("page") != "1" {
			_, _ = w.Write([]byte(`[]`))
			return
		}
		_, _ = w.Write([]byte(`[
			{"id":1,"path":"loom","path_with_namespace":"services/loom","default_branch":"main","web_url":"https://gl/services/loom"},
			{"id":2,"path":"fi-accel","path_with_namespace":"libs/fi-accel","default_branch":"trunk","web_url":"https://gl/libs/fi-accel"},
			{"id":3,"path":"nested","path_with_namespace":"services/sub/nested","default_branch":"main","web_url":"https://gl/x"},
			{"id":4,"path":"other","path_with_namespace":"platform/other","default_branch":"main","web_url":"https://gl/y"}
		]`))
	})
	mux.HandleFunc("/api/v4/projects/1/repository/tree", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`[{"name":"go.mod","type":"blob"},{"name":"README.md","type":"blob"},{"name":".gitlab-ci.yml","type":"blob"},{"name":"AGENTS.md","type":"blob"}]`))
	})
	mux.HandleFunc("/api/v4/projects/2/repository/tree", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`[{"name":"Cargo.toml","type":"blob"}]`))
	})
	mux.HandleFunc("/api/v4/projects/1/languages", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"Go":90.0,"Shell":10.0}`))
	})
	mux.HandleFunc("/api/v4/projects/2/languages", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"Rust":100.0}`))
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	inv, err := ScanGitLab(context.Background(), GitLabScanOptions{
		BaseURL: ts.URL,
		Token:   "test-token",
		Buckets: []string{"services", "libs"},
	})
	if err != nil {
		t.Fatalf("ScanGitLab: %v", err)
	}

	// Only top-level services/* and libs/* repos — nested subgroup + platform/* excluded.
	if inv.Totals.Repositories != 2 {
		t.Fatalf("want 2 repos, got %d (%+v)", inv.Totals.Repositories, inv.Repositories)
	}
	if inv.Totals.Services != 1 || inv.Totals.Libs != 1 {
		t.Fatalf("bucket totals = %+v", inv.Totals)
	}

	byName := map[string]Repository{}
	for _, r := range inv.Repositories {
		byName[r.Name] = r
	}

	loom, ok := byName["loom"]
	if !ok {
		t.Fatal("loom missing")
	}
	if loom.Bucket != "services" {
		t.Errorf("loom bucket = %q", loom.Bucket)
	}
	if !loom.Git.IsRepository || loom.Git.Branch != "main" || !loom.Git.Clean {
		t.Errorf("loom git = %+v", loom.Git)
	}
	if len(loom.Git.Remotes) != 1 || loom.Git.Remotes[0].URL != "https://gl/services/loom" {
		t.Errorf("loom remotes = %+v", loom.Git.Remotes)
	}
	if loom.PrimaryLanguage != "go" {
		t.Errorf("loom primaryLanguage = %q, want go", loom.PrimaryLanguage)
	}
	if !loom.Docs.Agents || !loom.Docs.Readme {
		t.Errorf("loom docs = %+v", loom.Docs)
	}
	if !hasManifestFile(loom, ".gitlab-ci.yml") || !hasManifestFile(loom, "go.mod") {
		t.Errorf("loom manifests = %+v", loom.Manifests)
	}

	fi, ok := byName["fi-accel"]
	if !ok {
		t.Fatal("fi-accel missing")
	}
	if fi.Bucket != "libs" || fi.Git.Branch != "trunk" || fi.PrimaryLanguage != "rust" {
		t.Errorf("fi-accel = bucket %q branch %q lang %q", fi.Bucket, fi.Git.Branch, fi.PrimaryLanguage)
	}
}

func TestScanGitLabRequiresConfig(t *testing.T) {
	if _, err := ScanGitLab(context.Background(), GitLabScanOptions{Token: "t"}); err == nil {
		t.Error("expected error when BaseURL empty")
	}
	if _, err := ScanGitLab(context.Background(), GitLabScanOptions{BaseURL: "https://gl"}); err == nil {
		t.Error("expected error when Token empty")
	}
}

func hasManifestFile(r Repository, file string) bool {
	for _, m := range r.Manifests {
		if m.Path == file {
			return true
		}
	}
	return false
}
