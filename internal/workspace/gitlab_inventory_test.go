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

func TestScanGitLabComputesAdoption(t *testing.T) {
	// A service whose go.mod requires a workspace lib's module path must be
	// linked to that lib — proving adoption works from the GitLab API source
	// (no local checkout), the prod-default path.
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v4/projects", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("page") != "1" {
			_, _ = w.Write([]byte(`[]`))
			return
		}
		_, _ = w.Write([]byte(`[
			{"id":1,"path":"loom","path_with_namespace":"services/loom","default_branch":"main","web_url":"https://gl/services/loom"},
			{"id":2,"path":"mcp-go","path_with_namespace":"libs/mcp-go","default_branch":"main","web_url":"https://gl/libs/mcp-go"},
			{"id":3,"path":"ts-resilience","path_with_namespace":"libs/ts-resilience","default_branch":"main","web_url":"https://gl/libs/ts-resilience"}
		]`))
	})
	// Both buckets carry go.mod in their tree.
	for _, id := range []string{"1", "2", "3"} {
		mux.HandleFunc("/api/v4/projects/"+id+"/repository/tree", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`[{"name":"go.mod","type":"blob"}]`))
		})
		mux.HandleFunc("/api/v4/projects/"+id+"/languages", func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte(`{"Go":100.0}`))
		})
	}
	// Raw manifest contents: the service requires mcp-go's module path; the libs
	// declare their module paths. ts-resilience is required by no one (orphan).
	mux.HandleFunc("/api/v4/projects/1/repository/files/go.mod/raw", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("module gitlab.flexinfer.ai/services/loom\n\nrequire gitlab.flexinfer.ai/libs/mcp-go v0.1.0\n"))
	})
	mux.HandleFunc("/api/v4/projects/2/repository/files/go.mod/raw", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("module gitlab.flexinfer.ai/libs/mcp-go\n"))
	})
	mux.HandleFunc("/api/v4/projects/3/repository/files/go.mod/raw", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("module gitlab.flexinfer.ai/libs/ts-resilience\n"))
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

	byName := map[string]Repository{}
	for _, r := range inv.Repositories {
		byName[r.Name] = r
	}

	loom := byName["loom"]
	if len(loom.DependsOn) != 1 || loom.DependsOn[0] != "mcp-go" {
		t.Errorf("loom.DependsOn = %v, want [mcp-go]", loom.DependsOn)
	}
	mcpGo := byName["mcp-go"]
	if len(mcpGo.UsedBy) != 1 || mcpGo.UsedBy[0] != "loom" {
		t.Errorf("mcp-go.UsedBy = %v, want [loom]", mcpGo.UsedBy)
	}
	if orphan := byName["ts-resilience"]; len(orphan.UsedBy) != 0 {
		t.Errorf("ts-resilience.UsedBy = %v, want none (orphan lib)", orphan.UsedBy)
	}
}

func TestScanGitLabRejectsDeadlineExhaustedPartialScan(t *testing.T) {
	// Regression: when per-repo calls outlive the context, the scan used to
	// return a partial inventory (repos with errors, no manifests) that the
	// handler then cached for the full TTL + stale window.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v4/projects", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("page") != "1" {
			_, _ = w.Write([]byte(`[]`))
			return
		}
		_, _ = w.Write([]byte(`[
			{"id":1,"path":"loom","path_with_namespace":"services/loom","default_branch":"main","web_url":"https://gl/services/loom"}
		]`))
	})
	mux.HandleFunc("/api/v4/projects/1/repository/tree", func(w http.ResponseWriter, r *http.Request) {
		cancel() // the per-repo phase exhausts the caller's budget
		<-r.Context().Done()
	})
	mux.HandleFunc("/api/v4/projects/1/languages", func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	})
	ts := httptest.NewServer(mux)
	defer ts.Close()

	inv, err := ScanGitLab(ctx, GitLabScanOptions{
		BaseURL: ts.URL,
		Token:   "test-token",
		Buckets: []string{"services", "libs"},
	})
	if err == nil {
		t.Fatalf("expected error for deadline-exhausted scan, got inventory with %d repos", inv.Totals.Repositories)
	}
}
