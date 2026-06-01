package handlers

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

// When Loki is disabled (or no URL configured) every handler must refuse with
// 503 rather than attempt an upstream call.
func TestLokiHandlers_DisabledReturn503(t *testing.T) {
	h := &Handler{cfg: &config.Config{}} // Loki.URL == "" => disabled

	handlers := map[string]http.HandlerFunc{
		"LokiLabels":      h.LokiLabels,
		"LokiLabelValues": h.LokiLabelValues,
		"LokiQuery":       h.LokiQuery,
		"LokiQueryRange":  h.LokiQueryRange,
		"LokiTailSSE":     h.LokiTailSSE,
		"LokiExport":      h.LokiExport,
	}

	for name, fn := range handlers {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/loki/"+name+"?query=%7Bapp%3D%22x%22%7D", nil)
			w := httptest.NewRecorder()
			fn(w, req)
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("%s: expected 503 when disabled, got %d", name, w.Code)
			}
		})
	}
}

func TestLokiQuery_MissingQueryParamReturns400(t *testing.T) {
	h := &Handler{cfg: &config.Config{Loki: config.LokiConfig{URL: "http://loki.invalid"}}}
	req := httptest.NewRequest(http.MethodGet, "/api/loki/query", nil) // no query param
	w := httptest.NewRecorder()

	h.LokiQuery(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing query, got %d", w.Code)
	}
}

func TestLokiQuery_SuccessProxiesUpstream(t *testing.T) {
	const payload = `{"status":"success","data":{"resultType":"streams","result":[]}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/loki/api/v1/query") {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		if r.URL.Query().Get("query") == "" {
			t.Error("expected query param forwarded to upstream")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(payload))
	}))
	defer server.Close()

	h := &Handler{cfg: &config.Config{Loki: config.LokiConfig{URL: server.URL}}}
	req := httptest.NewRequest(http.MethodGet, `/api/loki/query?query=%7Bapp%3D%22x%22%7D&limit=10`, nil)
	w := httptest.NewRecorder()

	h.LokiQuery(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"status":"success"`) {
		t.Fatalf("expected upstream body proxied, got %s", w.Body.String())
	}
}

func TestLokiLabels_SuccessProxiesUpstream(t *testing.T) {
	const payload = `{"status":"success","data":["app","namespace"]}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/loki/api/v1/labels") {
			t.Errorf("unexpected upstream path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(payload))
	}))
	defer server.Close()

	h := &Handler{cfg: &config.Config{Loki: config.LokiConfig{URL: server.URL}}}
	req := httptest.NewRequest(http.MethodGet, "/api/loki/labels", nil)
	w := httptest.NewRecorder()

	h.LokiLabels(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "namespace") {
		t.Fatalf("expected labels payload proxied, got %s", w.Body.String())
	}
}
