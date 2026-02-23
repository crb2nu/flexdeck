package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/flexinfer/flexdeck/internal/agents"
	"github.com/flexinfer/flexdeck/internal/config"
)

func TestHUDPresencePush_Success(t *testing.T) {
	pushStore := agents.NewHUDPushStore(60 * time.Second)
	cfg := &config.Config{
		LoomHUD: config.LoomHUDConfig{PushToken: "test-token"},
	}
	h := &Handler{
		cfg:          cfg,
		hudPushStore: pushStore,
	}

	body := map[string]any{
		"agents": []map[string]any{
			{"agent_id": "claude-code", "status": "active", "agent_type": "claude-code"},
		},
		"sessions": []map[string]any{
			{"id": "sess-1", "agent_id": "claude-code", "status": "active", "started_at": "2026-01-01T00:00:00Z"},
		},
	}
	bodyBytes, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/api/agents/hud/push", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Push-Token", "test-token")

	w := httptest.NewRecorder()
	h.HUDPresencePush(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["ok"] != true {
		t.Errorf("expected ok=true, got %v", resp["ok"])
	}

	// Verify data was stored.
	presence, ok := pushStore.GetPresence()
	if !ok {
		t.Fatal("expected push store to have data")
	}
	if len(presence.Agents) != 1 {
		t.Fatalf("expected 1 agent in store, got %d", len(presence.Agents))
	}
	if presence.Agents[0].AgentID != "claude-code" {
		t.Errorf("expected agent_id claude-code, got %s", presence.Agents[0].AgentID)
	}

	sessions, ok := pushStore.GetSessions()
	if !ok {
		t.Fatal("expected push store to have session data")
	}
	if len(sessions.Sessions) != 1 {
		t.Fatalf("expected 1 session in store, got %d", len(sessions.Sessions))
	}
}

func TestHUDPresencePush_InvalidToken(t *testing.T) {
	pushStore := agents.NewHUDPushStore(60 * time.Second)
	cfg := &config.Config{
		LoomHUD: config.LoomHUDConfig{PushToken: "correct-token"},
	}
	h := &Handler{
		cfg:          cfg,
		hudPushStore: pushStore,
	}

	body := []byte(`{"agents":[],"sessions":[]}`)
	req := httptest.NewRequest(http.MethodPost, "/api/agents/hud/push", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Push-Token", "wrong-token")

	w := httptest.NewRecorder()
	h.HUDPresencePush(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHUDPresencePush_NoTokenConfigured(t *testing.T) {
	pushStore := agents.NewHUDPushStore(60 * time.Second)
	cfg := &config.Config{
		LoomHUD: config.LoomHUDConfig{PushToken: ""},
	}
	h := &Handler{
		cfg:          cfg,
		hudPushStore: pushStore,
	}

	body := []byte(`{"agents":[{"agent_id":"test"}],"sessions":[]}`)
	req := httptest.NewRequest(http.MethodPost, "/api/agents/hud/push", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	h.HUDPresencePush(w, req)

	// When no token is configured, any request should be accepted.
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (no token configured), got %d: %s", w.Code, w.Body.String())
	}
}

func TestHUDPresencePush_NoPushStore(t *testing.T) {
	cfg := &config.Config{}
	h := &Handler{
		cfg:          cfg,
		hudPushStore: nil,
	}

	body := []byte(`{"agents":[],"sessions":[]}`)
	req := httptest.NewRequest(http.MethodPost, "/api/agents/hud/push", bytes.NewReader(body))

	w := httptest.NewRecorder()
	h.HUDPresencePush(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}

func TestHUDPresencePush_InvalidBody(t *testing.T) {
	pushStore := agents.NewHUDPushStore(60 * time.Second)
	cfg := &config.Config{}
	h := &Handler{
		cfg:          cfg,
		hudPushStore: pushStore,
	}

	req := httptest.NewRequest(http.MethodPost, "/api/agents/hud/push", bytes.NewReader([]byte(`{invalid`)))
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	h.HUDPresencePush(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
