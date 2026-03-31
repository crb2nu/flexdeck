package handlers

import (
	"encoding/json"
	"math"
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

func TestParsePrometheusMetricsCapturesCurrentProxyMetricFamilies(t *testing.T) {
	body := []byte(`
flexinfer_proxy_gpugroup_swap_signals_total{model="model-a",gpugroup="shared-a"} 3
flexinfer_proxy_gpugroup_queued_requests_total{model="model-a",gpugroup="shared-a"} 4
flexinfer_proxy_endpoint_changes_total{model="model-a",change_type="add"} 2
flexinfer_proxy_endpoint_count{model="model-a"} 1
flexinfer_proxy_routing_decisions_total{model="model-a",strategy="labels",key_source="service_labels",outcome="hit"} 9
flexinfer_proxy_routing_target_hits_total{model="model-a",strategy="labels",target="backend-a"} 8
flexinfer_proxy_routing_key_cardinality{model="model-a",strategy="labels",key_source="service_labels"} 5
flexinfer_proxy_routing_key_cardinality_overflow_total{model="model-a",strategy="labels",key_source="service_labels"} 1
flexinfer_proxy_rate_limited_total{model="model-a",scope="global"} 6
flexinfer_proxy_activation_retries_total{model="model-a"} 7
flexinfer_proxy_activation_failures_total{model="model-a",reason="ready_timeout"} 2
`)

	got := parsePrometheusMetrics(body)
	byModel := got["byModel"].(map[string]map[string]float64)
	modelA := byModel["model-a"]

	expected := map[string]float64{
		"gpuGroupSwapSignalsTotal":           3,
		"gpuGroupQueuedRequestsTotal":        4,
		"endpointChangesTotal":               2,
		"endpointCount":                      1,
		"routingDecisionsTotal":              9,
		"routingTargetHitsTotal":             8,
		"routingKeyCardinality":              5,
		"routingKeyCardinalityOverflowTotal": 1,
		"rateLimitedTotal":                   6,
		"activationRetriesTotal":             7,
		"activationFailuresTotal":            2,
	}
	for key, want := range expected {
		if modelA[key] != want {
			t.Fatalf("expected byModel[%q]=%v, got %v", key, want, modelA[key])
		}
	}

	totals := got["totals"].(map[string]any)
	for key, want := range expected {
		if totals[key].(float64) != want {
			t.Fatalf("expected totals[%q]=%v, got %v", key, want, totals[key])
		}
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

func TestFlexInferProxyMetricsContractSemantics(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`
flexinfer_proxy_requests_total{model="model-a",status="200"} 10
flexinfer_proxy_requests_total{model="model-a",status="503"} 5
flexinfer_proxy_queue_depth{model="model-a"} 2
flexinfer_proxy_active_connections{model="model-a"} 3
flexinfer_proxy_scale_ups_total{model="model-a"} 1
flexinfer_proxy_queue_rejected_total{model="model-a"} 0.5
flexinfer_proxy_queued_requests_total{model="model-a"} 7
flexinfer_proxy_gpugroup_swap_signals_total{model="model-a",gpugroup="shared-a"} 3
flexinfer_proxy_gpugroup_queued_requests_total{model="model-a",gpugroup="shared-a"} 4
flexinfer_proxy_endpoint_changes_total{model="model-a",change_type="add"} 2
flexinfer_proxy_endpoint_count{model="model-a"} 1
flexinfer_proxy_routing_decisions_total{model="model-a",strategy="labels",key_source="service_labels",outcome="hit"} 9
flexinfer_proxy_routing_target_hits_total{model="model-a",strategy="labels",target="backend-a"} 8
flexinfer_proxy_routing_key_cardinality{model="model-a",strategy="labels",key_source="service_labels"} 5
flexinfer_proxy_routing_key_cardinality_overflow_total{model="model-a",strategy="labels",key_source="service_labels"} 1
flexinfer_proxy_rate_limited_total{model="model-a",scope="global"} 6
flexinfer_proxy_activation_retries_total{model="model-a"} 7
flexinfer_proxy_activation_failures_total{model="model-a",reason="ready_timeout"} 2
not_prometheus_line
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

	requests := payload["requests"].(map[string]any)
	if requests["model-a"].(float64) != 15 || requests["_total"].(float64) != 15 {
		t.Fatalf("unexpected legacy requests payload: %+v", requests)
	}

	queueDepth := payload["queue_depth"].(map[string]any)
	if queueDepth["model-a"].(float64) != 2 || queueDepth["_total"].(float64) != 2 {
		t.Fatalf("unexpected legacy queue_depth payload: %+v", queueDepth)
	}

	activeConn := payload["active_conn"].(map[string]any)
	if activeConn["model-a"].(float64) != 3 || activeConn["_total"].(float64) != 3 {
		t.Fatalf("unexpected legacy active_conn payload: %+v", activeConn)
	}

	scaleUps := payload["scale_ups"].(map[string]any)
	if scaleUps["model-a"].(float64) != 1 || scaleUps["_total"].(float64) != 1 {
		t.Fatalf("unexpected legacy scale_ups payload: %+v", scaleUps)
	}

	byModel := payload["byModel"].(map[string]any)
	modelA := byModel["model-a"].(map[string]any)
	if modelA["requestsTotal"].(float64) != 15 {
		t.Fatalf("expected byModel.requestsTotal=15, got %v", modelA["requestsTotal"])
	}
	if modelA["errorsTotal"].(float64) != 5 {
		t.Fatalf("expected byModel.errorsTotal=5, got %v", modelA["errorsTotal"])
	}
	if modelA["queueRejectedTotal"].(float64) != 0.5 {
		t.Fatalf("expected byModel.queueRejectedTotal=0.5, got %v", modelA["queueRejectedTotal"])
	}
	if modelA["queuedRequestsTotal"].(float64) != 7 {
		t.Fatalf("expected byModel.queuedRequestsTotal=7, got %v", modelA["queuedRequestsTotal"])
	}
	if modelA["gpuGroupSwapSignalsTotal"].(float64) != 3 {
		t.Fatalf("expected byModel.gpuGroupSwapSignalsTotal=3, got %v", modelA["gpuGroupSwapSignalsTotal"])
	}
	if modelA["gpuGroupQueuedRequestsTotal"].(float64) != 4 {
		t.Fatalf("expected byModel.gpuGroupQueuedRequestsTotal=4, got %v", modelA["gpuGroupQueuedRequestsTotal"])
	}
	if modelA["endpointChangesTotal"].(float64) != 2 || modelA["endpointCount"].(float64) != 1 {
		t.Fatalf("expected endpoint metrics to round-trip, got %+v", modelA)
	}
	if modelA["routingDecisionsTotal"].(float64) != 9 || modelA["routingTargetHitsTotal"].(float64) != 8 {
		t.Fatalf("expected routing decision metrics to round-trip, got %+v", modelA)
	}
	if modelA["routingKeyCardinality"].(float64) != 5 || modelA["routingKeyCardinalityOverflowTotal"].(float64) != 1 {
		t.Fatalf("expected routing cardinality metrics to round-trip, got %+v", modelA)
	}
	if modelA["rateLimitedTotal"].(float64) != 6 {
		t.Fatalf("expected byModel.rateLimitedTotal=6, got %v", modelA["rateLimitedTotal"])
	}
	if modelA["activationRetriesTotal"].(float64) != 7 || modelA["activationFailuresTotal"].(float64) != 2 {
		t.Fatalf("expected activation metrics to round-trip, got %+v", modelA)
	}

	requestsByStatus := payload["requestsByStatus"].(map[string]any)
	modelStatus := requestsByStatus["model-a"].(map[string]any)
	if modelStatus["200"].(float64) != 10 || modelStatus["503"].(float64) != 5 {
		t.Fatalf("unexpected requestsByStatus payload: %+v", modelStatus)
	}

	totals := payload["totals"].(map[string]any)
	if totals["modelCount"].(float64) != 1 {
		t.Fatalf("expected totals.modelCount=1, got %v", totals["modelCount"])
	}
	if totals["requestsTotal"].(float64) != 15 {
		t.Fatalf("expected totals.requestsTotal=15, got %v", totals["requestsTotal"])
	}
	if totals["errorsTotal"].(float64) != 5 {
		t.Fatalf("expected totals.errorsTotal=5, got %v", totals["errorsTotal"])
	}
	if totals["queueDepth"].(float64) != 2 {
		t.Fatalf("expected totals.queueDepth=2, got %v", totals["queueDepth"])
	}
	if totals["activeConnections"].(float64) != 3 {
		t.Fatalf("expected totals.activeConnections=3, got %v", totals["activeConnections"])
	}
	if totals["scaleUps"].(float64) != 1 {
		t.Fatalf("expected totals.scaleUps=1, got %v", totals["scaleUps"])
	}
	if totals["queueRejectedTotal"].(float64) != 0.5 {
		t.Fatalf("expected totals.queueRejectedTotal=0.5, got %v", totals["queueRejectedTotal"])
	}
	if totals["queuedRequestsTotal"].(float64) != 7 {
		t.Fatalf("expected totals.queuedRequestsTotal=7, got %v", totals["queuedRequestsTotal"])
	}
	if totals["gpuGroupSwapSignalsTotal"].(float64) != 3 || totals["gpuGroupQueuedRequestsTotal"].(float64) != 4 {
		t.Fatalf("expected totals GPU group metrics to round-trip, got %+v", totals)
	}
	if totals["endpointChangesTotal"].(float64) != 2 || totals["endpointCount"].(float64) != 1 {
		t.Fatalf("expected totals endpoint metrics to round-trip, got %+v", totals)
	}
	if totals["routingDecisionsTotal"].(float64) != 9 || totals["routingTargetHitsTotal"].(float64) != 8 {
		t.Fatalf("expected totals routing metrics to round-trip, got %+v", totals)
	}
	if totals["routingKeyCardinality"].(float64) != 5 || totals["routingKeyCardinalityOverflowTotal"].(float64) != 1 {
		t.Fatalf("expected totals routing cardinality metrics to round-trip, got %+v", totals)
	}
	if totals["rateLimitedTotal"].(float64) != 6 {
		t.Fatalf("expected totals.rateLimitedTotal=6, got %v", totals["rateLimitedTotal"])
	}
	if totals["activationRetriesTotal"].(float64) != 7 || totals["activationFailuresTotal"].(float64) != 2 {
		t.Fatalf("expected totals activation metrics to round-trip, got %+v", totals)
	}
	if totals["parseErrors"].(float64) != 1 {
		t.Fatalf("expected totals.parseErrors=1, got %v", totals["parseErrors"])
	}

	const expectedErrorRate = 5.0 / 15.0
	if math.Abs(totals["errorRate"].(float64)-expectedErrorRate) > 1e-9 {
		t.Fatalf("expected totals.errorRate=%v, got %v", expectedErrorRate, totals["errorRate"])
	}

	if partial := payload["partial"].(bool); !partial {
		t.Fatalf("expected partial=true when parse errors are present")
	}
}
