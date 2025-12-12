package handlers

import (
	"fmt"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"
)

func (h *Handler) LokiLabels(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Loki.Disabled || h.cfg.Loki.URL == "" {
		http.Error(w, "loki disabled", http.StatusServiceUnavailable)
		return
	}

	lokiURL := fmt.Sprintf("%s/loki/api/v1/labels", h.cfg.Loki.URL)
	proxyRequest(w, lokiURL)
}

func (h *Handler) LokiLabelValues(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Loki.Disabled || h.cfg.Loki.URL == "" {
		http.Error(w, "loki disabled", http.StatusServiceUnavailable)
		return
	}

	name := chi.URLParam(r, "name")
	if name == "" {
		http.Error(w, "missing label name", http.StatusBadRequest)
		return
	}

	lokiURL := fmt.Sprintf("%s/loki/api/v1/label/%s/values", h.cfg.Loki.URL, url.PathEscape(name))
	proxyRequest(w, lokiURL)
}

func (h *Handler) LokiQuery(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Loki.Disabled || h.cfg.Loki.URL == "" {
		http.Error(w, "loki disabled", http.StatusServiceUnavailable)
		return
	}

	query := r.URL.Query().Get("query")
	if query == "" {
		http.Error(w, "missing query parameter", http.StatusBadRequest)
		return
	}

	lokiURL := fmt.Sprintf("%s/loki/api/v1/query?query=%s", h.cfg.Loki.URL, url.QueryEscape(query))

	if limit := r.URL.Query().Get("limit"); limit != "" {
		lokiURL += "&limit=" + url.QueryEscape(limit)
	}
	if time := r.URL.Query().Get("time"); time != "" {
		lokiURL += "&time=" + url.QueryEscape(time)
	}
	if direction := r.URL.Query().Get("direction"); direction != "" {
		lokiURL += "&direction=" + url.QueryEscape(direction)
	}

	proxyRequest(w, lokiURL)
}

func (h *Handler) LokiQueryRange(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Loki.Disabled || h.cfg.Loki.URL == "" {
		http.Error(w, "loki disabled", http.StatusServiceUnavailable)
		return
	}

	query := r.URL.Query().Get("query")
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")

	if query == "" {
		http.Error(w, "missing query parameter", http.StatusBadRequest)
		return
	}

	lokiURL := fmt.Sprintf("%s/loki/api/v1/query_range?query=%s", h.cfg.Loki.URL, url.QueryEscape(query))

	if start != "" {
		lokiURL += "&start=" + url.QueryEscape(start)
	}
	if end != "" {
		lokiURL += "&end=" + url.QueryEscape(end)
	}
	if limit := r.URL.Query().Get("limit"); limit != "" {
		lokiURL += "&limit=" + url.QueryEscape(limit)
	}
	if step := r.URL.Query().Get("step"); step != "" {
		lokiURL += "&step=" + url.QueryEscape(step)
	}
	if direction := r.URL.Query().Get("direction"); direction != "" {
		lokiURL += "&direction=" + url.QueryEscape(direction)
	}

	proxyRequest(w, lokiURL)
}

// LokiTailSSE implements Server-Sent Events for real-time log streaming.
// It bridges Loki's WebSocket tail endpoint to SSE for browser compatibility.
func (h *Handler) LokiTailSSE(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Loki.Disabled || h.cfg.Loki.URL == "" {
		http.Error(w, "loki disabled", http.StatusServiceUnavailable)
		return
	}

	query := r.URL.Query().Get("query")
	if query == "" {
		http.Error(w, "missing query parameter", http.StatusBadRequest)
		return
	}

	// TODO: Implement WebSocket-to-SSE bridge
	// For now, return not implemented
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	// Send ready event
	fmt.Fprintf(w, "event: ready\ndata: {\"ok\":true,\"message\":\"SSE bridge not yet implemented\"}\n\n")
	flusher.Flush()

	// Keep connection open briefly then close
	// Full implementation will use gorilla/websocket to connect to Loki
	<-r.Context().Done()
}
