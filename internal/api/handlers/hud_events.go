package handlers

import (
	"bufio"
	"log/slog"
	"net/http"
	"strings"
)

// sseClient is a shared HTTP client for SSE connections (no timeout).
var sseClient = &http.Client{Timeout: 0}

// HUDEventsSSE proxies the Loom HUD SSE events stream to the browser.
func (h *Handler) HUDEventsSSE(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LoomHUD.Disabled || h.cfg.LoomHUD.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "loom hud disabled"})
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": "streaming not supported"})
		return
	}

	// Connect to upstream HUD SSE stream
	url := strings.TrimSuffix(h.cfg.LoomHUD.URL, "/") + "/api/events"

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to create request"})
		return
	}
	req.Header.Set("Accept", "text/event-stream")

	resp, err := sseClient.Do(req)
	if err != nil {
		slog.Warn("HUD events SSE: upstream connection failed", "error", err)
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": "failed to connect to HUD events stream"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": "HUD events stream returned non-OK"})
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher.Flush()

	// Proxy SSE lines from upstream to downstream
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		select {
		case <-r.Context().Done():
			return
		default:
			line := normalizeHUDSSEDataLine(scanner.Text())
			_, _ = w.Write([]byte(line + "\n"))
			// Flush on empty line (end of SSE event) or data lines
			if line == "" || strings.HasPrefix(line, "data:") {
				flusher.Flush()
			}
		}
	}

	if err := scanner.Err(); err != nil {
		slog.Debug("HUD events SSE: scanner error", "error", err)
	}
}
