package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/flexinfer/flexdeck/internal/api/handlers/apiutil"
)

// FlexInferProxyHealth proxies the FlexInfer proxy healthz endpoint.
func (h *Handler) FlexInferProxyHealth(w http.ResponseWriter, r *http.Request) {
	if h.cfg.FlexInferProxy.Disabled || h.cfg.FlexInferProxy.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "flexinfer proxy disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "fip:health", 10*time.Second, "flexinfer proxy health", func() (any, error) {
		return h.fetchFlexInferProxy(r.Context(), "/healthz")
	})
}

// FlexInferProxyModels proxies the FlexInfer proxy /v1/models endpoint.
func (h *Handler) FlexInferProxyModels(w http.ResponseWriter, r *http.Request) {
	if h.cfg.FlexInferProxy.Disabled || h.cfg.FlexInferProxy.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "flexinfer proxy disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "fip:models", 15*time.Second, "flexinfer proxy models", func() (any, error) {
		return h.fetchFlexInferProxy(r.Context(), "/v1/models")
	})
}

// FlexInferProxyMetrics proxies the FlexInfer proxy /metrics endpoint
// and parses Prometheus text format into structured JSON.
func (h *Handler) FlexInferProxyMetrics(w http.ResponseWriter, r *http.Request) {
	if h.cfg.FlexInferProxy.Disabled || h.cfg.FlexInferProxy.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "flexinfer proxy disabled"})
		return
	}
	h.cachedProxyJSON(w, r, "fip:metrics", 15*time.Second, "flexinfer proxy metrics", func() (any, error) {
		return h.fetchFlexInferProxyMetrics(r.Context())
	})
}

// cachedProxyJSON handles the cache-aside pattern for proxy JSON endpoints.
// Used by FlexInfer proxy, HUD proxy, and LoRA handlers to avoid duplication.
func (h *Handler) cachedProxyJSON(w http.ResponseWriter, r *http.Request, cacheKey string, ttl time.Duration, label string, fetchFn func() (any, error)) {
	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, cacheKey, ttl, fetchFn)
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn(label+" cache error", "error", err)
	}

	data, err := fetchFn()
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// fetchFlexInferProxy makes a request to the FlexInfer proxy and returns the response as JSON.
func (h *Handler) fetchFlexInferProxy(ctx context.Context, path string) (any, error) {
	reqURL := strings.TrimSuffix(h.cfg.FlexInferProxy.URL, "/") + path

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create flexinfer proxy request: %w", err)
	}

	resp, err := apiutil.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("flexinfer proxy request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

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
func (h *Handler) fetchFlexInferProxyMetrics(ctx context.Context) (any, error) {
	reqURL := strings.TrimSuffix(h.cfg.FlexInferProxy.URL, "/") + "/metrics"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create flexinfer proxy metrics request: %w", err)
	}

	resp, err := apiutil.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("flexinfer proxy metrics request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

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
		// Legacy keys retained for compatibility.
		"requests":    map[string]float64{},
		"latency":     map[string]float64{},
		"queue_depth": map[string]float64{},
		"active_conn": map[string]float64{},
		"scale_ups":   map[string]float64{},
		// Normalized fields (additive).
		"byModel":          map[string]map[string]float64{},
		"totals":           map[string]any{},
		"requestsByStatus": map[string]map[string]float64{},
		"partial":          false,
	}

	legacyRequests := metrics["requests"].(map[string]float64)
	legacyLatency := metrics["latency"].(map[string]float64)
	legacyQueueDepth := metrics["queue_depth"].(map[string]float64)
	legacyActiveConn := metrics["active_conn"].(map[string]float64)
	legacyScaleUps := metrics["scale_ups"].(map[string]float64)
	byModel := metrics["byModel"].(map[string]map[string]float64)
	requestsByStatus := metrics["requestsByStatus"].(map[string]map[string]float64)

	parseErrors := 0

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		name, labels, value, ok := parsePrometheusLine(line)
		if !ok {
			parseErrors++
			continue
		}

		model := labels["model"]
		if model == "" {
			model = "_total"
		}

		switch name {
		case "flexinfer_proxy_requests_total":
			ensureModelMetrics(byModel, model)["requestsTotal"] += value
			legacyRequests[model] += value
			status := labels["status"]
			if status == "" {
				status = "unknown"
			}
			if _, ok := requestsByStatus[model]; !ok {
				requestsByStatus[model] = map[string]float64{}
			}
			requestsByStatus[model][status] += value
		case "flexinfer_proxy_request_duration_seconds_sum":
			legacyLatency[model] += value
		case "flexinfer_proxy_queue_depth":
			ensureModelMetrics(byModel, model)["queueDepth"] = value
			legacyQueueDepth[model] = value
		case "flexinfer_proxy_active_connections":
			ensureModelMetrics(byModel, model)["activeConnections"] = value
			legacyActiveConn[model] = value
		case "flexinfer_proxy_scale_ups_total":
			ensureModelMetrics(byModel, model)["scaleUps"] += value
			legacyScaleUps[model] += value
		case "flexinfer_proxy_queue_rejected_total":
			ensureModelMetrics(byModel, model)["queueRejectedTotal"] += value
		case "flexinfer_proxy_queued_requests_total":
			ensureModelMetrics(byModel, model)["queuedRequestsTotal"] += value
		case "flexinfer_proxy_gpugroup_swap_signals_total":
			ensureModelMetrics(byModel, model)["gpuGroupSwapSignalsTotal"] += value
		case "flexinfer_proxy_gpugroup_queued_requests_total":
			ensureModelMetrics(byModel, model)["gpuGroupQueuedRequestsTotal"] += value
		case "flexinfer_proxy_endpoint_changes_total":
			ensureModelMetrics(byModel, model)["endpointChangesTotal"] += value
		case "flexinfer_proxy_endpoint_count":
			ensureModelMetrics(byModel, model)["endpointCount"] = value
		case "flexinfer_proxy_routing_decisions_total":
			ensureModelMetrics(byModel, model)["routingDecisionsTotal"] += value
		case "flexinfer_proxy_routing_target_hits_total":
			ensureModelMetrics(byModel, model)["routingTargetHitsTotal"] += value
		case "flexinfer_proxy_routing_key_cardinality":
			ensureModelMetrics(byModel, model)["routingKeyCardinality"] += value
		case "flexinfer_proxy_routing_key_cardinality_overflow_total":
			ensureModelMetrics(byModel, model)["routingKeyCardinalityOverflowTotal"] += value
		case "flexinfer_proxy_rate_limited_total":
			ensureModelMetrics(byModel, model)["rateLimitedTotal"] += value
		case "flexinfer_proxy_activation_retries_total":
			ensureModelMetrics(byModel, model)["activationRetriesTotal"] += value
		case "flexinfer_proxy_activation_failures_total":
			ensureModelMetrics(byModel, model)["activationFailuresTotal"] += value
		case "flexinfer_proxy_request_duration_seconds":
			// Some exporters may emit this as a gauge-style metric.
			legacyLatency[model] = value
		}
	}

	totals := map[string]any{
		"modelCount":                         0,
		"requestsTotal":                      0.0,
		"errorsTotal":                        0.0,
		"queueDepth":                         0.0,
		"activeConnections":                  0.0,
		"scaleUps":                           0.0,
		"queueRejectedTotal":                 0.0,
		"queuedRequestsTotal":                0.0,
		"gpuGroupSwapSignalsTotal":           0.0,
		"gpuGroupQueuedRequestsTotal":        0.0,
		"endpointChangesTotal":               0.0,
		"endpointCount":                      0.0,
		"routingDecisionsTotal":              0.0,
		"routingTargetHitsTotal":             0.0,
		"routingKeyCardinality":              0.0,
		"routingKeyCardinalityOverflowTotal": 0.0,
		"rateLimitedTotal":                   0.0,
		"activationRetriesTotal":             0.0,
		"activationFailuresTotal":            0.0,
		"errorRate":                          0.0,
		"parseErrors":                        parseErrors,
	}

	for model, bucket := range byModel {
		if model != "_total" {
			totals["modelCount"] = totals["modelCount"].(int) + 1
		}
		totals["requestsTotal"] = totals["requestsTotal"].(float64) + bucket["requestsTotal"]
		totals["queueDepth"] = totals["queueDepth"].(float64) + bucket["queueDepth"]
		totals["activeConnections"] = totals["activeConnections"].(float64) + bucket["activeConnections"]
		totals["scaleUps"] = totals["scaleUps"].(float64) + bucket["scaleUps"]
		totals["queueRejectedTotal"] = totals["queueRejectedTotal"].(float64) + bucket["queueRejectedTotal"]
		totals["queuedRequestsTotal"] = totals["queuedRequestsTotal"].(float64) + bucket["queuedRequestsTotal"]
		totals["gpuGroupSwapSignalsTotal"] = totals["gpuGroupSwapSignalsTotal"].(float64) + bucket["gpuGroupSwapSignalsTotal"]
		totals["gpuGroupQueuedRequestsTotal"] = totals["gpuGroupQueuedRequestsTotal"].(float64) + bucket["gpuGroupQueuedRequestsTotal"]
		totals["endpointChangesTotal"] = totals["endpointChangesTotal"].(float64) + bucket["endpointChangesTotal"]
		totals["endpointCount"] = totals["endpointCount"].(float64) + bucket["endpointCount"]
		totals["routingDecisionsTotal"] = totals["routingDecisionsTotal"].(float64) + bucket["routingDecisionsTotal"]
		totals["routingTargetHitsTotal"] = totals["routingTargetHitsTotal"].(float64) + bucket["routingTargetHitsTotal"]
		totals["routingKeyCardinality"] = totals["routingKeyCardinality"].(float64) + bucket["routingKeyCardinality"]
		totals["routingKeyCardinalityOverflowTotal"] = totals["routingKeyCardinalityOverflowTotal"].(float64) + bucket["routingKeyCardinalityOverflowTotal"]
		totals["rateLimitedTotal"] = totals["rateLimitedTotal"].(float64) + bucket["rateLimitedTotal"]
		totals["activationRetriesTotal"] = totals["activationRetriesTotal"].(float64) + bucket["activationRetriesTotal"]
		totals["activationFailuresTotal"] = totals["activationFailuresTotal"].(float64) + bucket["activationFailuresTotal"]
	}

	for model, statuses := range requestsByStatus {
		for status, value := range statuses {
			if strings.HasPrefix(status, "4") || strings.HasPrefix(status, "5") {
				ensureModelMetrics(byModel, model)["errorsTotal"] += value
				totals["errorsTotal"] = totals["errorsTotal"].(float64) + value
			}
		}
	}

	requestsTotal := totals["requestsTotal"].(float64)
	if requestsTotal > 0 {
		totals["errorRate"] = totals["errorsTotal"].(float64) / requestsTotal
	}

	legacyRequests["_total"] = totals["requestsTotal"].(float64)
	legacyQueueDepth["_total"] = totals["queueDepth"].(float64)
	legacyActiveConn["_total"] = totals["activeConnections"].(float64)
	legacyScaleUps["_total"] = totals["scaleUps"].(float64)

	metrics["totals"] = totals
	metrics["partial"] = parseErrors > 0
	return metrics
}

func ensureModelMetrics(byModel map[string]map[string]float64, model string) map[string]float64 {
	if _, ok := byModel[model]; !ok {
		byModel[model] = map[string]float64{
			"requestsTotal":                      0,
			"errorsTotal":                        0,
			"queueDepth":                         0,
			"activeConnections":                  0,
			"scaleUps":                           0,
			"queueRejectedTotal":                 0,
			"queuedRequestsTotal":                0,
			"gpuGroupSwapSignalsTotal":           0,
			"gpuGroupQueuedRequestsTotal":        0,
			"endpointChangesTotal":               0,
			"endpointCount":                      0,
			"routingDecisionsTotal":              0,
			"routingTargetHitsTotal":             0,
			"routingKeyCardinality":              0,
			"routingKeyCardinalityOverflowTotal": 0,
			"rateLimitedTotal":                   0,
			"activationRetriesTotal":             0,
			"activationFailuresTotal":            0,
		}
	}
	return byModel[model]
}

func parsePrometheusLine(line string) (string, map[string]string, float64, bool) {
	parts := strings.Fields(line)
	if len(parts) < 2 {
		return "", nil, 0, false
	}

	metricToken := parts[0]
	v, err := strconv.ParseFloat(parts[len(parts)-1], 64)
	if err != nil {
		return "", nil, 0, false
	}

	name := metricToken
	labels := map[string]string{}
	if open := strings.Index(metricToken, "{"); open >= 0 {
		close := strings.LastIndex(metricToken, "}")
		if close <= open {
			return "", nil, 0, false
		}
		name = metricToken[:open]
		labelPart := metricToken[open+1 : close]
		for _, pair := range strings.Split(labelPart, ",") {
			pair = strings.TrimSpace(pair)
			if pair == "" {
				continue
			}
			key, raw, ok := strings.Cut(pair, "=")
			if !ok {
				continue
			}
			labels[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(raw), `"`)
		}
	}
	return name, labels, v, true
}
