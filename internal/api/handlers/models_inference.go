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
			return h.fetchInferenceMetrics(ctx, name)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn("inference metrics cache error", "error", err, "model", name)
	}

	data, err := h.fetchInferenceMetrics(ctx, name)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

func (h *Handler) fetchInferenceMetrics(ctx context.Context, model string) (any, error) {
	queries := map[string]string{
		"tps":                   fmt.Sprintf(`sum(rate(flexinfer_proxy_requests_total{model="%s"}[5m]))`, model),
		"p95_latency":           fmt.Sprintf(`histogram_quantile(0.95, sum by (le) (rate(flexinfer_proxy_request_duration_seconds_bucket{model="%s"}[5m])))`, model),
		"queue_depth":           fmt.Sprintf(`sum(flexinfer_proxy_queue_depth{model="%s"})`, model),
		"active_conn":           fmt.Sprintf(`sum(flexinfer_proxy_active_connections{model="%s"})`, model),
		"error_rate":            fmt.Sprintf(`sum(rate(flexinfer_proxy_requests_total{model="%s",status=~"4..|5.."}[5m])) / clamp_min(sum(rate(flexinfer_proxy_requests_total{model="%s"}[5m])), 1e-9)`, model, model),
		"queue_wait_p95":        fmt.Sprintf(`histogram_quantile(0.95, sum by (le) (rate(flexinfer_proxy_queue_wait_duration_seconds_bucket{model="%s"}[5m])))`, model),
		"rejected_rps":          fmt.Sprintf(`sum(rate(flexinfer_proxy_queue_rejected_total{model="%s"}[5m]))`, model),
		"scale_ups_5m":          fmt.Sprintf(`sum(increase(flexinfer_proxy_scale_ups_total{model="%s"}[5m]))`, model),
		"activation_retries_5m": fmt.Sprintf(`sum(increase(flexinfer_proxy_activation_retries_total{model="%s"}[5m]))`, model),
		"cold_start_p95":        fmt.Sprintf(`histogram_quantile(0.95, sum by (le) (rate(flexinfer_proxy_cold_start_duration_seconds_bucket{model="%s"}[5m])))`, model),
		"idle_seconds":          fmt.Sprintf(`time() - flexinfer_proxy_last_active_timestamp{model="%s"}`, model),
	}

	results := make(map[string]float64)
	missing := make([]string, 0, len(queries))
	var mu sync.Mutex
	var wg sync.WaitGroup

	for key, query := range queries {
		wg.Add(1)
		go func(k, q string) {
			defer wg.Done()
			val, err := h.promInstantQuery(ctx, q)
			if err != nil {
				slog.Debug("inference metric query failed", "key", k, "error", err)
				mu.Lock()
				missing = append(missing, k)
				mu.Unlock()
				return
			}
			mu.Lock()
			results[k] = val
			mu.Unlock()
		}(key, query)
	}

	wg.Wait()
	sort.Strings(missing)

	return map[string]any{
		"model":                  model,
		"tps":                    results["tps"],
		"p95LatencyMs":           results["p95_latency"] * 1000,
		"queueDepth":             results["queue_depth"],
		"activeConnections":      results["active_conn"],
		"errorRate":              results["error_rate"],
		"queueWaitP95Ms":         results["queue_wait_p95"] * 1000,
		"rejectedRequestsPerSec": results["rejected_rps"],
		"scaleUps5m":             results["scale_ups_5m"],
		"activationRetries5m":    results["activation_retries_5m"],
		"coldStartP95Ms":         results["cold_start_p95"] * 1000,
		"idleSeconds":            results["idle_seconds"],
		"partial":                len(missing) > 0,
		"missingMetrics":         missing,
	}, nil
}

// promInstantQuery executes a Prometheus instant query and returns the first result value.
func (h *Handler) promInstantQuery(ctx context.Context, query string) (float64, error) {
	reqURL := fmt.Sprintf("%s/api/v1/query?query=%s", h.cfg.Prom.URL, url.QueryEscape(query))

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return 0, err
	}

	resp, err := apiutil.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("prometheus returned %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, err
	}

	var promResp struct {
		Data struct {
			Result []struct {
				Value [2]json.RawMessage `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}

	if err := json.Unmarshal(body, &promResp); err != nil {
		return 0, err
	}

	if len(promResp.Data.Result) == 0 {
		return 0, nil
	}

	var valStr string
	if err := json.Unmarshal(promResp.Data.Result[0].Value[1], &valStr); err != nil {
		return 0, err
	}

	v, err := strconv.ParseFloat(valStr, 64)
	if err != nil {
		return 0, fmt.Errorf("parse prometheus value %q: %w", valStr, err)
	}
	return v, nil
}
