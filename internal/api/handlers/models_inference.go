package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/flexinfer/flexdeck/internal/api/handlers/apiutil"
	"github.com/go-chi/chi/v5"
)

// safeModelName validates that a model name contains only safe characters.
var safeModelName = regexp.MustCompile(`^[a-zA-Z0-9._\-/]+$`)

// ModelsInferenceMetrics returns per-model inference metrics from Prometheus.
func (h *Handler) ModelsInferenceMetrics(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "prometheus disabled"})
		return
	}

	if !safeModelName.MatchString(name) {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid model name"})
		return
	}

	ctx := r.Context()
	cacheKey := fmt.Sprintf("models:inference:%s:%s", ns, name)

	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, cacheKey, 15*time.Second, func() (any, error) {
			return h.fetchInferenceMetrics(ctx, ns, name)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn("inference metrics cache error", "error", err, "model", name)
	}

	data, err := h.fetchInferenceMetrics(ctx, ns, name)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

type promMetricQuery struct {
	field    string
	query    string
	optional bool
	scale    float64
}

func (h *Handler) fetchInferenceMetrics(ctx context.Context, namespace, model string) (any, error) {
	queries := []promMetricQuery{
		{field: "tps", query: fmt.Sprintf(`sum(rate(flexinfer_proxy_requests_total{model="%s"}[5m]))`, model), scale: 1},
		{field: "p95LatencyMs", query: fmt.Sprintf(`histogram_quantile(0.95, sum by (le) (rate(flexinfer_proxy_request_duration_seconds_bucket{model="%s"}[5m])))`, model), scale: 1000},
		{field: "queueDepth", query: fmt.Sprintf(`sum(flexinfer_proxy_queue_depth{model="%s"})`, model), scale: 1},
		{field: "activeConnections", query: fmt.Sprintf(`sum(flexinfer_proxy_active_connections{model="%s"})`, model), scale: 1},
		{field: "errorRate", query: fmt.Sprintf(`sum(rate(flexinfer_proxy_requests_total{model="%s",status=~"4..|5.."}[5m])) / clamp_min(sum(rate(flexinfer_proxy_requests_total{model="%s"}[5m])), 1e-9)`, model, model), scale: 1},
		{field: "queueWaitP95Ms", query: fmt.Sprintf(`histogram_quantile(0.95, sum by (le) (rate(flexinfer_proxy_queue_wait_duration_seconds_bucket{model="%s"}[5m])))`, model), scale: 1000},
		{field: "rejectedRequestsPerSec", query: fmt.Sprintf(`sum(rate(flexinfer_proxy_queue_rejected_total{model="%s"}[5m]))`, model), scale: 1},
		{field: "scaleUps5m", query: fmt.Sprintf(`sum(increase(flexinfer_proxy_scale_ups_total{model="%s"}[5m]))`, model), scale: 1},
		{field: "activationRetries5m", query: fmt.Sprintf(`sum(increase(flexinfer_proxy_activation_retries_total{model="%s"}[5m]))`, model), scale: 1},
		{field: "coldStartP95Ms", query: fmt.Sprintf(`histogram_quantile(0.95, sum by (le) (rate(flexinfer_model_cold_start_duration_seconds_bucket{model="%s",namespace="%s"}[5m])))`, model, namespace), optional: true, scale: 1000},
	}

	results := make(map[string]float64)
	present := make(map[string]bool)
	missing := make([]string, 0, len(queries))
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, spec := range queries {
		wg.Add(1)
		go func(spec promMetricQuery) {
			defer wg.Done()
			val, found, err := h.promInstantQuery(ctx, spec.query)
			if err != nil {
				slog.Debug("inference metric query failed", "field", spec.field, "error", err)
				mu.Lock()
				if !spec.optional {
					missing = append(missing, spec.field)
				}
				mu.Unlock()
				return
			}
			mu.Lock()
			if found {
				results[spec.field] = val * spec.scale
				present[spec.field] = true
			}
			mu.Unlock()
		}(spec)
	}

	wg.Wait()
	sort.Strings(missing)

	return map[string]any{
		"model":                  model,
		"observed":               len(present) > 0,
		"tps":                    promFieldValue(results, present, "tps"),
		"p95LatencyMs":           promFieldValue(results, present, "p95LatencyMs"),
		"queueDepth":             promFieldValue(results, present, "queueDepth"),
		"activeConnections":      promFieldValue(results, present, "activeConnections"),
		"errorRate":              promFieldValue(results, present, "errorRate"),
		"queueWaitP95Ms":         promFieldValue(results, present, "queueWaitP95Ms"),
		"rejectedRequestsPerSec": promFieldValue(results, present, "rejectedRequestsPerSec"),
		"scaleUps5m":             promFieldValue(results, present, "scaleUps5m"),
		"activationRetries5m":    promFieldValue(results, present, "activationRetries5m"),
		"coldStartP95Ms":         promFieldValue(results, present, "coldStartP95Ms"),
		"idleSeconds":            nil,
		"partial":                len(missing) > 0,
		"missingMetrics":         missing,
	}, nil
}

func promFieldValue(results map[string]float64, present map[string]bool, key string) any {
	if !present[key] {
		return nil
	}
	return results[key]
}

// promInstantQuery executes a Prometheus instant query and returns the first result value.
func (h *Handler) promInstantQuery(ctx context.Context, query string) (float64, bool, error) {
	reqURL := fmt.Sprintf("%s/api/v1/query?query=%s", h.cfg.Prom.URL, url.QueryEscape(query))

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return 0, false, err
	}

	resp, err := apiutil.DefaultClient.Do(req)
	if err != nil {
		return 0, false, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return 0, false, fmt.Errorf("prometheus returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, false, err
	}

	var promResp struct {
		Data struct {
			Result []struct {
				Value [2]json.RawMessage `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &promResp); err != nil {
		return 0, false, err
	}

	if len(promResp.Data.Result) == 0 {
		return 0, false, nil
	}

	var valStr string
	if err := json.Unmarshal(promResp.Data.Result[0].Value[1], &valStr); err != nil {
		return 0, false, err
	}

	v, err := strconv.ParseFloat(valStr, 64)
	if err != nil {
		return 0, false, fmt.Errorf("parse prometheus value %q: %w", valStr, err)
	}
	return v, true, nil
}
