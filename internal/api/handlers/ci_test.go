package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestCIHandlers(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/projects") {
			fmt.Fprint(w, `[{"id": 1, "path_with_namespace": "org/repo", "web_url": "http://gitlab.com/org/repo"}]`)
		} else if strings.Contains(r.URL.Path, "/pipelines") {
			fmt.Fprint(w, `[{"id": 100, "status": "success", "ref": "main", "created_at": "2026-01-01T00:00:00Z"}]`)
		} else {
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer ts.Close()

	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "test-token"
	h := &Handler{cfg: cfg, gitlabClient: newGitLabClient()}

	t.Run("ListRepositories", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/ci/repos", nil)
		rr := httptest.NewRecorder()
		h.ListRepositories(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
		if !strings.Contains(rr.Body.String(), "org/repo") {
			t.Errorf("expected repo name in response")
		}
	})

	t.Run("GetRepoPipeline", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/ci/repo/1/pipeline", nil)
		// chi context would normally set this
		rr := httptest.NewRecorder()
		h.GetRepoPipeline(rr, req)

		// Note: Without chi context, chi.URLParam returns empty string,
		// but fetchRepoPipeline still works if passed manually.
		// This test confirms basic wiring.
		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
	})

	t.Run("GitLabUnconfigured", func(t *testing.T) {
		h_none := &Handler{cfg: &config.Config{}}
		req := httptest.NewRequest(http.MethodGet, "/api/ci/repos", nil)
		rr := httptest.NewRecorder()
		h_none.ListRepositories(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200 (empty list) for unconfigured gitlab, got %d", rr.Code)
		}
	})
}

func TestFetchRepoPipeline_UsesStageOrderFromGitLabCI(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		switch {
		case strings.Contains(r.URL.Path, "/pipelines/555/jobs"):
			fmt.Fprint(w, `[
				{"id": 3001, "name": "deploy_staging", "stage": "deploy", "status": "created"},
				{"id": 3002, "name": "unit_tests", "stage": "test", "status": "created"},
				{"id": 3003, "name": "lint_code", "stage": "lint", "status": "running"}
			]`)
		case strings.Contains(r.URL.Path, "/pipelines"):
			fmt.Fprint(w, `[{"id": 555, "status": "running", "ref": "main", "created_at": "2026-01-01T00:00:00Z"}]`)
		case strings.Contains(r.URL.Path, "/repository/files/.gitlab-ci.yml/raw"):
			w.Header().Set("Content-Type", "text/plain")
			fmt.Fprint(w, "stages:\n  - lint\n  - test\n  - deploy\n")
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer ts.Close()

	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "test-token"
	h := &Handler{cfg: cfg, gitlabClient: newGitLabClient()}

	resp, err := h.fetchRepoPipeline(context.Background(), "1")
	if err != nil {
		t.Fatalf("fetchRepoPipeline returned error: %v", err)
	}

	raw, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}

	var got struct {
		Stages []struct {
			Name string `json:"name"`
		} `json:"stages"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	stageNames := make([]string, 0, len(got.Stages))
	for _, stage := range got.Stages {
		stageNames = append(stageNames, stage.Name)
	}

	want := []string{"lint", "test", "deploy"}
	if !reflect.DeepEqual(stageNames, want) {
		t.Fatalf("unexpected stage order: got %v want %v", stageNames, want)
	}
}
