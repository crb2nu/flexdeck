package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/loomupstream"
)

func millsTestRouter(h *Handler) chi.Router {
	r := chi.NewRouter()
	r.Route("/api/loom/mills", func(r chi.Router) {
		r.Get("/status", h.LoomMillsStatus)
		r.Get("/backlog", h.LoomMillsBacklog)
		r.Get("/pipeline/runs/{id}", h.LoomMillsPipelineRun)
		r.Get("/council/runs/{id}/debate", h.LoomMillsCouncilDebate)
	})
	return r
}

func TestLoomMillsProxyForwardsAndPassesThrough(t *testing.T) {
	var gotPaths []string
	mills := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPaths = append(gotPaths, r.URL.Path)
		switch r.URL.Path {
		case "/api/mills/status":
			_, _ = w.Write([]byte(`{"autonomy_ready":true,"active_pipeline_runs":1}`))
		case "/api/mills/pipeline/runs/run-7":
			_, _ = w.Write([]byte(`{"run":{"ID":"run-7"},"stages":[{"Stage":"implement"}]}`))
		case "/api/mills/council/runs/c-3/debate":
			_, _ = w.Write([]byte(`[{"RoundIndex":0,"Role":"proposer","Summary":"hi"}]`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer mills.Close()

	h := &Handler{
		cfg:         &config.Config{Mills: config.MillsConfig{URL: mills.URL}},
		millsClient: loomupstream.NewMillsClient(mills.URL, "", mills.Client()),
	}
	router := millsTestRouter(h)

	cases := []struct {
		path      string
		wantField string
	}{
		{"/api/loom/mills/status", "autonomy_ready"},
		{"/api/loom/mills/pipeline/runs/run-7", "run-7"},        // param forwarded
		{"/api/loom/mills/council/runs/c-3/debate", "proposer"}, // nested param forwarded
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, c.path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", c.path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), c.wantField) {
			t.Fatalf("%s: body %q missing %q", c.path, rec.Body.String(), c.wantField)
		}
	}
	if len(gotPaths) != 3 {
		t.Fatalf("expected 3 upstream calls, got %v", gotPaths)
	}
}

func TestLoomMillsDisabledReturns503(t *testing.T) {
	h := &Handler{
		cfg:         &config.Config{Mills: config.MillsConfig{Disabled: true}},
		millsClient: loomupstream.NewMillsClient("", "", nil),
	}
	rec := httptest.NewRecorder()
	millsTestRouter(h).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/loom/mills/status", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 when mills disabled, got %d", rec.Code)
	}
}

func TestLoomMillsUpstreamErrorReturns502(t *testing.T) {
	mills := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer mills.Close()
	h := &Handler{
		cfg:         &config.Config{Mills: config.MillsConfig{URL: mills.URL}},
		millsClient: loomupstream.NewMillsClient(mills.URL, "", mills.Client()),
	}
	rec := httptest.NewRecorder()
	millsTestRouter(h).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/loom/mills/status", nil))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502 on upstream error, got %d", rec.Code)
	}
}
