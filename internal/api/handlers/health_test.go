package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/flexinfer/flexdeck/internal/agents"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/loomupstream"
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
		t.Fatalf("expected loom_hud.directUrl to fall back to the pull URL, got %q", loom.DirectURL)
	}

	loomPush, ok := resp.Features["loom_hud_push"]
	if !ok {
		t.Fatal("expected loom_hud_push feature in health response")
	}
	if !loomPush.Enabled {
		t.Fatal("expected loom_hud_push.enabled=true when push store is configured")
	}
}

func TestHealthFeatureFlagsReflectRuntimeAvailability(t *testing.T) {
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
	if resp.Features["rbac"].Enabled {
		t.Fatal("expected rbac.enabled=false when registry is unavailable")
	}
	if resp.Features["audit"].Enabled {
		t.Fatal("expected audit.enabled=false when AUDIT_DISABLED=true")
	}
	if resp.Features["multi_cluster"].Enabled {
		t.Fatal("expected multi_cluster.enabled=false when registry is unavailable")
	}
}

func TestHealthLoomHUDReportsDirectEntryContract(t *testing.T) {
	t.Parallel()

	h := &Handler{
		cfg: &config.Config{
			LoomHUD: config.LoomHUDConfig{
				Disabled:  false,
				URL:       "http://mobile-hud.loom-hub.svc.cluster.local",
				DirectURL: "https://hud.flexinfer.ai",
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
	if loom.URL != "http://mobile-hud.loom-hub.svc.cluster.local" {
		t.Fatalf("expected passthrough URL to match configured pull URL, got %q", loom.URL)
	}
	if loom.DirectURL != "https://hud.flexinfer.ai" {
		t.Fatalf("expected directUrl to match configured URL, got %q", loom.DirectURL)
	}
}

func TestHealthReportsMillsMutationReadiness(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		mills      config.MillsConfig
		wantOn     bool
		wantMode   string
		wantReason string
	}{
		{
			name: "operator disabled",
			mills: config.MillsConfig{
				Disabled:         true,
				URL:              "http://mills.example",
				AdminToken:       "secret",
				MutationsEnabled: true,
			},
			wantMode:   "operator_disabled",
			wantReason: "Mills operator is disabled or unconfigured",
		},
		{
			name: "dark launch flag off",
			mills: config.MillsConfig{
				URL:        "http://mills.example",
				AdminToken: "secret",
			},
			wantMode:   "dark_launch",
			wantReason: "LOOM_MILLS_MUTATIONS_ENABLED is false",
		},
		{
			name: "missing admin token",
			mills: config.MillsConfig{
				URL:              "http://mills.example",
				MutationsEnabled: true,
			},
			wantMode:   "missing_admin_token",
			wantReason: "LOOM_MILLS_ADMIN_TOKEN is not configured",
		},
		{
			name: "ready",
			mills: config.MillsConfig{
				URL:              "http://mills.example",
				AdminToken:       "secret",
				MutationsEnabled: true,
			},
			wantOn:   true,
			wantMode: "enabled",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			h := &Handler{
				cfg:         &config.Config{Mills: tt.mills},
				millsClient: loomupstream.NewMillsClient(tt.mills.URL, tt.mills.AdminToken, nil),
			}

			req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
			rr := httptest.NewRecorder()
			h.Health(rr, req)

			var resp HealthResponse
			if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
				t.Fatalf("failed to decode response: %v", err)
			}

			got := resp.Features["loom_control_plane_mutations"]
			if got.Enabled != tt.wantOn {
				t.Fatalf("enabled = %v, want %v (feature=%+v)", got.Enabled, tt.wantOn, got)
			}
			if got.Mode != tt.wantMode {
				t.Fatalf("mode = %q, want %q (feature=%+v)", got.Mode, tt.wantMode, got)
			}
			if got.Reason != tt.wantReason {
				t.Fatalf("reason = %q, want %q (feature=%+v)", got.Reason, tt.wantReason, got)
			}
		})
	}
}
