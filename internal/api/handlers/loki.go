package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
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

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	// Build Loki WebSocket URL
	lokiURL := h.cfg.Loki.URL
	lokiURL = strings.Replace(lokiURL, "http://", "ws://", 1)
	lokiURL = strings.Replace(lokiURL, "https://", "wss://", 1)

	wsURL := fmt.Sprintf("%s/loki/api/v1/tail?query=%s", lokiURL, url.QueryEscape(query))
	if delay := r.URL.Query().Get("delay_for"); delay != "" {
		wsURL += "&delay_for=" + url.QueryEscape(delay)
	}
	if limit := r.URL.Query().Get("limit"); limit != "" {
		wsURL += "&limit=" + url.QueryEscape(limit)
	}
	if start := r.URL.Query().Get("start"); start != "" {
		wsURL += "&start=" + url.QueryEscape(start)
	}

	// Connect to Loki WebSocket
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.Dial(wsURL, nil)
	if err != nil {
		log.Printf("Failed to connect to Loki WebSocket: %v", err)
		// Send error as SSE event
		fmt.Fprintf(w, "event: error\ndata: {\"error\":\"%s\"}\n\n", "Failed to connect to Loki")
		flusher.Flush()
		return
	}
	defer conn.Close()

	// Send ready event
	fmt.Fprintf(w, "event: ready\ndata: {\"ok\":true}\n\n")
	flusher.Flush()

	// Create done channel for cleanup
	done := make(chan struct{})

	// Handle client disconnect
	go func() {
		<-r.Context().Done()
		close(done)
		conn.Close()
	}()

	// Read from WebSocket and write to SSE
	for {
		select {
		case <-done:
			return
		default:
			// Set read deadline
			conn.SetReadDeadline(time.Now().Add(30 * time.Second))

			_, message, err := conn.ReadMessage()
			if err != nil {
				if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					return
				}
				// Check if context was cancelled
				select {
				case <-done:
					return
				default:
				}
				log.Printf("Loki WebSocket read error: %v", err)
				fmt.Fprintf(w, "event: error\ndata: {\"error\":\"connection lost\"}\n\n")
				flusher.Flush()
				return
			}

			// Parse the Loki response and forward as SSE
			var lokiResp lokiTailResponse
			if err := json.Unmarshal(message, &lokiResp); err != nil {
				log.Printf("Failed to parse Loki response: %v", err)
				continue
			}

			// Send each stream as a log event
			if len(lokiResp.Streams) > 0 {
				data, _ := json.Marshal(lokiResp)
				fmt.Fprintf(w, "data: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}

// lokiTailResponse represents the Loki tail WebSocket response
type lokiTailResponse struct {
	Streams []lokiStream `json:"streams"`
}

type lokiStream struct {
	Stream map[string]string `json:"stream"`
	Values [][]string        `json:"values"`
}
