package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

func (h *Handler) PromHealth(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":    false,
			"error": "prometheus disabled",
		})
		return
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(h.cfg.Prom.URL + "/-/healthy")
	if err != nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}
	defer resp.Body.Close()

	respondJSON(w, http.StatusOK, map[string]any{
		"ok":     resp.StatusCode == http.StatusOK,
		"status": resp.StatusCode,
	})
}

func (h *Handler) PromQuery(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		http.Error(w, "prometheus disabled", http.StatusServiceUnavailable)
		return
	}

	query := r.URL.Query().Get("query")
	if query == "" {
		http.Error(w, "missing query parameter", http.StatusBadRequest)
		return
	}

	promURL := fmt.Sprintf("%s/api/v1/query?query=%s",
		h.cfg.Prom.URL,
		url.QueryEscape(query),
	)

	if t := r.URL.Query().Get("time"); t != "" {
		promURL += "&time=" + url.QueryEscape(t)
	}

	proxyRequest(w, promURL)
}

func (h *Handler) PromQueryRange(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		http.Error(w, "prometheus disabled", http.StatusServiceUnavailable)
		return
	}

	query := r.URL.Query().Get("query")
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")
	step := r.URL.Query().Get("step")

	if query == "" || start == "" || end == "" {
		http.Error(w, "missing required parameters (query, start, end)", http.StatusBadRequest)
		return
	}

	if step == "" {
		step = "60" // Default 1 minute
	}

	promURL := fmt.Sprintf("%s/api/v1/query_range?query=%s&start=%s&end=%s&step=%s",
		h.cfg.Prom.URL,
		url.QueryEscape(query),
		url.QueryEscape(start),
		url.QueryEscape(end),
		url.QueryEscape(step),
	)

	proxyRequest(w, promURL)
}

func proxyRequest(w http.ResponseWriter, targetURL string) {
	client := &http.Client{Timeout: 30 * time.Second}

	resp, err := client.Get(targetURL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func respondJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
