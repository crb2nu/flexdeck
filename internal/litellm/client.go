package litellm

import (
	"context"
	"encoding/json"
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

const healthProbeTimeout = 3 * time.Second

type openAIModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

// ModelMetrics holds metrics for a single model
type ModelMetrics struct {
	Model          string    `json:"model"`
	TotalTokens    float64   `json:"total_tokens"`
	InputTokens    float64   `json:"input_tokens"`
	OutputTokens   float64   `json:"output_tokens"`
	RequestCount   float64   `json:"request_count"`
	TotalLatencyMs float64   `json:"total_latency_ms"`
	Timestamp      time.Time `json:"timestamp"`
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
	paths := []string{
		"/health",
		"/health/readiness",
		"/health/liveliness",
		"/v1/models",
	}

	var lastErr error
	for _, path := range paths {
		status, err := c.probe(ctx, path)
		if err != nil {
			lastErr = err
			continue
		}
		if status == http.StatusOK {
			return true, nil
		}
	}

	if lastErr != nil {
		return false, fmt.Errorf("health probes failed: %w", lastErr)
	}
	return false, nil
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
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	return parsePrometheusMetrics(resp.Body)
}

// ListModels returns the model IDs exposed via LiteLLM's OpenAI-compatible /v1/models endpoint.
func (c *Client) ListModels(ctx context.Context) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	c.addAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var parsed openAIModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode models: %w", err)
	}

	out := make([]string, 0, len(parsed.Data))
	for _, item := range parsed.Data {
		if item.ID != "" {
			out = append(out, item.ID)
		}
	}
	return out, nil
}

// LiteLLMModelInfo represents model info from the LiteLLM admin API.
type LiteLLMModelInfo struct {
	ModelName     string         `json:"model_name"`
	LiteLLMParams map[string]any `json:"litellm_params"`
	ModelInfo     map[string]any `json:"model_info"`
}

// ModelInfo returns model info from the LiteLLM /model/info endpoint.
func (c *Client) ModelInfo(ctx context.Context) ([]LiteLLMModelInfo, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/model/info", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	c.addAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var result struct {
		Data []LiteLLMModelInfo `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode model info: %w", err)
	}

	return result.Data, nil
}

func (c *Client) probe(ctx context.Context, path string) (int, error) {
	probeCtx, cancel := context.WithTimeout(ctx, healthProbeTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(probeCtx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return 0, fmt.Errorf("create request: %w", err)
	}
	c.addAuthHeader(req)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode, nil
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
