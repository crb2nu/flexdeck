package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
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
	h := &Handler{cfg: cfg}

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
