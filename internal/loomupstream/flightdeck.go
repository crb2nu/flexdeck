package loomupstream

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// flightdeckMaxResponseBytes caps a single flightdeck read response defensively.
const flightdeckMaxResponseBytes = 8 << 20 // 8MB

// FlightdeckClient is a thin read-only client for the loom-flightdeck board JSON
// API (/api/v2/board/* and /api/v2/context/*). The API is behind the same Bearer
// (IngestAuth) token as flightdeck ingest, so Token must match the flightdeck
// ingest token.
type FlightdeckClient struct {
	baseURL string
	token   string
	http    *http.Client
}

// NewFlightdeckClient builds a client for the given base URL. A nil http.Client
// falls back to http.DefaultClient.
func NewFlightdeckClient(baseURL, token string, hc *http.Client) *FlightdeckClient {
	if hc == nil {
		hc = http.DefaultClient
	}
	return &FlightdeckClient{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		token:   strings.TrimSpace(token),
		http:    hc,
	}
}

// Enabled reports whether a base URL is configured.
func (c *FlightdeckClient) Enabled() bool {
	return c != nil && c.baseURL != ""
}

// Get performs a GET against a flightdeck path (e.g. "/api/v2/board/stalls") and
// returns the raw JSON body. The bearer token is attached when configured.
func (c *FlightdeckClient) Get(ctx context.Context, path string) (json.RawMessage, error) {
	if !c.Enabled() {
		return nil, fmt.Errorf("flightdeck not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("create flightdeck request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("flightdeck request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, flightdeckMaxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("read flightdeck response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("flightdeck returned %d for %s", resp.StatusCode, path)
	}
	return json.RawMessage(body), nil
}

// Healthy returns nil when /api/v2/board/summary responds 200 — the end-to-end
// reachability + auth signal for the Loom health aggregator.
func (c *FlightdeckClient) Healthy(ctx context.Context) error {
	_, err := c.Get(ctx, "/api/v2/board/summary")
	return err
}
