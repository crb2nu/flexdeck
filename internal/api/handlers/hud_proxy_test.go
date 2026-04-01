package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/go-chi/chi/v5"
)

func TestHUDClaimsAndWorkflowActionsNormalizeContracts(t *testing.T) {
	var workflowDetailRequests int

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/claims":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"claims":[{"agent_id":"codex","file_path":"internal/api/router.go","claim_type":"edit","created_at":"2026-03-31T11:00:00Z","expires_at":"2026-03-31T11:15:00Z"}]}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/workflows":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"workflows":[{"id":"wf-1","name":"deploy","status":"waiting_approval","current_step":"review","started_at":"2026-03-27T12:00:00Z"}]}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/workflows/wf-1":
			workflowDetailRequests++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"wf-1","name":"deploy","status":"waiting_approval","current_step":"review","started_at":"2026-03-27T12:00:00Z","steps":[{"id":"build","name":"Build","status":"completed","type":"tool"},{"id":"review","name":"Review","status":"waiting_approval","type":"approval"}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/workflows/wf-1/approve":
			w.Header().Set("Content-Type", "application/json")
			body := new(bytes.Buffer)
			_, _ = body.ReadFrom(r.Body)
			if !strings.Contains(body.String(), `"step_id":"review"`) {
				http.Error(w, "missing step id", http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"ok":true}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/workflows/wf-1/cancel":
			w.Header().Set("Content-Type", "application/json")
			body := new(bytes.Buffer)
			_, _ = body.ReadFrom(r.Body)
			if !strings.Contains(body.String(), "operator-stop") {
				http.Error(w, "missing comment", http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	h := &Handler{
		cfg: &config.Config{
			LoomHUD: config.LoomHUDConfig{URL: upstream.URL},
		},
	}

	router := chi.NewRouter()
	router.Get("/api/hud/claims", h.HUDClaims)
	router.Get("/api/hud/workflows", h.HUDWorkflows)
	router.Post("/api/hud/workflows/{id}/approve", h.HUDWorkflowApprove)
	router.Post("/api/hud/workflows/{id}/cancel", h.HUDWorkflowCancel)

	t.Run("claims", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/hud/claims", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		var payload []map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode claims payload: %v", err)
		}
		if len(payload) != 1 || payload[0]["agentId"] != "codex" || payload[0]["filePath"] != "internal/api/router.go" {
			t.Fatalf("unexpected claims payload: %s", rec.Body.String())
		}
		if payload[0]["expiresAt"] != "2026-03-31T11:15:00Z" || payload[0]["updatedAt"] != "2026-03-31T11:15:00Z" {
			t.Fatalf("expected claim expiry fields to normalize, got %s", rec.Body.String())
		}
	})

	t.Run("workflows", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/hud/workflows", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}

		var payload []map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode workflow payload: %v", err)
		}
		if len(payload) != 1 {
			t.Fatalf("expected 1 workflow, got %d", len(payload))
		}
		if payload[0]["definitionId"] != "deploy" || payload[0]["status"] != "awaiting_approval" {
			t.Fatalf("unexpected workflow payload: %s", rec.Body.String())
		}
		if workflowDetailRequests != 0 {
			t.Fatalf("expected workflow list normalization to avoid detail fetches, got %d", workflowDetailRequests)
		}

		steps, ok := payload[0]["steps"].([]any)
		if !ok || len(steps) != 1 {
			t.Fatalf("expected synthesized workflow steps, got %v", payload[0]["steps"])
		}
		step, ok := steps[0].(map[string]any)
		if !ok || step["requiresApproval"] != true || step["name"] != "review" {
			t.Fatalf("expected synthesized review step to require approval, got %v", steps[0])
		}
	})

	t.Run("approve", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/hud/workflows/wf-1/approve", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if workflowDetailRequests != 1 {
			t.Fatalf("expected approve path to fetch workflow detail once, got %d", workflowDetailRequests)
		}
		if !strings.Contains(rec.Body.String(), `"ok":true`) {
			t.Fatalf("unexpected approve payload: %s", rec.Body.String())
		}
	})

	t.Run("cancel", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/hud/workflows/wf-1/cancel", strings.NewReader(`{"comment":"operator-stop"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), `"ok":true`) {
			t.Fatalf("unexpected cancel payload: %s", rec.Body.String())
		}
	})
}

func TestNormalizeHUDSSEDataLine(t *testing.T) {
	line := `data: {"timestamp":"2026-03-27T12:00:00Z","event_type":"agent.session.start","agent_id":"codex","data":{"message":"Session started"}}`
	normalized := normalizeHUDSSEDataLine(line)
	if !strings.Contains(normalized, `"type":"session_start"`) {
		t.Fatalf("expected normalized SSE event type, got %s", normalized)
	}
	if !strings.Contains(normalized, `"agentId":"codex"`) {
		t.Fatalf("expected normalized SSE agent id, got %s", normalized)
	}
	if !strings.Contains(normalized, `"summary":"Session started"`) {
		t.Fatalf("expected normalized SSE summary, got %s", normalized)
	}
}
