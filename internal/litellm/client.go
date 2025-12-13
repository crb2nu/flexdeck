package litellm

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	dto "github.com/prometheus/client_model/go"
	"github.com/prometheus/common/expfmt"
)

// Client interacts with LiteLLM's metrics and health endpoints
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// ModelMetrics holds metrics for a single model
type ModelMetrics struct {
	Model           string    `json:"model"`
	TotalTokens     float64   `json:"total_tokens"`
	InputTokens     float64   `json:"input_tokens"`
	OutputTokens    float64   `json:"output_tokens"`
	RequestCount    float64   `json:"request_count"`
	TotalLatencyMs  float64   `json:"total_latency_ms"`
	Timestamp       time.Time `json:"timestamp"`
}

// NewClient creates a new LiteLLM client
func NewClient(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// addAuthHeader adds the API key to the request if configured
func (c *Client) addAuthHeader(req *http.Request) {
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
}

// Health checks if LiteLLM is healthy
func (c *Client) Health(ctx context.Context) (bool, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return false, fmt.Errorf("create request: %w", err)
	}
	c.addAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK, nil
}

// ScrapeMetrics fetches and parses Prometheus metrics from LiteLLM
func (c *Client) ScrapeMetrics(ctx context.Context) ([]ModelMetrics, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/metrics", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	c.addAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	return parsePrometheusMetrics(resp.Body)
}

// parsePrometheusMetrics parses Prometheus text format into ModelMetrics
func parsePrometheusMetrics(body io.Reader) ([]ModelMetrics, error) {
	var parser expfmt.TextParser
	metricFamilies, err := parser.TextToMetricFamilies(body)
	if err != nil {
		return nil, fmt.Errorf("parse metrics: %w", err)
	}

	modelData := make(map[string]*ModelMetrics)
	now := time.Now()

	for name, mf := range metricFamilies {
		for _, m := range mf.GetMetric() {
			model := getLabelValue(m.GetLabel(), "requested_model")
			if model == "" {
				model = getLabelValue(m.GetLabel(), "model")
			}
			if model == "" {
				continue
			}

			if _, ok := modelData[model]; !ok {
				modelData[model] = &ModelMetrics{Model: model, Timestamp: now}
			}

			value := getValue(m)

			switch name {
			case "litellm_total_tokens_metric":
				modelData[model].TotalTokens = value
			case "litellm_input_tokens_metric":
				modelData[model].InputTokens = value
			case "litellm_output_tokens_metric":
				modelData[model].OutputTokens = value
			case "litellm_requests_metric":
				modelData[model].RequestCount = value
			case "litellm_request_total_latency_metric":
				modelData[model].TotalLatencyMs = value * 1000 // Convert to ms if in seconds
			}
		}
	}

	result := make([]ModelMetrics, 0, len(modelData))
	for _, m := range modelData {
		result = append(result, *m)
	}
	return result, nil
}

// getLabelValue extracts a label value from Prometheus labels
func getLabelValue(labels []*dto.LabelPair, name string) string {
	for _, label := range labels {
		if label.GetName() == name {
			return label.GetValue()
		}
	}
	return ""
}

// getValue extracts the numeric value from a Prometheus metric
func getValue(m *dto.Metric) float64 {
	if m.GetCounter() != nil {
		return m.GetCounter().GetValue()
	}
	if m.GetGauge() != nil {
		return m.GetGauge().GetValue()
	}
	if m.GetUntyped() != nil {
		return m.GetUntyped().GetValue()
	}
	if m.GetSummary() != nil {
		return m.GetSummary().GetSampleSum()
	}
	if m.GetHistogram() != nil {
		return m.GetHistogram().GetSampleSum()
	}
	return 0
}
