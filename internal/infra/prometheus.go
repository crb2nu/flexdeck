package infra

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

// promClient is a lightweight Prometheus HTTP client used by the infra worker.
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

// PromSample is a single instant-query result entry.
type PromSample struct {
	Metric map[string]string
	Value  float64
}

// PromRangeSample is a single range-query series entry.
type PromRangeSample struct {
	Metric map[string]string
	// Timestamps and Values are parallel slices derived from the Prometheus values array.
	Timestamps []float64
	Values     []float64
}

// QueryInstant executes a PromQL instant query and returns parsed samples.
func (c *promClient) QueryInstant(ctx context.Context, query string) ([]PromSample, error) {
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

	samples := make([]PromSample, 0, len(raw.Data.Result))
	for _, r := range raw.Data.Result {
		samples = append(samples, PromSample{
			Metric: r.Metric,
			Value:  parseRawFloat(r.Value[1]),
		})
	}
	return samples, nil
}

// QueryRange executes a PromQL range query and returns parsed series.
func (c *promClient) QueryRange(ctx context.Context, query string, start, end time.Time, step string) ([]PromRangeSample, error) {
	params := url.Values{}
	params.Set("query", query)
	params.Set("start", fmt.Sprintf("%d", start.Unix()))
	params.Set("end", fmt.Sprintf("%d", end.Unix()))
	params.Set("step", step)

	reqURL := fmt.Sprintf("%s/api/v1/query_range?%s", c.baseURL, params.Encode())
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
				Metric map[string]string    `json:"metric"`
				Values [][2]json.RawMessage `json:"values"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("prometheus range unmarshal: %w", err)
	}

	series := make([]PromRangeSample, 0, len(raw.Data.Result))
	for _, r := range raw.Data.Result {
		s := PromRangeSample{Metric: r.Metric}
		for _, v := range r.Values {
			ts := parseRawFloat(v[0])
			val := parseRawFloat(v[1])
			s.Timestamps = append(s.Timestamps, ts)
			s.Values = append(s.Values, val)
		}
		series = append(series, s)
	}
	return series, nil
}

// parseRawFloat parses a Prometheus value field which can be either a JSON number
// (for timestamps) or a quoted string (for metric values).
func parseRawFloat(raw json.RawMessage) float64 {
	// Try unquoted number first.
	var f float64
	if err := json.Unmarshal(raw, &f); err == nil {
		return f
	}
	// Try quoted string.
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return 0
	}
	f, _ = strconv.ParseFloat(s, 64)
	return f
}
