package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/flexinfer/flexdeck/internal/api/handlers/apiutil"
	"github.com/go-chi/chi/v5"
)

// maxHUDRequestBody limits POST request bodies to 1MB.
const maxHUDRequestBody = 1 << 20

// HUDFleet returns the full fleet view from the Loom HUD API.
func (h *Handler) HUDFleet(w http.ResponseWriter, r *http.Request) {
	if !h.loomHUDPassthroughEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:fleet", 15*time.Second, "hud fleet", func() (any, error) {
		raw, err := h.fetchHUDPaths(r.Context(), h.hudPaths("/api/fleet", "")...)
		if err == nil {
			return normalizeHUDFleetResponse(raw)
		}
		return h.fetchMobileHUDFleet(r.Context())
	})
}

// HUDPresence returns agent presence data from the Loom HUD API.
func (h *Handler) HUDPresence(w http.ResponseWriter, r *http.Request) {
	if !h.loomHUDPassthroughEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:presence", 10*time.Second, "hud presence", func() (any, error) {
		raw, err := h.fetchHUDPaths(r.Context(), h.hudPaths("/api/presence", "/api/mobile/v1/presence")...)
		if err != nil {
			return nil, err
		}
		return normalizeHUDPresenceResponse(raw)
	})
}

// HUDTasks returns task data from the Loom HUD API.
func (h *Handler) HUDTasks(w http.ResponseWriter, r *http.Request) {
	if !h.loomHUDPassthroughEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:tasks", 15*time.Second, "hud tasks", func() (any, error) {
		raw, err := h.fetchHUDPaths(r.Context(), h.hudPaths("/api/tasks", "/api/mobile/v1/tasks")...)
		if err != nil {
			return nil, err
		}
		return normalizeHUDTasksResponse(raw)
	})
}

// HUDWorkflows returns workflow data from the Loom HUD API.
func (h *Handler) HUDWorkflows(w http.ResponseWriter, r *http.Request) {
	if !h.loomHUDPassthroughEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:workflows", 10*time.Second, "hud workflows", func() (any, error) {
		raw, err := h.fetchHUDPaths(r.Context(), h.hudPaths("/api/workflows", "/api/mobile/v1/workflows")...)
		if err != nil {
			return nil, err
		}
		return normalizeHUDWorkflowsResponse(raw)
	})
}

// HUDTimeline returns timeline events from the Loom HUD API.
func (h *Handler) HUDTimeline(w http.ResponseWriter, r *http.Request) {
	if !h.loomHUDPassthroughEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:timeline", 5*time.Second, "hud timeline", func() (any, error) {
		raw, err := h.fetchHUDPaths(r.Context(), h.hudPaths("/api/timeline", "/api/mobile/v1/dashboard")...)
		if err != nil {
			return nil, err
		}
		return normalizeHUDTimelineResponse(raw)
	})
}

// HUDClaims returns file claim data from the Loom HUD API.
func (h *Handler) HUDClaims(w http.ResponseWriter, r *http.Request) {
	if !h.loomHUDPassthroughEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:claims", 10*time.Second, "hud claims", func() (any, error) {
		raw, err := h.fetchHUDPaths(r.Context(), h.hudPaths("/api/claims", "/api/mobile/v1/presence")...)
		if err != nil {
			return nil, err
		}
		return normalizeHUDClaimsResponse(raw)
	})
}

// HUDWorkflowApprove approves a workflow step that requires human approval.
func (h *Handler) HUDWorkflowApprove(w http.ResponseWriter, r *http.Request) {
	if !h.loomHUDPassthroughEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	id := chi.URLParam(r, "id")
	paths := h.hudPaths(
		fmt.Sprintf("/api/workflows/%s/approve", id),
		fmt.Sprintf("/api/mobile/v1/workflows/%s/approve", id),
	)

	body, err := io.ReadAll(io.LimitReader(r.Body, maxHUDRequestBody))
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "failed to read request body"})
		return
	}

	body, err = h.prepareHUDWorkflowStepPayload(r.Context(), id, body)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	result, err := h.postHUDPaths(r.Context(), body, paths...)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	if h.cache != nil {
		h.cache.Invalidate(r.Context(), "hud:workflows")
		h.cache.Invalidate(r.Context(), "hud:timeline")
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(result)
}

// HUDWorkflowReject rejects a workflow step.
func (h *Handler) HUDWorkflowReject(w http.ResponseWriter, r *http.Request) {
	if !h.loomHUDPassthroughEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	id := chi.URLParam(r, "id")
	paths := h.hudPaths(
		fmt.Sprintf("/api/workflows/%s/reject", id),
		fmt.Sprintf("/api/mobile/v1/workflows/%s/reject", id),
	)

	body, err := io.ReadAll(io.LimitReader(r.Body, maxHUDRequestBody))
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "failed to read request body"})
		return
	}

	body, err = h.prepareHUDWorkflowStepPayload(r.Context(), id, body)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	result, err := h.postHUDPaths(r.Context(), body, paths...)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	if h.cache != nil {
		h.cache.Invalidate(r.Context(), "hud:workflows")
		h.cache.Invalidate(r.Context(), "hud:timeline")
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(result)
}

// HUDWorkflowCancel cancels a workflow.
func (h *Handler) HUDWorkflowCancel(w http.ResponseWriter, r *http.Request) {
	if !h.loomHUDPassthroughEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	id := chi.URLParam(r, "id")
	paths := h.hudPaths(
		fmt.Sprintf("/api/workflows/%s/cancel", id),
		"",
	)

	body, err := io.ReadAll(io.LimitReader(r.Body, maxHUDRequestBody))
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "failed to read request body"})
		return
	}

	result, err := h.postHUDPaths(r.Context(), body, paths...)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	if h.cache != nil {
		h.cache.Invalidate(r.Context(), "hud:workflows")
		h.cache.Invalidate(r.Context(), "hud:timeline")
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(result)
}

// fetchHUD makes a GET request to the Loom HUD REST API.
func (h *Handler) fetchHUD(ctx context.Context, path string) (json.RawMessage, error) {
	return h.fetchHUDPaths(ctx, path)
}

func (h *Handler) fetchHUDPaths(ctx context.Context, paths ...string) (json.RawMessage, error) {
	var lastErr error
	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		raw, err := h.fetchHUDPath(ctx, path)
		if err == nil {
			return raw, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		return nil, fmt.Errorf("no hud paths configured")
	}
	return nil, lastErr
}

func (h *Handler) fetchHUDPath(ctx context.Context, path string) (json.RawMessage, error) {
	reqURL := strings.TrimSuffix(h.cfg.LoomHUD.URL, "/") + path

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create hud request: %w", err)
	}

	resp, err := apiutil.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hud request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hud returned %d for %s", resp.StatusCode, path)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read hud response: %w", err)
	}

	return json.RawMessage(body), nil
}

func (h *Handler) fetchHUDWorkflowDetail(ctx context.Context, workflowID string) (json.RawMessage, error) {
	return h.fetchHUDPaths(ctx, h.hudPaths(
		fmt.Sprintf("/api/workflows/%s", workflowID),
		fmt.Sprintf("/api/mobile/v1/workflows/%s", workflowID),
	)...)
}

func (h *Handler) prepareHUDWorkflowStepPayload(ctx context.Context, workflowID string, body []byte) ([]byte, error) {
	payload := map[string]any{}
	if len(bytes.TrimSpace(body)) > 0 {
		if err := json.Unmarshal(body, &payload); err != nil {
			return nil, fmt.Errorf("invalid workflow request body: %w", err)
		}
	}

	if hudString(payload["step_id"]) != "" {
		return json.Marshal(payload)
	}

	raw, err := h.fetchHUDWorkflowDetail(ctx, workflowID)
	if err != nil {
		return nil, fmt.Errorf("fetch workflow detail: %w", err)
	}
	detail, err := parseHUDEnvelope(raw)
	if err != nil {
		return nil, fmt.Errorf("decode workflow detail: %w", err)
	}

	stepID := resolveHUDWorkflowStepID(detail)
	if stepID == "" {
		return nil, fmt.Errorf("workflow %s does not expose an active step_id", workflowID)
	}

	payload["step_id"] = stepID
	return json.Marshal(payload)
}

func (h *Handler) postHUDPaths(ctx context.Context, body []byte, paths ...string) ([]byte, error) {
	var lastErr error
	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		result, err := h.postHUDPath(ctx, path, body)
		if err == nil {
			return result, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		return nil, fmt.Errorf("no hud post paths configured")
	}
	return nil, lastErr
}

func (h *Handler) postHUDPath(ctx context.Context, path string, body []byte) ([]byte, error) {
	reqURL := strings.TrimSuffix(h.cfg.LoomHUD.URL, "/") + path

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create hud request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := apiutil.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hud post request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	result, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read hud response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("hud returned %d for %s: %s", resp.StatusCode, path, string(result))
	}

	return result, nil
}

func (h *Handler) hudPaths(primary, mobile string) []string {
	if strings.Contains(strings.ToLower(h.loomHUDURL()), "mobile-hud") {
		return []string{mobile, primary}
	}
	return []string{primary, mobile}
}

func (h *Handler) fetchMobileHUDFleet(ctx context.Context) (map[string]any, error) {
	presenceRaw, err := h.fetchHUD(ctx, "/api/mobile/v1/presence")
	if err != nil {
		return nil, err
	}
	tasksRaw, err := h.fetchHUD(ctx, "/api/mobile/v1/tasks")
	if err != nil {
		return nil, err
	}
	workflowsRaw, err := h.fetchHUD(ctx, "/api/mobile/v1/workflows")
	if err != nil {
		return nil, err
	}

	agents, err := normalizeHUDPresenceResponse(presenceRaw)
	if err != nil {
		return nil, err
	}
	claims, err := normalizeHUDClaimsResponse(presenceRaw)
	if err != nil {
		return nil, err
	}
	tasks, err := normalizeHUDTasksResponse(tasksRaw)
	if err != nil {
		return nil, err
	}
	workflows, err := normalizeHUDWorkflowsResponse(workflowsRaw)
	if err != nil {
		return nil, err
	}

	activeAgents := 0
	idleAgents := 0
	offlineAgents := 0
	for _, agent := range agents {
		switch hudString(agent["status"]) {
		case "active":
			activeAgents++
		case "idle":
			idleAgents++
		case "offline":
			offlineAgents++
		}
	}

	workflowsEnvelope, err := parseHUDEnvelope(workflowsRaw)
	if err != nil {
		return nil, err
	}
	pendingApprovals := hudInt(workflowsEnvelope["pending_approvals"])
	if pendingApprovals == 0 {
		pendingApprovals = hudInt(workflowsEnvelope["deprecated_pending_approvals"])
	}
	activeWorkflows := hudInt(workflowsEnvelope["active_workflows"])
	if activeWorkflows == 0 {
		for _, workflow := range workflows {
			status := hudString(workflow["status"])
			if status != "awaiting_approval" && status != "completed" && status != "canceled" && status != "failed" {
				activeWorkflows++
			}
		}
	}

	return map[string]any{
		"sessions": []map[string]any{},
		"agents":   agents,
		"claims":   claims,
		"tasks":    tasks,
		"kpis": map[string]any{
			"pending_approvals": pendingApprovals,
			"running_workflows": activeWorkflows,
			"active_agents":     activeAgents,
			"idle_agents":       idleAgents,
			"offline_agents":    offlineAgents,
			"total_tasks":       len(tasks),
		},
	}, nil
}
