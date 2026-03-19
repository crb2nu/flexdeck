package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// promClient is a lightweight Prometheus HTTP client for the metrics package.
// Duplicated from internal/infra to avoid cross-package coupling.
type promClient struct {
	baseURL string
	client  *http.Client
}

func newPromClient(baseURL string) *promClient {
	return &promClient{
		baseURL: baseURL,
		client:  &http.Client{Timeout: 15 * time.Second},
	}
}

// promSample is a single instant-query result entry.
type promSample struct {
	Metric map[string]string
	Value  float64
}

// queryInstant executes a PromQL instant query and returns parsed samples.
func (c *promClient) queryInstant(ctx context.Context, query string) ([]promSample, error) {
	reqURL := fmt.Sprintf("%s/api/v1/query?query=%s", c.baseURL, url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var raw struct {
		Status string `json:"status"`
		Data   struct {
			ResultType string `json:"resultType"`
			Result     []struct {
				Metric map[string]string  `json:"metric"`
				Value  [2]json.RawMessage `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("prometheus unmarshal: %w", err)
	}

	samples := make([]promSample, 0, len(raw.Data.Result))
	for _, r := range raw.Data.Result {
		samples = append(samples, promSample{
			Metric: r.Metric,
			Value:  parsePromFloat(r.Value[1]),
		})
	}
	return samples, nil
}

// parsePromFloat parses a Prometheus value field (JSON number or quoted string).
func parsePromFloat(raw json.RawMessage) float64 {
	var f float64
	if err := json.Unmarshal(raw, &f); err == nil {
		return f
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return 0
	}
	f, _ = strconv.ParseFloat(s, 64)
	return f
}
