package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// AlertmanagerAlerts returns active alerts from Alertmanager
func (h *Handler) AlertmanagerAlerts(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Alertmanager.Disabled || h.cfg.Alertmanager.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "alertmanager disabled"})
		return
	}

	if h.cache != nil {
		cached, err := h.cache.GetOrFetchSmooth(r.Context(), "am:alerts", 15*time.Second, func() (any, error) {
			return h.fetchAlertmanager(r.Context(), "/api/v2/alerts")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
	}

	result, err := h.fetchAlertmanager(r.Context(), "/api/v2/alerts")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

// AlertmanagerSilences returns silences from Alertmanager
func (h *Handler) AlertmanagerSilences(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Alertmanager.Disabled || h.cfg.Alertmanager.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "alertmanager disabled"})
		return
	}

	if h.cache != nil {
		cached, err := h.cache.GetOrFetchSmooth(r.Context(), "am:silences", 15*time.Second, func() (any, error) {
			return h.fetchAlertmanager(r.Context(), "/api/v2/silences")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
	}

	result, err := h.fetchAlertmanager(r.Context(), "/api/v2/silences")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

// AlertmanagerStatus returns Alertmanager status
func (h *Handler) AlertmanagerStatus(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Alertmanager.Disabled || h.cfg.Alertmanager.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "alertmanager disabled"})
		return
	}

	if h.cache != nil {
		cached, err := h.cache.GetOrFetchSmooth(r.Context(), "am:status", 60*time.Second, func() (any, error) {
			return h.fetchAlertmanager(r.Context(), "/api/v2/status")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
	}

	result, err := h.fetchAlertmanager(r.Context(), "/api/v2/status")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

// AlertmanagerCreateSilence creates a new silence
func (h *Handler) AlertmanagerCreateSilence(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Alertmanager.Disabled || h.cfg.Alertmanager.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "alertmanager disabled"})
		return
	}

	targetURL := h.cfg.Alertmanager.URL + "/api/v2/silences"

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, targetURL, r.Body)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	// Invalidate caches
	if h.cache != nil {
		h.cache.Invalidate(r.Context(), "am:silences")
		h.cache.Invalidate(r.Context(), "am:alerts")
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

// AlertmanagerDeleteSilence deletes a silence by ID
func (h *Handler) AlertmanagerDeleteSilence(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Alertmanager.Disabled || h.cfg.Alertmanager.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "alertmanager disabled"})
		return
	}

	id := chi.URLParam(r, "id")
	targetURL := fmt.Sprintf("%s/api/v2/silence/%s", h.cfg.Alertmanager.URL, id)

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodDelete, targetURL, nil)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	resp, err := client.Do(req)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	// Invalidate caches
	if h.cache != nil {
		h.cache.Invalidate(r.Context(), "am:silences")
		h.cache.Invalidate(r.Context(), "am:alerts")
	}

	w.WriteHeader(resp.StatusCode)
	if resp.StatusCode == http.StatusOK {
		respondJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": id})
	} else {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.Copy(w, resp.Body)
	}
}

func (h *Handler) fetchAlertmanager(ctx context.Context, path string) (json.RawMessage, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.cfg.Alertmanager.URL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("create alertmanager request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("alertmanager request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("alertmanager returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	return json.RawMessage(body), nil
}
