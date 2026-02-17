package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/flexinfer/flexdeck/internal/agents"
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

	loomPush, ok := resp.Features["loom_hud_push"]
	if !ok {
		t.Fatal("expected loom_hud_push feature in health response")
	}
	if loomPush.Enabled {
		t.Fatal("expected loom_hud_push.enabled=false when push store is not configured")
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
		hudPushStore: agents.NewHUDPushStore(60 * time.Second),
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

	loomPush, ok := resp.Features["loom_hud_push"]
	if !ok {
		t.Fatal("expected loom_hud_push feature in health response")
	}
	if !loomPush.Enabled {
		t.Fatal("expected loom_hud_push.enabled=true when push store is configured")
	}
}
