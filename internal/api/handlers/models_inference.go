package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
)

// ModelsInferenceMetrics returns per-model inference metrics from Prometheus.
func (h *Handler) ModelsInferenceMetrics(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "prometheus disabled"})
		return
	}

	ctx := r.Context()
	cacheKey := fmt.Sprintf("models:inference:%s:%s", ns, name)

	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, cacheKey, 15*time.Second, func() (any, error) {
			return h.fetchInferenceMetrics(name)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
		slog.Warn("inference metrics cache error", "error", err, "model", name)
	}

	data, err := h.fetchInferenceMetrics(name)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

func (h *Handler) fetchInferenceMetrics(model string) (any, error) {
	type queryResult struct {
		key   string
		value float64
	}

	queries := map[string]string{
		"tps":         fmt.Sprintf(`rate(flexinfer_proxy_requests_total{model="%s"}[5m])`, model),
		"p95_latency": fmt.Sprintf(`histogram_quantile(0.95, rate(flexinfer_proxy_request_duration_seconds_bucket{model="%s"}[5m]))`, model),
		"queue_depth": fmt.Sprintf(`flexinfer_proxy_queue_depth{model="%s"}`, model),
		"active_conn": fmt.Sprintf(`flexinfer_proxy_active_connections{model="%s"}`, model),
	}

	results := make(map[string]float64)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for key, query := range queries {
		wg.Add(1)
		go func(k, q string) {
			defer wg.Done()
			val, err := h.promInstantQuery(q)
			if err != nil {
				slog.Debug("inference metric query failed", "key", k, "error", err)
				return
			}
			mu.Lock()
			results[k] = val
			mu.Unlock()
		}(key, query)
	}

	wg.Wait()

	return map[string]any{
		"model":              model,
		"tps":                results["tps"],
		"p95LatencyMs":       results["p95_latency"] * 1000,
		"queueDepth":         results["queue_depth"],
		"activeConnections":  results["active_conn"],
	}, nil
}

// promInstantQuery executes a Prometheus instant query and returns the first result value.
func (h *Handler) promInstantQuery(query string) (float64, error) {
	url := fmt.Sprintf("%s/api/v1/query?query=%s", h.cfg.Prom.URL, query)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

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

	var v float64
	fmt.Sscanf(valStr, "%f", &v)
	return v, nil
}
