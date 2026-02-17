package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestHealthLoomHUDDisabledWhenPullURLEmpty(t *testing.T) {
	t.Parallel()

	h := &Handler{
		cfg: &config.Config{
			LoomHUD: config.LoomHUDConfig{
				Disabled: false,
				URL:      "",
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rr := httptest.NewRecorder()
	h.Health(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var resp HealthResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	loom, ok := resp.Features["loom_hud"]
	if !ok {
		t.Fatal("expected loom_hud feature in health response")
	}
	if loom.Enabled {
		t.Fatal("expected loom_hud.enabled=false when pull URL is empty")
	}
}

func TestHealthLoomHUDEnabledWhenPullURLSet(t *testing.T) {
	t.Parallel()

	h := &Handler{
		cfg: &config.Config{
			LoomHUD: config.LoomHUDConfig{
				Disabled: false,
				URL:      "http://loom-hud.ai.svc.cluster.local:3333",
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rr := httptest.NewRecorder()
	h.Health(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}

	var resp HealthResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	loom, ok := resp.Features["loom_hud"]
	if !ok {
		t.Fatal("expected loom_hud feature in health response")
	}
	if !loom.Enabled {
		t.Fatal("expected loom_hud.enabled=true when pull URL is set")
	}
}
