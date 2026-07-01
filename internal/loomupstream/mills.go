// Package loomupstream holds thin HTTP clients for the loom-core control-plane
// services that flexdeck federates directly (rather than through the HUD
// passthrough). The in-cluster HUD upstream is the mobile-hud companion, which
// does not expose /api/mills/* or /api/plans — so flexdeck talks to the mills
// operator (and Qdrant) directly. See .loom/31-iteration-plan-loom-control-plane.
package loomupstream

import (
	"bytes"
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

// CanMutate reports whether mutating calls are possible: both a base URL and an
// admin bearer token must be configured. The operator gates every mutating
// route behind requireAdmin, so without the token a POST is always rejected.
func (c *MillsClient) CanMutate() bool {
	return c.Enabled() && c.adminToken != ""
}

// Post performs a POST against a mills-operator path with the admin bearer
// token, forwarding the optional JSON body. It returns the raw response body
// and the operator's HTTP status for any completed response so the caller can
// pass the status through; a non-nil error signals missing configuration or a
// transport failure (no HTTP response).
func (c *MillsClient) Post(ctx context.Context, path string, body []byte) (json.RawMessage, int, error) {
	if !c.CanMutate() {
		return nil, 0, fmt.Errorf("mills operator not configured for mutations")
	}
	var rdr io.Reader
	if len(body) > 0 {
		rdr = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, rdr)
	if err != nil {
		return nil, 0, fmt.Errorf("create mills request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.adminToken)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("mills request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, millsMaxResponseBytes))
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read mills response: %w", err)
	}
	return json.RawMessage(respBody), resp.StatusCode, nil
}
