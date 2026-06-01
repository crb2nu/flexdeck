package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

// When Langfuse is disabled (or no URL configured) every data handler must
// refuse with 503 rather than attempt an upstream call.
func TestLangfuseDataHandlers_DisabledReturn503(t *testing.T) {
	h := &Handler{cfg: &config.Config{}} // Langfuse.URL == "" => disabled

	handlers := map[string]http.HandlerFunc{
		"LangfuseMetrics": h.LangfuseMetrics,
		"LangfuseTraces":  h.LangfuseTraces,
		"LangfuseScores":  h.LangfuseScores,
		"LangfuseModels":  h.LangfuseModels,
	}

	for name, fn := range handlers {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/langfuse/"+name, nil)
			w := httptest.NewRecorder()
			fn(w, req)
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("%s: expected 503 when disabled, got %d", name, w.Code)
			}
			if !strings.Contains(w.Body.String(), "LANGFUSE_DISABLED") {
				t.Errorf("%s: expected LANGFUSE_DISABLED error code, got %s", name, w.Body.String())
			}
		})
	}
}

func TestLangfuseMetrics_SuccessPassesUpstreamBody(t *testing.T) {
	const payload = `{"data":[{"date":"2026-06-01","count":3}]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/public/metrics/daily") {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(payload))
	}))
	defer server.Close()

	h := &Handler{cfg: &config.Config{Langfuse: config.LangfuseConfig{URL: server.URL}}}
	req := httptest.NewRequest(http.MethodGet, "/api/langfuse/metrics?userId=abc", nil)
	w := httptest.NewRecorder()

	h.LangfuseMetrics(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if got := strings.TrimSpace(w.Body.String()); got != payload {
		t.Fatalf("expected upstream body passthrough, got %s", got)
	}
}

func TestLangfuseMetrics_UpstreamErrorStatusPropagates(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("boom"))
	}))
	defer server.Close()

	h := &Handler{cfg: &config.Config{Langfuse: config.LangfuseConfig{URL: server.URL}}}
	req := httptest.NewRequest(http.MethodGet, "/api/langfuse/metrics", nil)
	w := httptest.NewRecorder()

	h.LangfuseMetrics(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected upstream 500 to propagate, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "LANGFUSE_ERROR") {
		t.Errorf("expected LANGFUSE_ERROR code, got %s", w.Body.String())
	}
}
