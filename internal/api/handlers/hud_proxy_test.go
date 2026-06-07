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

func TestHUDMobileSurfaceFallbacks(t *testing.T) {
	var mobileWorkflowDetailRequests int
	var mobileApproveRequests int

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/mobile/v1/presence"):
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"data":{"agents":[{"agent_id":"codex-mobile","agent_type":"codex","status":"active","active_files":["web/src/components/Agents/HUDTab.tsx"],"last_heartbeat":"2026-04-05T13:00:00Z","branch":"feat/mobile"}],"claims":[{"agent_id":"codex-mobile","file_path":"web/src/components/Agents/HUDTab.tsx","claim_type":"edit","created_at":"2026-04-05T12:55:00Z"}],"summary":{"active_agents":1}}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/mobile/v1/tasks":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"data":{"tasks":[{"id":"task-1","session_id":"sess-1","agent_id":"codex-mobile","namespace":"flexdeck","project":"flexdeck","title":"Repair Loom HUD","context":"restore mobile-hud compatibility","priority":"high","status":"in_progress","tags":["loom"],"blocked_by":[],"created_at":"2026-04-05T12:00:00Z","updated_at":"2026-04-05T12:10:00Z"}]}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/mobile/v1/workflows":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"data":{"workflows":[{"id":"wf-mobile","name":"Deploy mobile fix","status":"waiting_approval","current_step":"approve","started_at":"2026-04-05T11:00:00Z"}],"deprecated_pending_approvals":1,"active_workflows":0}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/mobile/v1/dashboard":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"data":{"recent_timeline":[{"timestamp":"2026-04-05T12:15:00Z","event_type":"agent.task.update","agent_id":"codex-mobile","data":{"message":"task advanced"}}]}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/api/mobile/v1/workflows/wf-mobile":
			mobileWorkflowDetailRequests++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"data":{"workflow":{"id":"wf-mobile","name":"Deploy mobile fix","status":"waiting_approval","current_step":"approve","started_at":"2026-04-05T11:00:00Z","steps":[{"id":"approve","name":"Approve","status":"waiting_approval","type":"approval"}]},"events":[]}}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/mobile/v1/workflows/wf-mobile/approve":
			mobileApproveRequests++
			w.Header().Set("Content-Type", "application/json")
			body := new(bytes.Buffer)
			_, _ = body.ReadFrom(r.Body)
			if !strings.Contains(body.String(), `"step_id":"approve"`) {
				http.Error(w, "missing step id", http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"ok":true,"data":{"workflow_id":"wf-mobile","step_id":"approve","action":"approved"}}`))
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
	router.Get("/api/hud/fleet", h.HUDFleet)
	router.Get("/api/hud/claims", h.HUDClaims)
	router.Get("/api/hud/tasks", h.HUDTasks)
	router.Get("/api/hud/workflows", h.HUDWorkflows)
	router.Get("/api/hud/timeline", h.HUDTimeline)
	router.Post("/api/hud/workflows/{id}/approve", h.HUDWorkflowApprove)

	t.Run("fleet", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/hud/fleet", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}

		var payload map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode fleet payload: %v", err)
		}
		agents, ok := payload["agents"].([]any)
		if !ok || len(agents) != 1 {
			t.Fatalf("expected 1 mobile agent, got %v", payload["agents"])
		}
		tasks, ok := payload["tasks"].([]any)
		if !ok || len(tasks) != 1 {
			t.Fatalf("expected 1 mobile task, got %v", payload["tasks"])
		}
		kpis, ok := payload["kpis"].(map[string]any)
		if !ok || kpis["pending_approvals"] != float64(1) {
			t.Fatalf("expected pending approvals from mobile workflows, got %v", payload["kpis"])
		}
	})

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
		if len(payload) != 1 || payload[0]["filePath"] != "web/src/components/Agents/HUDTab.tsx" {
			t.Fatalf("unexpected claims payload: %s", rec.Body.String())
		}
	})

	t.Run("timeline", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/hud/timeline", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		var payload []map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode timeline payload: %v", err)
		}
		if len(payload) != 1 || payload[0]["type"] != "task_update" || payload[0]["summary"] != "task advanced" {
			t.Fatalf("unexpected timeline payload: %s", rec.Body.String())
		}
	})

	t.Run("approve", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/hud/workflows/wf-mobile/approve", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if mobileWorkflowDetailRequests != 1 {
			t.Fatalf("expected mobile workflow detail lookup, got %d", mobileWorkflowDetailRequests)
		}
		if mobileApproveRequests != 1 {
			t.Fatalf("expected mobile approve request, got %d", mobileApproveRequests)
		}
	})
}

func TestHUDHandoffsProxyNormalizesAndForwardsActions(t *testing.T) {
	var acceptBody string
	var rejectHits int

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/handoffs":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"handoffs":[{"id":"ho-1","from_agent":"claude","to_agent":"codex","target_agent_id":"codex","status":"pending","summary":"Finish the auth refactor","created_at":"2026-06-07T12:00:00Z"}]}`))
		case r.Method == http.MethodPost && r.URL.Path == "/api/handoffs/ho-1/accept":
			w.Header().Set("Content-Type", "application/json")
			body := new(bytes.Buffer)
			_, _ = body.ReadFrom(r.Body)
			acceptBody = body.String()
			_, _ = w.Write([]byte(`{"status":"accepted","handoff_id":"ho-1"}`))
		// Primary HUD has no reject route — exercise the mobile fallback.
		case r.Method == http.MethodPost && r.URL.Path == "/api/handoffs/ho-1/reject":
			http.NotFound(w, r)
		case r.Method == http.MethodPost && r.URL.Path == "/api/mobile/v1/handoffs/ho-1/reject":
			rejectHits++
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ok":true,"handoff_id":"ho-1","status":"rejected"}`))
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
	router.Get("/api/hud/handoffs", h.HUDHandoffs)
	router.Post("/api/hud/handoffs/{id}/accept", h.HUDHandoffAccept)
	router.Post("/api/hud/handoffs/{id}/reject", h.HUDHandoffReject)

	t.Run("list normalizes to camelCase", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/hud/handoffs", nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		var payload []map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode handoffs payload: %v", err)
		}
		if len(payload) != 1 {
			t.Fatalf("expected 1 handoff, got %d", len(payload))
		}
		if payload[0]["id"] != "ho-1" || payload[0]["fromAgent"] != "claude" || payload[0]["targetAgentId"] != "codex" {
			t.Fatalf("unexpected handoff payload: %s", rec.Body.String())
		}
		if payload[0]["summary"] != "Finish the auth refactor" {
			t.Fatalf("expected summary to normalize, got %s", rec.Body.String())
		}
	})

	t.Run("accept forwards body", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/hud/handoffs/ho-1/accept", strings.NewReader(`{"target_agent_id":"codex"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(acceptBody, `"target_agent_id":"codex"`) {
			t.Fatalf("expected accept body to forward, got %q", acceptBody)
		}
		if !strings.Contains(rec.Body.String(), `"status":"accepted"`) {
			t.Fatalf("unexpected accept response: %s", rec.Body.String())
		}
	})

	t.Run("reject falls back to mobile path", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/hud/handoffs/ho-1/reject", strings.NewReader(`{"reason":"out of scope"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
		}
		if rejectHits != 1 {
			t.Fatalf("expected mobile reject fallback to be hit once, got %d", rejectHits)
		}
		if !strings.Contains(rec.Body.String(), `"status":"rejected"`) {
			t.Fatalf("unexpected reject response: %s", rec.Body.String())
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

	line = `data: {"id":"evt-1","type":"hud.fleet","timestamp":"2026-04-05T12:00:00Z","data":{"agent_id":"codex","message":"fleet snapshot"}}`
	normalized = normalizeHUDSSEDataLine(line)
	if !strings.Contains(normalized, `"type":"fleet_update"`) {
		t.Fatalf("expected fleet snapshot events to normalize, got %s", normalized)
	}
	if !strings.Contains(normalized, `"summary":"fleet snapshot"`) {
		t.Fatalf("expected fleet snapshot summary to normalize, got %s", normalized)
	}
}
