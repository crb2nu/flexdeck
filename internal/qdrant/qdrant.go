// Package qdrant provides a thin client for Qdrant's REST API,
// scoped to the scroll-by-filter access pattern flexdeck needs for federating
// project-tracking data (tasks, risks) out of agent-context collections.
//
// It is intentionally tiny: no vector search and only the collection/write
// operations needed to capture project risks. Read callers still degrade
// failures to "no results" at the call site.
package qdrant

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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
	Vector  []float64      `json:"vector,omitempty"`
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

// MatchKeyword builds a Qdrant filter matching points whose payload `key`
// equals value — a generic single-keyword match (e.g. plan_id for plan slices,
// which are keyed by plan_id rather than project).
func MatchKeyword(key, value string) map[string]any {
	return map[string]any{
		"must": []any{
			map[string]any{
				"key":   key,
				"match": map[string]any{"value": value},
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

// EnsureCollection creates collection when missing and verifies the configured
// vector size when it already exists.
func (c *Client) EnsureCollection(ctx context.Context, collection string, vectorSize int, distance string) error {
	if c == nil || c.baseURL == "" {
		return fmt.Errorf("qdrant client not configured")
	}
	if vectorSize <= 0 {
		return fmt.Errorf("invalid vector size %d", vectorSize)
	}
	if strings.TrimSpace(distance) == "" {
		distance = "Cosine"
	}

	exists, existingSize, err := c.collectionVectorSize(ctx, collection)
	if err != nil {
		return err
	}
	if exists {
		if existingSize > 0 && existingSize != vectorSize {
			return fmt.Errorf("qdrant collection %q vector size=%d expected=%d", collection, existingSize, vectorSize)
		}
		return nil
	}

	body := map[string]any{
		"vectors": map[string]any{
			"size":     vectorSize,
			"distance": distance,
		},
	}
	return c.doJSON(ctx, http.MethodPut, fmt.Sprintf("/collections/%s", collection), body, nil)
}

// EnsureKeywordIndex idempotently creates a keyword payload index.
func (c *Client) EnsureKeywordIndex(ctx context.Context, collection, field string) error {
	body := map[string]any{
		"field_name":   field,
		"field_schema": "keyword",
	}
	if err := c.doJSON(ctx, http.MethodPut, fmt.Sprintf("/collections/%s/index", collection), body, nil); err != nil {
		return fmt.Errorf("ensure index %s.%s: %w", collection, field, err)
	}
	return nil
}

// Upsert stores points in collection.
func (c *Client) Upsert(ctx context.Context, collection string, points []Point, wait bool) error {
	if c == nil || c.baseURL == "" {
		return fmt.Errorf("qdrant client not configured")
	}
	if len(points) == 0 {
		return nil
	}
	body := map[string]any{"points": points}
	return c.doJSON(ctx, http.MethodPut, fmt.Sprintf("/collections/%s/points?wait=%t", collection, wait), body, nil)
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

	reqURL := fmt.Sprintf("/collections/%s/points/scroll", collection)
	var decoded scrollResponse
	if err := c.doJSON(ctx, http.MethodPost, reqURL, body, &decoded); err != nil {
		if isQdrantNotFound(err) {
			return []Point{}, nil
		}
		return nil, err
	}
	return decoded.Result.Points, nil
}

func (c *Client) collectionVectorSize(ctx context.Context, collection string) (bool, int, error) {
	var raw map[string]any
	err := c.doJSON(ctx, http.MethodGet, fmt.Sprintf("/collections/%s", collection), nil, &raw)
	if err != nil {
		if isQdrantNotFound(err) {
			return false, 0, nil
		}
		return false, 0, err
	}

	result, ok := raw["result"].(map[string]any)
	if !ok {
		return true, 0, fmt.Errorf("parse qdrant collection response: missing result")
	}
	cfg, ok := result["config"].(map[string]any)
	if !ok {
		return true, 0, fmt.Errorf("parse qdrant collection response: missing result.config")
	}
	params, ok := cfg["params"].(map[string]any)
	if !ok {
		return true, 0, fmt.Errorf("parse qdrant collection response: missing result.config.params")
	}
	if sz, ok := parseVectorSize(params["vectors"]); ok {
		return true, sz, nil
	}
	if vectors, ok := params["vectors"].(map[string]any); ok {
		for _, value := range vectors {
			if sz, ok := parseVectorSize(value); ok {
				return true, sz, nil
			}
		}
	}
	return true, 0, fmt.Errorf("parse qdrant collection response: could not determine vector size")
}

func parseVectorSize(value any) (int, bool) {
	obj, ok := value.(map[string]any)
	if !ok {
		return 0, false
	}
	switch n := obj["size"].(type) {
	case float64:
		if n > 0 {
			return int(n), true
		}
	case int:
		if n > 0 {
			return n, true
		}
	}
	return 0, false
}

type qdrantHTTPError struct {
	statusCode int
	body       string
}

func (e *qdrantHTTPError) Error() string {
	return fmt.Sprintf("qdrant HTTP %d: %s", e.statusCode, strings.TrimSpace(e.body))
}

func isQdrantNotFound(err error) bool {
	var httpErr *qdrantHTTPError
	return err != nil && errors.As(err, &httpErr) && httpErr.statusCode == http.StatusNotFound
}

func (c *Client) doJSON(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode qdrant request body: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}

	reqURL := c.baseURL + path
	req, err := http.NewRequestWithContext(ctx, method, reqURL, reader)
	if err != nil {
		return fmt.Errorf("create qdrant request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.apiKey != "" {
		req.Header.Set("api-key", c.apiKey)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("qdrant request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return &qdrantHTTPError{statusCode: resp.StatusCode, body: string(snippet)}
	}
	if out == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode qdrant response: %w", err)
	}
	return nil
}
