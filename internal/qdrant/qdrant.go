// Package qdrant provides a thin read-only client for Qdrant's REST API,
// scoped to the scroll-by-filter access pattern flexdeck needs for federating
// project-tracking data (tasks, risks) out of agent-context collections.
//
// It is intentionally tiny: no vector search, no upserts, no collection
// management. Callers fetch points by payload filter and read the payloads.
// Every failure path is non-fatal at the call site — an unreachable Qdrant
// must degrade to "no results", never an error that blanks a federated view.
package qdrant

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Client is a minimal Qdrant REST client.
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// Option configures a Client.
type Option func(*Client)

// WithHTTPClient overrides the default HTTP client (used in tests).
func WithHTTPClient(c *http.Client) Option {
	return func(q *Client) {
		if c != nil {
			q.httpClient = c
		}
	}
}

// WithAPIKey sets the api-key header sent with every request. Empty disables it.
func WithAPIKey(key string) Option {
	return func(q *Client) {
		q.apiKey = strings.TrimSpace(key)
	}
}

// New constructs a Client targeting baseURL (e.g. http://localhost:6333).
func New(baseURL string, opts ...Option) *Client {
	c := &Client{
		baseURL: strings.TrimSuffix(strings.TrimSpace(baseURL), "/"),
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Point is a single Qdrant point with its payload. The vector is never fetched.
type Point struct {
	ID      any            `json:"id"`
	Payload map[string]any `json:"payload"`
}

// scrollResponse mirrors the subset of POST /collections/{c}/points/scroll
// we care about.
type scrollResponse struct {
	Result struct {
		Points         []Point `json:"points"`
		NextPageOffset any     `json:"next_page_offset"`
	} `json:"result"`
	Status any `json:"status"`
}

// MatchProject builds a Qdrant filter that matches points whose payload
// `project` field equals the given canonical project id (path_with_namespace).
func MatchProject(project string) map[string]any {
	return map[string]any{
		"must": []any{
			map[string]any{
				"key":   "project",
				"match": map[string]any{"value": project},
			},
		},
	}
}

// MatchProjectAndEntryType builds a Qdrant filter matching points whose payload
// `project` equals the given canonical project id AND whose `entry_type` equals
// the given type (e.g. "decision"). Used to federate the agent-context journal.
func MatchProjectAndEntryType(project, entryType string) map[string]any {
	return map[string]any{
		"must": []any{
			map[string]any{
				"key":   "project",
				"match": map[string]any{"value": project},
			},
			map[string]any{
				"key":   "entry_type",
				"match": map[string]any{"value": entryType},
			},
		},
	}
}

// Scroll fetches up to limit points from collection matching filter. A nil
// filter scrolls unfiltered. Errors (including a missing collection or an
// unreachable server) are returned so the caller can decide how to degrade;
// callers in flexdeck treat any error as "empty + partial".
func (c *Client) Scroll(ctx context.Context, collection string, filter map[string]any, limit int) ([]Point, error) {
	if c == nil || c.baseURL == "" {
		return nil, fmt.Errorf("qdrant client not configured")
	}
	if limit <= 0 {
		limit = 100
	}

	body := map[string]any{
		"limit":        limit,
		"with_payload": true,
		"with_vector":  false,
	}
	if filter != nil {
		body["filter"] = filter
	}

	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encode scroll body: %w", err)
	}

	reqURL := fmt.Sprintf("%s/collections/%s/points/scroll", c.baseURL, collection)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(encoded))
	if err != nil {
		return nil, fmt.Errorf("create scroll request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("api-key", c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("qdrant scroll request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("qdrant scroll %s returned %d: %s", collection, resp.StatusCode, strings.TrimSpace(string(snippet)))
	}

	var decoded scrollResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("decode scroll response: %w", err)
	}
	return decoded.Result.Points, nil
}
