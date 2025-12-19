package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
)

// VLLMListModels lists available models from a vLLM server
func (h *Handler) VLLMListModels(w http.ResponseWriter, r *http.Request) {
	if h.cfg.VLLM.Disabled || h.cfg.VLLM.URL == "" {
		http.Error(w, "vllm disabled", http.StatusServiceUnavailable)
		return
	}

	vllmURL := fmt.Sprintf("%s/v1/models", h.cfg.VLLM.URL)
	proxyRequest(w, vllmURL)
}

// VLLMGetModel gets a specific model info
func (h *Handler) VLLMGetModel(w http.ResponseWriter, r *http.Request) {
	if h.cfg.VLLM.Disabled || h.cfg.VLLM.URL == "" {
		http.Error(w, "vllm disabled", http.StatusServiceUnavailable)
		return
	}

	modelID := chi.URLParam(r, "model")
	if modelID == "" {
		http.Error(w, "missing model id", http.StatusBadRequest)
		return
	}

	vllmURL := fmt.Sprintf("%s/v1/models/%s", h.cfg.VLLM.URL, url.PathEscape(modelID))
	proxyRequest(w, vllmURL)
}

// VLLMHealth checks vLLM server health
func (h *Handler) VLLMHealth(w http.ResponseWriter, r *http.Request) {
	if h.cfg.VLLM.Disabled || h.cfg.VLLM.URL == "" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"healthy":  false,
			"disabled": true,
		})
		return
	}

	// Try to reach vLLM health endpoint
	healthURL := fmt.Sprintf("%s/health", h.cfg.VLLM.URL)
	resp, err := http.Get(healthURL)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"healthy": false,
			"error":   err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"healthy": resp.StatusCode == http.StatusOK,
		"status":  resp.StatusCode,
	})
}

// VLLMChatCompletions proxies chat completion requests to vLLM
func (h *Handler) VLLMChatCompletions(w http.ResponseWriter, r *http.Request) {
	if h.cfg.VLLM.Disabled || h.cfg.VLLM.URL == "" {
		http.Error(w, "vllm disabled", http.StatusServiceUnavailable)
		return
	}

	vllmURL := fmt.Sprintf("%s/v1/chat/completions", h.cfg.VLLM.URL)

	// Create proxy request
	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, vllmURL, r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Copy headers
	proxyReq.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	if auth := r.Header.Get("Authorization"); auth != "" {
		proxyReq.Header.Set("Authorization", auth)
	}

	// Check for streaming
	var bodyBytes []byte
	if r.Body != nil {
		var err error
		bodyBytes, err = io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read request body", http.StatusBadRequest)
			return
		}
		proxyReq.Body = io.NopCloser(strings.NewReader(string(bodyBytes)))
	}

	isStreaming := false
	var reqBody map[string]interface{}
	if len(bodyBytes) > 0 {
		_ = json.Unmarshal(bodyBytes, &reqBody) // Best effort parse for stream detection
		if stream, ok := reqBody["stream"].(bool); ok && stream {
			isStreaming = true
		}
	}

	client := &http.Client{}
	resp, err := client.Do(proxyReq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	// Copy response headers
	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}

	if isStreaming {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
	}

	w.WriteHeader(resp.StatusCode)

	// Stream or copy response
	if isStreaming {
		flusher, ok := w.(http.Flusher)
		if !ok {
			io.Copy(w, resp.Body)
			return
		}

		buf := make([]byte, 1024)
		for {
			n, err := resp.Body.Read(buf)
			if n > 0 {
				w.Write(buf[:n])
				flusher.Flush()
			}
			if err != nil {
				break
			}
		}
	} else {
		io.Copy(w, resp.Body)
	}
}

// VLLMCompletions proxies completion requests to vLLM
func (h *Handler) VLLMCompletions(w http.ResponseWriter, r *http.Request) {
	if h.cfg.VLLM.Disabled || h.cfg.VLLM.URL == "" {
		http.Error(w, "vllm disabled", http.StatusServiceUnavailable)
		return
	}

	vllmURL := fmt.Sprintf("%s/v1/completions", h.cfg.VLLM.URL)

	proxyReq, err := http.NewRequestWithContext(r.Context(), r.Method, vllmURL, r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	proxyReq.Header.Set("Content-Type", r.Header.Get("Content-Type"))

	client := &http.Client{}
	resp, err := client.Do(proxyReq)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, vv := range resp.Header {
		for _, v := range vv {
			w.Header().Add(k, v)
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
