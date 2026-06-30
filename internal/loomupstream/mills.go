// Package loomupstream holds thin HTTP clients for the loom-core control-plane
// services that flexdeck federates directly (rather than through the HUD
// passthrough). The in-cluster HUD upstream is the mobile-hud companion, which
// does not expose /api/mills/* or /api/plans — so flexdeck talks to the mills
// operator (and Qdrant) directly. See .loom/31-iteration-plan-loom-control-plane.
package loomupstream

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// millsMaxResponseBytes caps a single mills read response defensively.
const millsMaxResponseBytes = 8 << 20 // 8MB

// MillsClient is a thin read-mostly client for the loom-mills-operator REST API
// (/api/mills/*). Read endpoints are unauthenticated; AdminToken is only needed
// for mutating endpoints (wired in a later slice).
type MillsClient struct {
	baseURL    string
	adminToken string
	http       *http.Client
}

// NewMillsClient builds a client for the given base URL. A nil http.Client falls
// back to http.DefaultClient.
func NewMillsClient(baseURL, adminToken string, hc *http.Client) *MillsClient {
	if hc == nil {
		hc = http.DefaultClient
	}
	return &MillsClient{
		baseURL:    strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		adminToken: strings.TrimSpace(adminToken),
		http:       hc,
	}
}

// Enabled reports whether a base URL is configured.
func (c *MillsClient) Enabled() bool {
	return c != nil && c.baseURL != ""
}

// Get performs a GET against a mills-operator path (e.g. "/api/mills/backlog")
// and returns the raw JSON body.
func (c *MillsClient) Get(ctx context.Context, path string) (json.RawMessage, error) {
	if !c.Enabled() {
		return nil, fmt.Errorf("mills operator not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("create mills request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("mills request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(io.LimitReader(resp.Body, millsMaxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("read mills response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("mills returned %d for %s", resp.StatusCode, path)
	}
	return json.RawMessage(body), nil
}

// Healthy returns nil when /api/mills/status responds 200 — the reachability
// signal used by the Loom health aggregator.
func (c *MillsClient) Healthy(ctx context.Context) error {
	_, err := c.Get(ctx, "/api/mills/status")
	return err
}
