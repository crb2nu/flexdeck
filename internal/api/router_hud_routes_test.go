package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestRouter_HUDClaimsAndCancelRoutesProxyThrough(t *testing.T) {
	t.Parallel()

	var claimsCalled bool
	var cancelCalled bool
	var cancelBody string

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/claims":
			claimsCalled = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `[{"agent_id":"codex","file_path":"internal/api/router.go"}]`)
		case r.Method == http.MethodPost && r.URL.Path == "/api/workflows/wf-42/cancel":
			cancelCalled = true
			body, _ := io.ReadAll(r.Body)
			cancelBody = string(body)
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"ok":true,"id":"wf-42"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	cfg := &config.Config{
		AllowedOrigins: []string{"*"},
		LoomHUD: config.LoomHUDConfig{
			Disabled: false,
			URL:      upstream.URL,
		},
	}

	router := NewRouterWithDeps(cfg, nil, nil, nil, nil)

	{
		req := httptest.NewRequest(http.MethodGet, "/api/hud/claims", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("claims status = %d, want %d", rec.Code, http.StatusOK)
		}
		if !claimsCalled {
			t.Fatalf("expected upstream /api/claims to be called")
		}

		var payload []map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("claims response is not valid JSON array: %v", err)
		}
		if len(payload) != 1 {
			t.Fatalf("claims payload length = %d, want 1", len(payload))
		}
		if payload[0]["agentId"] != "codex" || payload[0]["filePath"] != "internal/api/router.go" {
			t.Fatalf("claims payload was not normalized: %#v", payload[0])
		}
	}

	{
		req := httptest.NewRequest(http.MethodPost, "/api/hud/workflows/wf-42/cancel", strings.NewReader(`{"comment":"operator-stop"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("cancel status = %d, want %d", rec.Code, http.StatusOK)
		}
		if !cancelCalled {
			t.Fatalf("expected upstream /api/workflows/{id}/cancel to be called")
		}
		if !strings.Contains(cancelBody, `"operator-stop"`) {
			t.Fatalf("cancel request body was not forwarded, got: %s", cancelBody)
		}

		var payload map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("cancel response is not valid JSON object: %v", err)
		}
		if payload["ok"] != true {
			t.Fatalf("cancel payload ok = %v, want true", payload["ok"])
		}
	}
}

func TestRouter_HUDClaimsUnavailableWhenDisabled(t *testing.T) {
	t.Parallel()

	upstreamCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls++
		http.NotFound(w, r)
	}))
	defer upstream.Close()

	cfg := &config.Config{
		AllowedOrigins: []string{"*"},
		LoomHUD: config.LoomHUDConfig{
			Disabled: true,
			URL:      upstream.URL,
		},
	}

	router := NewRouterWithDeps(cfg, nil, nil, nil, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/hud/claims", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if !strings.Contains(rec.Body.String(), "loom hud disabled") {
		t.Fatalf("expected disabled error payload, got: %s", rec.Body.String())
	}
	if upstreamCalls != 0 {
		t.Fatalf("expected no upstream calls when HUD is disabled, got %d", upstreamCalls)
	}
}
