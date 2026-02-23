package apiutil

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// SSEWriter wraps http.ResponseWriter for Server-Sent Events.
type SSEWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

// NewSSEWriter creates an SSE writer and sets appropriate headers.
// Returns an error if streaming is not supported.
func NewSSEWriter(w http.ResponseWriter) (*SSEWriter, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("streaming not supported")
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	return &SSEWriter{w: w, flusher: flusher}, nil
}

// SendEvent sends a named SSE event with JSON data.
func (s *SSEWriter) SendEvent(event string, data any) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(s.w, "event: %s\ndata: %s\n\n", event, jsonData)
	s.flusher.Flush()
	return nil
}

// SendData sends an unnamed SSE data message with JSON data.
func (s *SSEWriter) SendData(data any) error {
	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(s.w, "data: %s\n\n", jsonData)
	s.flusher.Flush()
	return nil
}

// SendRaw sends raw string data without JSON encoding.
func (s *SSEWriter) SendRaw(data string) {
	_, _ = fmt.Fprintf(s.w, "data: %s\n\n", data)
	s.flusher.Flush()
}

// SendReady sends a ready event to indicate connection is established.
func (s *SSEWriter) SendReady() {
	_ = s.SendEvent("ready", map[string]bool{"ok": true})
}

// SendError sends an error event.
func (s *SSEWriter) SendError(message string) {
	_ = s.SendEvent("error", map[string]string{"error": message})
}

// Flush forces a flush of any buffered data.
func (s *SSEWriter) Flush() {
	s.flusher.Flush()
}
