package handlers

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestAlertmanagerHandlers(t *testing.T) {
	// Mock Alertmanager server
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/alerts") {
			if _, err := fmt.Fprint(w, `[{"labels":{"alertname":"HighCPU"}}]`); err != nil {
				t.Errorf("write alerts response: %v", err)
			}
		} else if strings.Contains(r.URL.Path, "/silences") {
			if _, err := fmt.Fprint(w, `[]`); err != nil {
				t.Errorf("write silences response: %v", err)
			}
		} else {
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer ts.Close()

	cfg := &config.Config{}
	cfg.Alertmanager.URL = ts.URL
	h := &Handler{cfg: cfg}

	t.Run("AlertmanagerAlerts", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/alerts", nil)
		rr := httptest.NewRecorder()
		h.AlertmanagerAlerts(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rr.Code)
		}
		if !strings.Contains(rr.Body.String(), "HighCPU") {
			t.Errorf("expected alert name in response")
		}
	})

	t.Run("AlertmanagerDisabled", func(t *testing.T) {
		h_disabled := &Handler{cfg: &config.Config{}}
		h_disabled.cfg.Alertmanager.Disabled = true

		req := httptest.NewRequest(http.MethodGet, "/api/alerts", nil)
		rr := httptest.NewRecorder()
		h_disabled.AlertmanagerAlerts(rr, req)

		if rr.Code != http.StatusServiceUnavailable {
			t.Errorf("expected 503 for disabled alertmanager, got %d", rr.Code)
		}
	})
}
