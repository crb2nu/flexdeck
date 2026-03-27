package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/go-chi/chi/v5"
)

func TestModelsInferenceMetricsMarksNoSeriesAsUnobserved(t *testing.T) {
	prom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"result":[]}}`))
	}))
	defer prom.Close()

	h := &Handler{
		cfg: &config.Config{
			Prom: config.PrometheusConfig{URL: prom.URL},
		},
	}

	router := chi.NewRouter()
	router.Get("/api/models/crd/{namespace}/{name}/inference", h.ModelsInferenceMetrics)

	req := httptest.NewRequest(http.MethodGet, "/api/models/crd/flexinfer-system/model-a/inference", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	nullFields := []string{
		"tps",
		"p95LatencyMs",
		"queueDepth",
		"activeConnections",
		"errorRate",
		"queueWaitP95Ms",
		"rejectedRequestsPerSec",
		"scaleUps5m",
		"activationRetries5m",
	}
	for _, key := range nullFields {
		if payload[key] != nil {
			t.Fatalf("expected %s=nil when no series exist, got %v", key, payload[key])
		}
	}
	if payload["observed"].(bool) {
		t.Fatalf("expected observed=false for empty Prometheus result")
	}
	if payload["partial"].(bool) {
		t.Fatalf("expected partial=false for empty Prometheus result")
	}
}

func TestFetchInferenceMetricsMarksPartialWhenAnyQueryFails(t *testing.T) {
	prom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("query")
		if strings.Contains(q, "queue_wait_duration_seconds_bucket") {
			http.Error(w, "boom", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"result":[{"value":[0,"1"]}]}}`))
	}))
	defer prom.Close()

	h := &Handler{
		cfg: &config.Config{
			Prom: config.PrometheusConfig{URL: prom.URL},
		},
	}

	data, err := h.fetchInferenceMetrics(context.Background(), "flexinfer-system", "model-a")
	if err != nil {
		t.Fatalf("fetchInferenceMetrics returned error: %v", err)
	}
	payload := data.(map[string]any)

	if !payload["partial"].(bool) {
		t.Fatalf("expected partial=true when one query fails")
	}
	if payload["queueWaitP95Ms"] != nil {
		t.Fatalf("expected queueWaitP95Ms=nil when query fails, got %v", payload["queueWaitP95Ms"])
	}
	if !payload["observed"].(bool) {
		t.Fatalf("expected observed=true when at least one metric query succeeds")
	}

	missing := payload["missingMetrics"].([]string)
	if len(missing) == 0 {
		t.Fatalf("expected missingMetrics to include failed query keys")
	}
	if missing[0] != "queueWaitP95Ms" {
		t.Fatalf("expected queueWaitP95Ms to be marked missing, got %v", missing)
	}
}

func TestModelsInferenceMetricsContractIncludesAdditiveReliabilityFields(t *testing.T) {
	prom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q, _ := url.QueryUnescape(r.URL.Query().Get("query"))
		value := "0"
		switch {
		case strings.Contains(q, "flexinfer_proxy_requests_total") && strings.Contains(q, "status=~"):
			value = "0.02"
		case strings.Contains(q, "flexinfer_proxy_requests_total"):
			value = "12.5"
		case strings.Contains(q, "request_duration_seconds_bucket"):
			value = "0.15"
		case strings.Contains(q, "queue_depth"):
			value = "3"
		case strings.Contains(q, "active_connections"):
			value = "2"
		case strings.Contains(q, "queue_wait_duration_seconds_bucket"):
			value = "0.5"
		case strings.Contains(q, "queue_rejected_total"):
			value = "0.2"
		case strings.Contains(q, "scale_ups_total"):
			value = "4"
		case strings.Contains(q, "activation_retries_total"):
			value = "1.5"
		case strings.Contains(q, "flexinfer_model_cold_start_duration_seconds_bucket"):
			value = "2.5"
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"result":[{"value":[0,"` + value + `"]}]}}`))
	}))
	defer prom.Close()

	h := &Handler{
		cfg: &config.Config{
			Prom: config.PrometheusConfig{URL: prom.URL},
		},
	}

	router := chi.NewRouter()
	router.Get("/api/models/crd/{namespace}/{name}/inference", h.ModelsInferenceMetrics)

	req := httptest.NewRequest(http.MethodGet, "/api/models/crd/flexinfer-system/model-a/inference", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	compatKeys := []string{
		"model",
		"tps",
		"p95LatencyMs",
		"queueDepth",
		"activeConnections",
	}
	for _, key := range compatKeys {
		if _, ok := payload[key]; !ok {
			t.Fatalf("expected compatibility key %q", key)
		}
	}

	additiveKeys := []string{
		"errorRate",
		"queueWaitP95Ms",
		"rejectedRequestsPerSec",
		"scaleUps5m",
		"activationRetries5m",
		"partial",
		"missingMetrics",
	}
	for _, key := range additiveKeys {
		if _, ok := payload[key]; !ok {
			t.Fatalf("expected additive key %q", key)
		}
	}

	if payload["model"] != "model-a" {
		t.Fatalf("expected model=model-a, got %v", payload["model"])
	}
	if !payload["observed"].(bool) {
		t.Fatalf("expected observed=true when Prometheus returns series")
	}
	if payload["partial"].(bool) {
		t.Fatalf("expected partial=false when all reliability queries succeed")
	}
	if len(payload["missingMetrics"].([]any)) != 0 {
		t.Fatalf("expected empty missingMetrics when all queries succeed")
	}
	if payload["tps"].(float64) != 12.5 {
		t.Fatalf("expected tps=12.5, got %v", payload["tps"])
	}
	if payload["p95LatencyMs"].(float64) != 150 {
		t.Fatalf("expected p95LatencyMs=150, got %v", payload["p95LatencyMs"])
	}
	if payload["queueWaitP95Ms"].(float64) != 500 {
		t.Fatalf("expected queueWaitP95Ms=500, got %v", payload["queueWaitP95Ms"])
	}
	if payload["rejectedRequestsPerSec"].(float64) != 0.2 {
		t.Fatalf("expected rejectedRequestsPerSec=0.2, got %v", payload["rejectedRequestsPerSec"])
	}
	if payload["activationRetries5m"].(float64) != 1.5 {
		t.Fatalf("expected activationRetries5m=1.5, got %v", payload["activationRetries5m"])
	}
	if payload["coldStartP95Ms"].(float64) != 2500 {
		t.Fatalf("expected coldStartP95Ms=2500, got %v", payload["coldStartP95Ms"])
	}
	if payload["idleSeconds"] != nil {
		t.Fatalf("expected idleSeconds=nil when no supported idle metric exists, got %v", payload["idleSeconds"])
	}
}

func TestFetchInferenceMetricsDoesNotMarkOptionalContractGapsAsPartial(t *testing.T) {
	prom := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"result":[]}}`))
	}))
	defer prom.Close()

	h := &Handler{
		cfg: &config.Config{
			Prom: config.PrometheusConfig{URL: prom.URL},
		},
	}

	data, err := h.fetchInferenceMetrics(context.Background(), "flexinfer-system", "model-a")
	if err != nil {
		t.Fatalf("fetchInferenceMetrics returned error: %v", err)
	}

	payload := data.(map[string]any)
	if payload["observed"].(bool) {
		t.Fatalf("expected observed=false when Prometheus returns no series")
	}
	if payload["partial"].(bool) {
		t.Fatalf("expected partial=false when only optional metrics are unavailable")
	}
	if payload["coldStartP95Ms"] != nil {
		t.Fatalf("expected coldStartP95Ms=nil when the metric is absent, got %v", payload["coldStartP95Ms"])
	}
	if payload["idleSeconds"] != nil {
		t.Fatalf("expected idleSeconds=nil when no idle metric is supported, got %v", payload["idleSeconds"])
	}
}
