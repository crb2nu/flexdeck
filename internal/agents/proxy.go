package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// InvokeRequest represents a request to invoke an agent
type InvokeRequest struct {
	Input    map[string]any `json:"input"`
	Config   map[string]any `json:"config,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// InvokeResponse represents a response from an agent invocation
type InvokeResponse struct {
	Output   map[string]any `json:"output"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// Proxy handles proxying requests to agents
type Proxy struct {
	registry   *Registry
	httpClient *http.Client
}

// NewProxy creates a new agent proxy
func NewProxy(registry *Registry) *Proxy {
	return &Proxy{
		registry: registry,
		httpClient: &http.Client{
			Timeout: 120 * time.Second, // Long timeout for agent invocations
		},
	}
}

// Invoke proxies a request to an agent and returns the response
func (p *Proxy) Invoke(ctx context.Context, agentID string, req *InvokeRequest) (*InvokeResponse, int64, error) {
	agent, err := p.registry.Get(agentID)
	if err != nil {
		return nil, 0, err
	}

	// Prepare the request body
	body, err := json.Marshal(req)
	if err != nil {
		return nil, 0, fmt.Errorf("marshal request: %w", err)
	}

	// Create the HTTP request
	invokeURL := agent.URL + "/invoke"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, invokeURL, bytes.NewReader(body))
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if agent.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+agent.APIKey)
	}

	// Execute the request and measure latency
	start := time.Now()
	resp, err := p.httpClient.Do(httpReq)
	latencyMs := time.Since(start).Milliseconds()

	if err != nil {
		return nil, latencyMs, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, latencyMs, fmt.Errorf("agent returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	// Parse the response
	var invokeResp InvokeResponse
	if err := json.NewDecoder(resp.Body).Decode(&invokeResp); err != nil {
		return nil, latencyMs, fmt.Errorf("decode response: %w", err)
	}

	// Record usage (estimate tokens from response size)
	tokens := int64(len(body) + estimateResponseTokens(&invokeResp))
	p.registry.RecordUsage(agentID, tokens, latencyMs)

	return &invokeResp, latencyMs, nil
}

// Stream proxies a streaming request to an agent
func (p *Proxy) Stream(ctx context.Context, agentID string, req *InvokeRequest, w http.ResponseWriter) error {
	agent, err := p.registry.Get(agentID)
	if err != nil {
		return err
	}

	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	streamURL := agent.URL + "/stream"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, streamURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	if agent.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+agent.APIKey)
	}

	start := time.Now()
	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("agent returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming not supported")
	}

	// Copy the stream to the response
	buf := make([]byte, 4096)
	var totalBytes int64
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			totalBytes += int64(n)
			_, _ = w.Write(buf[:n])
			flusher.Flush()
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read stream: %w", err)
		}
	}

	// Record usage
	latencyMs := time.Since(start).Milliseconds()
	p.registry.RecordUsage(agentID, totalBytes/4, latencyMs) // Rough token estimate

	return nil
}

// Test sends a test request to an agent
func (p *Proxy) Test(ctx context.Context, agentID string, input map[string]any) (*InvokeResponse, error) {
	req := &InvokeRequest{
		Input: input,
		Metadata: map[string]any{
			"test": true,
		},
	}

	resp, _, err := p.Invoke(ctx, agentID, req)
	return resp, err
}

func estimateResponseTokens(resp *InvokeResponse) int {
	// Rough estimate: serialize to JSON and divide by 4 (avg chars per token)
	data, _ := json.Marshal(resp)
	return len(data) / 4
}
