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

func flightdeckTestRouter(h *Handler) chi.Router {
	r := chi.NewRouter()
	r.Route("/api/loom/flightdeck", func(r chi.Router) {
		r.Get("/board/summary", h.LoomFlightdeckBoardSummary)
		r.Get("/board/session/{id}", h.LoomFlightdeckBoardSession)
		r.Get("/context/rules", h.LoomFlightdeckContextRules)
	})
	return r
}

func TestLoomFlightdeckProxyInjectsBearerAndForwards(t *testing.T) {
	var gotAuth string
	var gotPaths []string
	fd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPaths = append(gotPaths, r.URL.Path)
		switch r.URL.Path {
		case "/api/v2/board/summary":
			_, _ = w.Write([]byte(`{"wait_minutes_today":3.5,"blocked_now_count":1}`))
		case "/api/v2/board/session/sess-1":
			_, _ = w.Write([]byte(`{"session_id":"sess-1","timeline":[]}`))
		case "/api/v2/context/rules":
			_, _ = w.Write([]byte(`{"rules":[]}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer fd.Close()

	h := &Handler{
		cfg:              &config.Config{Flightdeck: config.FlightdeckConfig{URL: fd.URL, Token: "secret-tok"}},
		flightdeckClient: loomupstream.NewFlightdeckClient(fd.URL, "secret-tok", fd.Client()),
	}
	router := flightdeckTestRouter(h)

	cases := []struct{ path, want string }{
		{"/api/loom/flightdeck/board/summary", "wait_minutes_today"},
		{"/api/loom/flightdeck/board/session/sess-1", "sess-1"},
		{"/api/loom/flightdeck/context/rules", "rules"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, c.path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", c.path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), c.want) {
			t.Fatalf("%s: body %q missing %q", c.path, rec.Body.String(), c.want)
		}
	}
	if gotAuth != "Bearer secret-tok" {
		t.Fatalf("bearer token not injected: got %q", gotAuth)
	}
	if len(gotPaths) != 3 {
		t.Fatalf("expected 3 upstream calls, got %v", gotPaths)
	}
}

func TestLoomFlightdeckDisabledReturns503(t *testing.T) {
	h := &Handler{
		cfg:              &config.Config{Flightdeck: config.FlightdeckConfig{Disabled: true}},
		flightdeckClient: loomupstream.NewFlightdeckClient("", "", nil),
	}
	rec := httptest.NewRecorder()
	flightdeckTestRouter(h).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/loom/flightdeck/board/summary", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 when flightdeck disabled, got %d", rec.Code)
	}
}

func TestLoomFlightdeckUpstreamErrorReturns502(t *testing.T) {
	fd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer fd.Close()
	h := &Handler{
		cfg:              &config.Config{Flightdeck: config.FlightdeckConfig{URL: fd.URL, Token: "x"}},
		flightdeckClient: loomupstream.NewFlightdeckClient(fd.URL, "x", fd.Client()),
	}
	rec := httptest.NewRecorder()
	flightdeckTestRouter(h).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/loom/flightdeck/board/summary", nil))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502 on upstream error, got %d", rec.Code)
	}
}
