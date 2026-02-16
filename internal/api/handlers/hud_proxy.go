package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// HUDFleet returns the full fleet view from the Loom HUD API.
func (h *Handler) HUDFleet(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "hud:fleet", 15*time.Second, func() (any, error) {
			return h.fetchHUD("/api/fleet")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
		slog.Warn("hud fleet cache error", "error", err)
	}

	data, err := h.fetchHUD("/api/fleet")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// HUDPresence returns agent presence data from the Loom HUD API.
func (h *Handler) HUDPresence(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "hud:presence", 10*time.Second, func() (any, error) {
			return h.fetchHUD("/api/presence")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
		slog.Warn("hud presence cache error", "error", err)
	}

	data, err := h.fetchHUD("/api/presence")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// HUDTasks returns task data from the Loom HUD API.
func (h *Handler) HUDTasks(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "hud:tasks", 15*time.Second, func() (any, error) {
			return h.fetchHUD("/api/tasks")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
		slog.Warn("hud tasks cache error", "error", err)
	}

	data, err := h.fetchHUD("/api/tasks")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// HUDWorkflows returns workflow data from the Loom HUD API.
func (h *Handler) HUDWorkflows(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "hud:workflows", 10*time.Second, func() (any, error) {
			return h.fetchHUD("/api/workflows")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
		slog.Warn("hud workflows cache error", "error", err)
	}

	data, err := h.fetchHUD("/api/workflows")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// HUDTimeline returns timeline events from the Loom HUD API.
func (h *Handler) HUDTimeline(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "hud:timeline", 5*time.Second, func() (any, error) {
			return h.fetchHUD("/api/timeline")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
		slog.Warn("hud timeline cache error", "error", err)
	}

	data, err := h.fetchHUD("/api/timeline")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// HUDWorkflowApprove approves a workflow step that requires human approval.
func (h *Handler) HUDWorkflowApprove(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	id := chi.URLParam(r, "id")
	path := fmt.Sprintf("/api/workflows/%s/approve", id)

	body, _ := io.ReadAll(r.Body)
	result, err := h.postHUD(path, body)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	// Invalidate workflows cache
	if h.cache != nil {
		h.cache.Invalidate(r.Context(), "hud:workflows")
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(result)
}

// HUDWorkflowReject rejects a workflow step.
func (h *Handler) HUDWorkflowReject(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	id := chi.URLParam(r, "id")
	path := fmt.Sprintf("/api/workflows/%s/reject", id)

	body, _ := io.ReadAll(r.Body)
	result, err := h.postHUD(path, body)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	// Invalidate workflows cache
	if h.cache != nil {
		h.cache.Invalidate(r.Context(), "hud:workflows")
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(result)
}

// fetchHUD makes a GET request to the Loom HUD REST API.
func (h *Handler) fetchHUD(path string) (json.RawMessage, error) {
	url := strings.TrimSuffix(h.cfg.LoomHUD.URL, "/") + path

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("hud request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hud returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read hud response: %w", err)
	}

	return json.RawMessage(body), nil
}

// postHUD makes a POST request to the Loom HUD REST API.
func (h *Handler) postHUD(path string, body []byte) ([]byte, error) {
	url := strings.TrimSuffix(h.cfg.LoomHUD.URL, "/") + path

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create hud request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("hud post request failed: %w", err)
	}
	defer resp.Body.Close()

	result, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read hud response: %w", err)
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("hud returned %d: %s", resp.StatusCode, string(result))
	}

	return result, nil
}
