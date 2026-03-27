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
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:fleet", 15*time.Second, "hud fleet", func() (any, error) {
		raw, err := h.fetchHUD(r.Context(), "/api/fleet")
		if err != nil {
			return nil, err
		}
		return normalizeHUDFleetResponse(raw)
	})
}

// HUDPresence returns agent presence data from the Loom HUD API.
func (h *Handler) HUDPresence(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:presence", 10*time.Second, "hud presence", func() (any, error) {
		raw, err := h.fetchHUD(r.Context(), "/api/presence")
		if err != nil {
			return nil, err
		}
		return normalizeHUDPresenceResponse(raw)
	})
}

// HUDTasks returns task data from the Loom HUD API.
func (h *Handler) HUDTasks(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:tasks", 15*time.Second, "hud tasks", func() (any, error) {
		raw, err := h.fetchHUD(r.Context(), "/api/tasks")
		if err != nil {
			return nil, err
		}
		return normalizeHUDTasksResponse(raw)
	})
}

// HUDWorkflows returns workflow data from the Loom HUD API.
func (h *Handler) HUDWorkflows(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:workflows", 10*time.Second, "hud workflows", func() (any, error) {
		raw, err := h.fetchHUD(r.Context(), "/api/workflows")
		if err != nil {
			return nil, err
		}
		return normalizeHUDWorkflowsResponse(r.Context(), h.fetchHUDWorkflowDetail, raw)
	})
}

// HUDTimeline returns timeline events from the Loom HUD API.
func (h *Handler) HUDTimeline(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:timeline", 5*time.Second, "hud timeline", func() (any, error) {
		raw, err := h.fetchHUD(r.Context(), "/api/timeline")
		if err != nil {
			return nil, err
		}
		return normalizeHUDTimelineResponse(raw)
	})
}

// HUDClaims returns file claim data from the Loom HUD API.
func (h *Handler) HUDClaims(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "hud:claims", 10*time.Second, "hud claims", func() (any, error) {
		raw, err := h.fetchHUD(r.Context(), "/api/claims")
		if err != nil {
			return nil, err
		}
		return normalizeHUDClaimsResponse(raw)
	})
}

// HUDWorkflowApprove approves a workflow step that requires human approval.
func (h *Handler) HUDWorkflowApprove(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	id := chi.URLParam(r, "id")
	path := fmt.Sprintf("/api/workflows/%s/approve", id)

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

	result, err := h.postHUD(r.Context(), path, body)
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
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	id := chi.URLParam(r, "id")
	path := fmt.Sprintf("/api/workflows/%s/reject", id)

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

	result, err := h.postHUD(r.Context(), path, body)
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
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	id := chi.URLParam(r, "id")
	path := fmt.Sprintf("/api/workflows/%s/cancel", id)

	body, err := io.ReadAll(io.LimitReader(r.Body, maxHUDRequestBody))
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "failed to read request body"})
		return
	}

	result, err := h.postHUD(r.Context(), path, body)
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
		return nil, fmt.Errorf("hud returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read hud response: %w", err)
	}

	return json.RawMessage(body), nil
}

func (h *Handler) fetchHUDWorkflowDetail(ctx context.Context, workflowID string) (json.RawMessage, error) {
	return h.fetchHUD(ctx, fmt.Sprintf("/api/workflows/%s", workflowID))
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

// postHUD makes a POST request to the Loom HUD REST API.
func (h *Handler) postHUD(ctx context.Context, path string, body []byte) ([]byte, error) {
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
		return nil, fmt.Errorf("hud returned %d: %s", resp.StatusCode, string(result))
	}

	return result, nil
}
