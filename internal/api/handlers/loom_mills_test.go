package handlers

import (
	"io"
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

// millsMutationTestRouter mounts the slice-6 mutation handlers WITHOUT the RBAC
// admin middleware — these tests exercise the flag/token gating and the admin-
// bearer proxy. Route-level RBAC (rbac.RequirePermission(PermAdmin)) is enforced
// identically to the tested /api/rbac routes (router_phase4_test.go).
func millsMutationTestRouter(h *Handler) chi.Router {
	r := chi.NewRouter()
	r.Route("/api/loom/mills", func(r chi.Router) {
		r.Post("/pipeline/runs/{id}/pause", h.LoomMillsPipelinePause)
		r.Post("/pipeline/runs/{id}/escalate", h.LoomMillsPipelineEscalate)
		r.Post("/policy/kill-switch", h.LoomMillsKillSwitch)
	})
	return r
}

func TestLoomMillsMutationForwardsWithAdminBearer(t *testing.T) {
	var gotAuth, gotPath, gotBody string
	mills := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusAccepted) // operator status passes through
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer mills.Close()

	h := &Handler{
		cfg: &config.Config{Mills: config.MillsConfig{
			URL: mills.URL, AdminToken: "secret-admin", MutationsEnabled: true,
		}},
		millsClient: loomupstream.NewMillsClient(mills.URL, "secret-admin", mills.Client()),
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/loom/mills/pipeline/runs/run-9/escalate", strings.NewReader(`{"note":"stuck"}`))
	millsMutationTestRouter(h).ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("want 202 passthrough, got %d", rec.Code)
	}
	if gotAuth != "Bearer secret-admin" {
		t.Fatalf("admin bearer not forwarded: %q", gotAuth)
	}
	if gotPath != "/api/mills/pipeline/runs/run-9/escalate" {
		t.Fatalf("upstream path %q", gotPath)
	}
	if gotBody != `{"note":"stuck"}` {
		t.Fatalf("body not forwarded: %q", gotBody)
	}
	if !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Fatalf("passthrough body %q", rec.Body.String())
	}
}

func TestLoomMillsMutationDisabledReturns503(t *testing.T) {
	called := false
	mills := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		called = true
	}))
	defer mills.Close()

	// Token present but the mutations flag is OFF (the dark-launch default).
	h := &Handler{
		cfg: &config.Config{Mills: config.MillsConfig{
			URL: mills.URL, AdminToken: "secret", MutationsEnabled: false,
		}},
		millsClient: loomupstream.NewMillsClient(mills.URL, "secret", mills.Client()),
	}
	rec := httptest.NewRecorder()
	millsMutationTestRouter(h).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/loom/mills/policy/kill-switch", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 when mutations disabled, got %d", rec.Code)
	}
	if called {
		t.Fatal("upstream must not be called when mutations are disabled")
	}
}

func TestLoomMillsMutationUpstreamAuthMapsTo502(t *testing.T) {
	// The operator rejecting flexdeck's admin token must NOT pass 401/403 through
	// to the browser (which would trip the RBAC login gate) — map it to 502.
	for _, code := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		mills := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(code)
		}))
		h := &Handler{
			cfg: &config.Config{Mills: config.MillsConfig{
				URL: mills.URL, AdminToken: "secret", MutationsEnabled: true,
			}},
			millsClient: loomupstream.NewMillsClient(mills.URL, "secret", mills.Client()),
		}
		rec := httptest.NewRecorder()
		millsMutationTestRouter(h).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/loom/mills/policy/kill-switch", nil))
		if rec.Code != http.StatusBadGateway {
			t.Fatalf("upstream %d: want 502, got %d", code, rec.Code)
		}
		mills.Close()
	}
}

func TestLoomMillsMutationNoAdminTokenReturns503(t *testing.T) {
	// Flag ON but no admin token configured -> CanMutate is false -> 503.
	h := &Handler{
		cfg: &config.Config{Mills: config.MillsConfig{
			URL: "http://mills.invalid", MutationsEnabled: true,
		}},
		millsClient: loomupstream.NewMillsClient("http://mills.invalid", "", nil),
	}
	rec := httptest.NewRecorder()
	millsMutationTestRouter(h).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/loom/mills/pipeline/runs/x/pause", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 without an admin token, got %d", rec.Code)
	}
}
