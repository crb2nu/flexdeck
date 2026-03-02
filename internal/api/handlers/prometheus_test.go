package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestPrometheusHandlers(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/healthy") {
			w.WriteHeader(http.StatusOK)
		} else if strings.Contains(r.URL.Path, "/query") {
			fmt.Fprint(w, `{"status":"success","data":{"resultType":"vector","result":[]}}`)
		}
	}))
	defer ts.Close()

	cfg := &config.Config{}
	cfg.Prom.URL = ts.URL
	h := &Handler{cfg: cfg}

	t.Run("PromHealth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/prom/health", nil)
		rr := httptest.NewRecorder()
		h.PromHealth(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
	})

	t.Run("PromQuery", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/prom/query?query=up", nil)
		rr := httptest.NewRecorder()
		h.PromQuery(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
	})

	t.Run("PromDisabled", func(t *testing.T) {
		h_disabled := &Handler{cfg: &config.Config{}}
		h_disabled.cfg.Prom.Disabled = true

		req := httptest.NewRequest(http.MethodGet, "/api/prom/health", nil)
		rr := httptest.NewRecorder()
		h_disabled.PromHealth(rr, req)

		if rr.Code != http.StatusServiceUnavailable {
			t.Errorf("expected 503 for disabled prometheus, got %d", rr.Code)
		}
	})
}
