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

// GrafanaDashboards lists all Grafana dashboards.
func (h *Handler) GrafanaDashboards(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Grafana.Disabled || h.cfg.Grafana.URL == "" {
		respondJSON(w, http.StatusOK, []any{})
		return
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "grafana:dashboards", 60*time.Second, func() (any, error) {
			return h.fetchGrafanaAPI("/api/search?type=dash-db")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn("grafana dashboards cache error", "error", err)
	}

	data, err := h.fetchGrafanaAPI("/api/search?type=dash-db")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// GrafanaDashboardDetail returns detail for a specific dashboard by UID.
func (h *Handler) GrafanaDashboardDetail(w http.ResponseWriter, r *http.Request) {
	uid := chi.URLParam(r, "uid")
	if h.cfg.Grafana.Disabled || h.cfg.Grafana.URL == "" {
		respondJSON(w, http.StatusOK, map[string]any{})
		return
	}

	ctx := r.Context()
	cacheKey := fmt.Sprintf("grafana:dashboard:%s", uid)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, cacheKey, 30*time.Second, func() (any, error) {
			return h.fetchGrafanaAPI(fmt.Sprintf("/api/dashboards/uid/%s", uid))
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn("grafana dashboard detail cache error", "error", err)
	}

	data, err := h.fetchGrafanaAPI(fmt.Sprintf("/api/dashboards/uid/%s", uid))
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// GrafanaDatasources lists all Grafana datasources.
func (h *Handler) GrafanaDatasources(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Grafana.Disabled || h.cfg.Grafana.URL == "" {
		respondJSON(w, http.StatusOK, []any{})
		return
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "grafana:datasources", 5*time.Minute, func() (any, error) {
			return h.fetchGrafanaAPI("/api/datasources")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn("grafana datasources cache error", "error", err)
	}

	data, err := h.fetchGrafanaAPI("/api/datasources")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// fetchGrafanaAPI makes an authenticated request to the Grafana HTTP API and
// returns the raw JSON response body as a json.RawMessage so it can be cached
// and forwarded without re-encoding.
func (h *Handler) fetchGrafanaAPI(path string) (any, error) {
	url := strings.TrimSuffix(h.cfg.Grafana.URL, "/") + path
	token := strings.TrimSpace(h.cfg.Grafana.Token)

	slog.Debug("fetching grafana api", "url", url)

	client := &http.Client{Timeout: 10 * time.Second}
	doRequest := func(authToken string) (*http.Response, error) {
		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return nil, fmt.Errorf("create grafana request: %w", err)
		}
		if authToken != "" {
			req.Header.Set("Authorization", "Bearer "+authToken)
		}
		req.Header.Set("Accept", "application/json")
		return client.Do(req)
	}

	resp, err := doRequest(token)
	if err != nil {
		slog.Error("grafana request failed", "url", url, "error", err)
		return nil, fmt.Errorf("grafana request failed: %w", err)
	}

	if (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) && token != "" {
		_ = resp.Body.Close()
		slog.Warn("grafana token rejected, retrying anonymous request", "url", url, "status", resp.StatusCode)
		resp, err = doRequest("")
		if err != nil {
			slog.Error("grafana anonymous retry failed", "url", url, "error", err)
			return nil, fmt.Errorf("grafana request failed after anonymous retry: %w", err)
		}
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024)) // Limit read to 1KB
		errMsg := strings.TrimSpace(string(body))

		slog.Warn("grafana api returned non-200", "url", url, "status", resp.StatusCode, "body_preview", errMsg)

		// Robust HTML detection
		lowerMsg := strings.ToLower(errMsg)
		if strings.Contains(lowerMsg, "<!doctype html>") || strings.Contains(lowerMsg, "<html") {
			errMsg = "received HTML error page instead of JSON (check Grafana URL/connectivity)"
		}

		if len(errMsg) > 256 {
			errMsg = errMsg[:253] + "..."
		}
		return nil, fmt.Errorf("grafana API error %d: %s", resp.StatusCode, errMsg)
	}

	var raw any
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read grafana response: %w", err)
	}

	if looksLikeHTMLResponse(resp.Header.Get("Content-Type"), body) {
		slog.Warn("grafana api returned HTML payload", "url", url, "content_type", resp.Header.Get("Content-Type"))
		return nil, fmt.Errorf("grafana API returned HTML instead of JSON (check GRAFANA_URL/auth)")
	}

	// Parse to validate JSON, then return as-is for cache compatibility
	if err := json.Unmarshal(body, &raw); err != nil {
		slog.Error("failed to decode grafana json", "url", url, "body_preview", string(body[:min(len(body), 100)]))
		return nil, fmt.Errorf("decode grafana response: %w", err)
	}

	return raw, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func looksLikeHTMLResponse(contentType string, body []byte) bool {
	lowerType := strings.ToLower(strings.TrimSpace(contentType))
	if strings.Contains(lowerType, "text/html") || strings.Contains(lowerType, "application/xhtml+xml") {
		return true
	}

	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return false
	}

	lowerBody := bytes.ToLower(trimmed[:min(len(trimmed), 256)])
	return bytes.HasPrefix(lowerBody, []byte("<!doctype html")) || bytes.HasPrefix(lowerBody, []byte("<html"))
}
