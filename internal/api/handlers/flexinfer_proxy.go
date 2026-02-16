package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// FlexInferProxyHealth proxies the FlexInfer proxy healthz endpoint.
func (h *Handler) FlexInferProxyHealth(w http.ResponseWriter, r *http.Request) {
	if h.cfg.FlexInferProxy.Disabled || h.cfg.FlexInferProxy.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "flexinfer proxy disabled"})
		return
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "fip:health", 10*time.Second, func() (any, error) {
			return h.fetchFlexInferProxy("/healthz")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
		slog.Warn("flexinfer proxy health cache error", "error", err)
	}

	data, err := h.fetchFlexInferProxy("/healthz")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// FlexInferProxyModels proxies the FlexInfer proxy /v1/models endpoint.
func (h *Handler) FlexInferProxyModels(w http.ResponseWriter, r *http.Request) {
	if h.cfg.FlexInferProxy.Disabled || h.cfg.FlexInferProxy.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "flexinfer proxy disabled"})
		return
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "fip:models", 15*time.Second, func() (any, error) {
			return h.fetchFlexInferProxy("/v1/models")
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
		slog.Warn("flexinfer proxy models cache error", "error", err)
	}

	data, err := h.fetchFlexInferProxy("/v1/models")
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// FlexInferProxyMetrics proxies the FlexInfer proxy /metrics endpoint
// and parses Prometheus text format into structured JSON.
func (h *Handler) FlexInferProxyMetrics(w http.ResponseWriter, r *http.Request) {
	if h.cfg.FlexInferProxy.Disabled || h.cfg.FlexInferProxy.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "flexinfer proxy disabled"})
		return
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "fip:metrics", 15*time.Second, func() (any, error) {
			return h.fetchFlexInferProxyMetrics()
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
		slog.Warn("flexinfer proxy metrics cache error", "error", err)
	}

	data, err := h.fetchFlexInferProxyMetrics()
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// fetchFlexInferProxy makes a request to the FlexInfer proxy and returns the response as JSON.
func (h *Handler) fetchFlexInferProxy(path string) (any, error) {
	url := strings.TrimSuffix(h.cfg.FlexInferProxy.URL, "/") + path

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("flexinfer proxy request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("flexinfer proxy error %d: %s", resp.StatusCode, string(body))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read flexinfer proxy response: %w", err)
	}

	var raw any
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("decode flexinfer proxy response: %w", err)
	}

	return raw, nil
}

// fetchFlexInferProxyMetrics fetches the Prometheus-format /metrics endpoint
// and extracts key flexinfer_proxy_* metrics into structured JSON.
func (h *Handler) fetchFlexInferProxyMetrics() (any, error) {
	url := strings.TrimSuffix(h.cfg.FlexInferProxy.URL, "/") + "/metrics"

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, fmt.Errorf("flexinfer proxy metrics request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("flexinfer proxy metrics error %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read metrics body: %w", err)
	}

	return parsePrometheusMetrics(body), nil
}

// parsePrometheusMetrics extracts key flexinfer_proxy_* metrics from Prometheus
// text format into a structured map suitable for JSON serialization.
func parsePrometheusMetrics(body []byte) map[string]any {
	lines := strings.Split(string(body), "\n")
	metrics := map[string]any{
		"requests":    map[string]float64{},
		"latency":     map[string]float64{},
		"queue_depth": map[string]float64{},
		"active_conn": map[string]float64{},
		"scale_ups":   map[string]float64{},
	}

	prefixes := map[string]string{
		"flexinfer_proxy_requests_total":            "requests",
		"flexinfer_proxy_request_duration_seconds":  "latency",
		"flexinfer_proxy_queue_depth":               "queue_depth",
		"flexinfer_proxy_active_connections":         "active_conn",
		"flexinfer_proxy_scale_ups_total":           "scale_ups",
	}

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		for prefix, category := range prefixes {
			if strings.HasPrefix(line, prefix) {
				model := extractLabel(line, "model")
				if model == "" {
					model = "_total"
				}
				value := extractMetricValue(line)
				if m, ok := metrics[category].(map[string]float64); ok {
					m[model] = value
				}
				break
			}
		}
	}

	return metrics
}

// extractLabel pulls a label value from a Prometheus metric line.
func extractLabel(line, label string) string {
	key := label + `="`
	idx := strings.Index(line, key)
	if idx < 0 {
		return ""
	}
	start := idx + len(key)
	end := strings.Index(line[start:], `"`)
	if end < 0 {
		return ""
	}
	return line[start : start+end]
}

// extractMetricValue pulls the numeric value from the end of a Prometheus metric line.
func extractMetricValue(line string) float64 {
	parts := strings.Fields(line)
	if len(parts) < 2 {
		return 0
	}
	var v float64
	fmt.Sscanf(parts[len(parts)-1], "%f", &v)
	return v
}
