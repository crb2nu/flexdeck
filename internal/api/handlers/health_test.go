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
	if loom.DirectEntryEnabled {
		t.Fatal("expected loom_hud.directEntryEnabled=false when pull URL is empty")
	}
	if loom.PassthroughEnabled {
		t.Fatal("expected loom_hud.passthroughEnabled=false when pull URL is empty")
	}
	if loom.DirectURL != "" {
		t.Fatalf("expected loom_hud.directUrl to be empty, got %q", loom.DirectURL)
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
	if !loom.DirectEntryEnabled {
		t.Fatal("expected loom_hud.directEntryEnabled=true when pull URL is set")
	}
	if !loom.PassthroughEnabled {
		t.Fatal("expected loom_hud.passthroughEnabled=true when pull URL is set")
	}
	if loom.DirectURL != "http://loom-hud.ai.svc.cluster.local:3333" {
		t.Fatalf("expected loom_hud.directUrl to echo the configured URL, got %q", loom.DirectURL)
	}

	loomPush, ok := resp.Features["loom_hud_push"]
	if !ok {
		t.Fatal("expected loom_hud_push feature in health response")
	}
	if !loomPush.Enabled {
		t.Fatal("expected loom_hud_push.enabled=true when push store is configured")
	}
}

func TestHealthFeatureFlagsReflectConfig(t *testing.T) {
	t.Parallel()

	h := &Handler{
		cfg: &config.Config{
			LoomHUD: config.LoomHUDConfig{
				Disabled: true,
				URL:      "http://loom-hud.ai.svc.cluster.local:3333",
			},
			RBAC: config.RBACConfig{
				Disabled: false,
			},
			Audit: config.AuditConfig{
				Disabled: true,
			},
			MultiCluster: config.MultiClusterConfig{
				Disabled: false,
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

	if resp.Features["loom_hud"].Enabled {
		t.Fatal("expected loom_hud.enabled=false when LOOM_HUD_DISABLED=true")
	}
	if resp.Features["loom_hud"].DirectEntryEnabled {
		t.Fatal("expected loom_hud.directEntryEnabled=false when LOOM_HUD_DISABLED=true")
	}
	if resp.Features["loom_hud"].PassthroughEnabled {
		t.Fatal("expected loom_hud.passthroughEnabled=false when LOOM_HUD_DISABLED=true")
	}
	if resp.Features["loom_hud_push"].Enabled {
		t.Fatal("expected loom_hud_push.enabled=false when LOOM_HUD_DISABLED=true")
	}
	if !resp.Features["rbac"].Enabled {
		t.Fatal("expected rbac.enabled=true when RBAC_DISABLED=false")
	}
	if resp.Features["audit"].Enabled {
		t.Fatal("expected audit.enabled=false when AUDIT_DISABLED=true")
	}
	if !resp.Features["multi_cluster"].Enabled {
		t.Fatal("expected multi_cluster.enabled=true when MULTICLUSTER_DISABLED=false")
	}
}

func TestHealthLoomHUDReportsDirectEntryContract(t *testing.T) {
	t.Parallel()

	h := &Handler{
		cfg: &config.Config{
			LoomHUD: config.LoomHUDConfig{
				Disabled: false,
				URL:      "https://loom-hud.example.com",
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
	if !loom.Enabled || !loom.DirectEntryEnabled || !loom.PassthroughEnabled {
		t.Fatalf("expected loom_hud direct-entry contract to be enabled, got %+v", loom)
	}
	if loom.DirectURL != "https://loom-hud.example.com" {
		t.Fatalf("expected directUrl to match configured URL, got %q", loom.DirectURL)
	}
}
