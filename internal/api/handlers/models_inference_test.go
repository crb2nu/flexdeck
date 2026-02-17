package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/go-chi/chi/v5"
)

func TestModelsInferenceMetricsDefaultsToZeroWhenPrometheusReturnsEmpty(t *testing.T) {
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

	floatFields := []string{
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
	for _, key := range floatFields {
		if payload[key].(float64) != 0 {
			t.Fatalf("expected %s=0, got %v", key, payload[key])
		}
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

	data, err := h.fetchInferenceMetrics(t.Context(), "model-a")
	if err != nil {
		t.Fatalf("fetchInferenceMetrics returned error: %v", err)
	}
	payload := data.(map[string]any)

	if !payload["partial"].(bool) {
		t.Fatalf("expected partial=true when one query fails")
	}
	if payload["queueWaitP95Ms"].(float64) != 0 {
		t.Fatalf("expected queueWaitP95Ms=0 when query fails, got %v", payload["queueWaitP95Ms"])
	}

	missing := payload["missingMetrics"].([]string)
	if len(missing) == 0 {
		t.Fatalf("expected missingMetrics to include failed query keys")
	}
}
