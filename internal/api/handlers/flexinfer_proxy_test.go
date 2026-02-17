package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestParsePrometheusMetricsAggregatesRequestsByStatus(t *testing.T) {
	body := []byte(`
# HELP flexinfer_proxy_requests_total Total number of requests processed by the proxy.
flexinfer_proxy_requests_total{model="model-a",status="200"} 5
flexinfer_proxy_requests_total{model="model-a",status="500"} 2
flexinfer_proxy_queue_depth{model="model-a"} 3
flexinfer_proxy_active_connections{model="model-a"} 1
flexinfer_proxy_scale_ups_total{model="model-a"} 4
flexinfer_proxy_queue_rejected_total{model="model-a"} 0.5
flexinfer_proxy_queued_requests_total{model="model-a"} 7
`)

	got := parsePrometheusMetrics(body)

	requests := got["requests"].(map[string]float64)
	if requests["model-a"] != 7 {
		t.Fatalf("expected requests[model-a]=7, got %v", requests["model-a"])
	}

	requestsByStatus := got["requestsByStatus"].(map[string]map[string]float64)
	if requestsByStatus["model-a"]["200"] != 5 || requestsByStatus["model-a"]["500"] != 2 {
		t.Fatalf("unexpected requestsByStatus for model-a: %+v", requestsByStatus["model-a"])
	}

	byModel := got["byModel"].(map[string]map[string]float64)
	if byModel["model-a"]["requestsTotal"] != 7 {
		t.Fatalf("expected byModel.requestsTotal=7, got %v", byModel["model-a"]["requestsTotal"])
	}
	if byModel["model-a"]["errorsTotal"] != 2 {
		t.Fatalf("expected byModel.errorsTotal=2, got %v", byModel["model-a"]["errorsTotal"])
	}

	totals := got["totals"].(map[string]any)
	if totals["requestsTotal"].(float64) != 7 {
		t.Fatalf("expected totals.requestsTotal=7, got %v", totals["requestsTotal"])
	}
	if totals["errorsTotal"].(float64) != 2 {
		t.Fatalf("expected totals.errorsTotal=2, got %v", totals["errorsTotal"])
	}
	if totals["modelCount"].(int) != 1 {
		t.Fatalf("expected totals.modelCount=1, got %v", totals["modelCount"])
	}
}

func TestFlexInferProxyMetricsIncludesLegacyAndNormalizedFields(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`
flexinfer_proxy_requests_total{model="model-a",status="200"} 10
flexinfer_proxy_queue_depth{model="model-a"} 2
flexinfer_proxy_active_connections{model="model-a"} 3
flexinfer_proxy_scale_ups_total{model="model-a"} 1
`))
	}))
	defer upstream.Close()

	h := &Handler{
		cfg: &config.Config{
			FlexInferProxy: config.FlexInferProxyConfig{
				URL: upstream.URL,
			},
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/flexinfer/proxy/metrics", nil)
	rec := httptest.NewRecorder()
	h.FlexInferProxyMetrics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", rec.Code, rec.Body.String())
	}

	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	legacyKeys := []string{"requests", "latency", "queue_depth", "active_conn", "scale_ups"}
	for _, key := range legacyKeys {
		if _, ok := payload[key]; !ok {
			t.Fatalf("expected legacy key %q", key)
		}
	}

	normalizedKeys := []string{"byModel", "totals", "requestsByStatus", "partial"}
	for _, key := range normalizedKeys {
		if _, ok := payload[key]; !ok {
			t.Fatalf("expected normalized key %q", key)
		}
	}
}
