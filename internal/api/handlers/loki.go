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

	"github.com/flexinfer/flexdeck/internal/api/handlers/apiutil"
)

func (h *Handler) LokiLabels(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Loki.Disabled || h.cfg.Loki.URL == "" {
		apiutil.RespondError(w, http.StatusServiceUnavailable, "LOKI_DISABLED", "loki is disabled")
		return
	}

	lokiURL := apiutil.NewURLBuilder(h.cfg.Loki.URL).RawPath("/loki/api/v1/labels").String()
	apiutil.ProxyRequest(w, lokiURL)
}

func (h *Handler) LokiLabelValues(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Loki.Disabled || h.cfg.Loki.URL == "" {
		apiutil.RespondError(w, http.StatusServiceUnavailable, "LOKI_DISABLED", "loki is disabled")
		return
	}

	name := chi.URLParam(r, "name")
	if name == "" {
		apiutil.RespondError(w, http.StatusBadRequest, "MISSING_PARAM", "missing label name")
		return
	}

	lokiURL := apiutil.NewURLBuilder(h.cfg.Loki.URL).
		RawPath("/loki/api/v1/label").
		Path(name).
		RawPath("/values").
		String()
	apiutil.ProxyRequest(w, lokiURL)
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
				data, err := json.Marshal(lokiResp)
				if err != nil {
					log.Printf("Failed to marshal Loki response: %v", err)
					continue
				}
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

// LokiExport exports logs as JSON or CSV for download.
// GET /api/loki/export?query=...&start=...&end=...&format=json|csv
func (h *Handler) LokiExport(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Loki.Disabled || h.cfg.Loki.URL == "" {
		http.Error(w, "loki disabled", http.StatusServiceUnavailable)
		return
	}

	query := r.URL.Query().Get("query")
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")
	format := r.URL.Query().Get("format")

	if query == "" {
		http.Error(w, "missing query parameter", http.StatusBadRequest)
		return
	}
	if format == "" {
		format = "json"
	}
	if format != "json" && format != "csv" {
		http.Error(w, "format must be json or csv", http.StatusBadRequest)
		return
	}

	// Build Loki query_range URL
	lokiURL := fmt.Sprintf("%s/loki/api/v1/query_range?query=%s&limit=5000&direction=backward",
		h.cfg.Loki.URL, url.QueryEscape(query))

	if start != "" {
		lokiURL += "&start=" + url.QueryEscape(start)
	}
	if end != "" {
		lokiURL += "&end=" + url.QueryEscape(end)
	}

	// Fetch from Loki
	resp, err := http.Get(lokiURL)
	if err != nil {
		log.Printf("Loki export request failed: %v", err)
		http.Error(w, "failed to fetch logs", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("Loki returned status %d", resp.StatusCode)
		http.Error(w, "loki query failed", http.StatusBadGateway)
		return
	}

	var lokiResp lokiQueryRangeResponse
	if err := json.NewDecoder(resp.Body).Decode(&lokiResp); err != nil {
		log.Printf("Failed to decode Loki response: %v", err)
		http.Error(w, "failed to parse logs", http.StatusInternalServerError)
		return
	}

	// Parse logs into export format
	var entries []logExportEntry
	for _, stream := range lokiResp.Data.Result {
		for _, value := range stream.Values {
			if len(value) >= 2 {
				entries = append(entries, logExportEntry{
					Timestamp: value[0],
					Message:   value[1],
					Labels:    stream.Stream,
				})
			}
		}
	}

	// Generate filename
	timestamp := time.Now().Format("20060102-150405")
	filename := fmt.Sprintf("logs-%s.%s", timestamp, format)

	// Set download headers
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))

	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		if err := enc.Encode(entries); err != nil {
			log.Printf("Failed to encode JSON: %v", err)
		}
	} else {
		w.Header().Set("Content-Type", "text/csv")
		// Write CSV header
		fmt.Fprintln(w, "timestamp,level,namespace,pod,message")
		for _, entry := range entries {
			level := entry.Labels["level"]
			if level == "" {
				level = "info"
			}
			namespace := entry.Labels["namespace"]
			pod := entry.Labels["pod"]
			// Escape message for CSV (double quotes, escape internal quotes)
			msg := strings.ReplaceAll(entry.Message, "\"", "\"\"")
			fmt.Fprintf(w, "%s,%s,%s,%s,\"%s\"\n", entry.Timestamp, level, namespace, pod, msg)
		}
	}
}

// lokiQueryRangeResponse represents the Loki query_range response
type lokiQueryRangeResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string       `json:"resultType"`
		Result     []lokiStream `json:"result"`
	} `json:"data"`
}

// logExportEntry represents a log entry for export
type logExportEntry struct {
	Timestamp string            `json:"timestamp"`
	Message   string            `json:"message"`
	Labels    map[string]string `json:"labels"`
}
