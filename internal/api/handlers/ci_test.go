package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestCIHandlers(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/projects") {
			if _, err := fmt.Fprint(w, `[{"id": 1, "path_with_namespace": "org/repo", "web_url": "http://gitlab.com/org/repo"}]`); err != nil {
				t.Errorf("write projects response: %v", err)
			}
		} else if strings.Contains(r.URL.Path, "/pipelines") {
			if _, err := fmt.Fprint(w, `[{"id": 100, "status": "success", "ref": "main", "created_at": "2026-01-01T00:00:00Z"}]`); err != nil {
				t.Errorf("write pipelines response: %v", err)
			}
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
			if _, err := fmt.Fprint(w, `[
				{"id": 3001, "name": "deploy_staging", "stage": "deploy", "status": "created"},
				{"id": 3002, "name": "unit_tests", "stage": "test", "status": "created"},
				{"id": 3003, "name": "lint_code", "stage": "lint", "status": "running"}
			]`); err != nil {
				t.Errorf("write jobs response: %v", err)
			}
		case strings.Contains(r.URL.Path, "/pipelines"):
			if _, err := fmt.Fprint(w, `[{"id": 555, "status": "running", "ref": "main", "created_at": "2026-01-01T00:00:00Z"}]`); err != nil {
				t.Errorf("write pipelines response: %v", err)
			}
		case strings.Contains(r.URL.Path, "/repository/files/.gitlab-ci.yml/raw"):
			w.Header().Set("Content-Type", "text/plain")
			if _, err := fmt.Fprint(w, "stages:\n  - lint\n  - test\n  - deploy\n"); err != nil {
				t.Errorf("write gitlab-ci response: %v", err)
			}
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

func TestGetRepoConfigFetchesDefaultBranchConfig(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("PRIVATE-TOKEN") != "test-token" {
			t.Errorf("missing private token on %s", r.URL.String())
			http.Error(w, "missing token", http.StatusUnauthorized)
			return
		}

		switch {
		case r.URL.Path == "/api/v4/projects/42":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `{"default_branch":"trunk"}`)
		case r.URL.Path == "/api/v4/projects/42/repository/files/.gitlab-ci.yml/raw":
			if r.URL.Query().Get("ref") != "trunk" {
				t.Errorf("expected ref=trunk, got %q", r.URL.Query().Get("ref"))
				http.Error(w, "bad ref", http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "text/plain")
			_, _ = fmt.Fprint(w, "stages:\n  - test\n")
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "test-token"
	h := &Handler{cfg: cfg, gitlabClient: ts.Client()}

	req := requestWithCIParams(http.MethodGet, "/api/ci/repos/42/config", nil, map[string]string{"id": "42"})
	w := httptest.NewRecorder()
	h.GetRepoConfig(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		ID            int    `json:"id"`
		HasConfig     bool   `json:"hasConfig"`
		ConfigContent string `json:"configContent"`
	}
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode config response: %v", err)
	}
	if got.ID != 42 || !got.HasConfig || !strings.Contains(got.ConfigContent, "- test") {
		t.Fatalf("unexpected config response: %+v", got)
	}
}

func TestGetRepoConfigMissingFileReturnsNoConfig(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v4/projects/77":
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprint(w, `{"default_branch":"main"}`)
		case r.URL.Path == "/api/v4/projects/77/repository/files/.gitlab-ci.yml/raw":
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "test-token"
	h := &Handler{cfg: cfg, gitlabClient: ts.Client()}

	req := requestWithCIParams(http.MethodGet, "/api/ci/repos/77/config", nil, map[string]string{"id": "77"})
	w := httptest.NewRecorder()
	h.GetRepoConfig(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		ID        int  `json:"id"`
		HasConfig bool `json:"hasConfig"`
	}
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode config response: %v", err)
	}
	if got.ID != 77 || got.HasConfig {
		t.Fatalf("expected missing config contract, got %+v", got)
	}
}

func TestBatchPipelinesFiltersIDsAndReturnsPerProjectResults(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/v4/projects/1/pipelines":
			_, _ = fmt.Fprint(w, `[{"id":100,"status":"success","ref":"main","created_at":"2026-01-01T00:00:00Z"}]`)
		case r.URL.Path == "/api/v4/projects/1/pipelines/100/jobs":
			_, _ = fmt.Fprint(w, `[{"id":200,"name":"unit","stage":"test","status":"success","duration":12.5}]`)
		case r.URL.Path == "/api/v4/projects/1/repository/files/.gitlab-ci.yml/raw":
			w.Header().Set("Content-Type", "text/plain")
			_, _ = fmt.Fprint(w, "stages:\n  - test\n")
		case r.URL.Path == "/api/v4/projects/2/pipelines":
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = fmt.Fprint(w, `{"message":"boom"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	cfg := &config.Config{}
	cfg.GitLab.URL = ts.URL
	cfg.GitLab.Token = "test-token"
	h := &Handler{cfg: cfg, gitlabClient: ts.Client()}

	req := httptest.NewRequest(http.MethodGet, "/api/ci/pipelines/batch?ids=1,%20,2", nil)
	w := httptest.NewRecorder()
	h.BatchPipelines(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		Pipelines map[string]json.RawMessage `json:"pipelines"`
	}
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode batch response: %v", err)
	}
	if len(got.Pipelines) != 2 {
		t.Fatalf("expected filtered ids 1 and 2, got %v", got.Pipelines)
	}
	var projectOne struct {
		ID     string `json:"id"`
		Status string `json:"status"`
		Stages []struct {
			Name string `json:"name"`
		} `json:"stages"`
	}
	if err := json.Unmarshal(got.Pipelines["1"], &projectOne); err != nil {
		t.Fatalf("decode project 1: %v", err)
	}
	if projectOne.ID != "100" || projectOne.Status != "success" || len(projectOne.Stages) != 1 || projectOne.Stages[0].Name != "test" {
		t.Fatalf("unexpected project 1 pipeline: %+v", projectOne)
	}
	var projectTwo struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(got.Pipelines["2"], &projectTwo); err != nil {
		t.Fatalf("decode project 2: %v", err)
	}
	if !strings.Contains(projectTwo.Error, "GitLab API error") {
		t.Fatalf("expected per-project error, got %+v", projectTwo)
	}
}

func TestBatchPipelinesEmptyIDsReturnsEmptyMap(t *testing.T) {
	h := &Handler{cfg: &config.Config{}, gitlabClient: newGitLabClient()}
	req := httptest.NewRequest(http.MethodGet, "/api/ci/pipelines/batch?ids=,%20", nil)
	w := httptest.NewRecorder()
	h.BatchPipelines(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		Pipelines map[string]any `json:"pipelines"`
	}
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode batch response: %v", err)
	}
	if len(got.Pipelines) != 0 {
		t.Fatalf("expected empty pipelines map, got %+v", got.Pipelines)
	}
}

func requestWithCIParams(method, target string, body []byte, params map[string]string) *http.Request {
	req := httptest.NewRequest(method, target, bytes.NewReader(body))
	routeCtx := chi.NewRouteContext()
	for key, value := range params {
		routeCtx.URLParams.Add(key, value)
	}
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}
