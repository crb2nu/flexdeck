package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/flexinfer/flexdeck/internal/api/handlers/apiutil"
)

var (
	langfuseDataClient   = apiutil.DefaultClient
	langfuseHealthClient = apiutil.ShortClient
)

// langfuseRequest issues an authenticated GET to the Langfuse public API.
func (h *Handler) langfuseRequest(endpoint string) ([]byte, int, error) {
	u := strings.TrimRight(h.cfg.Langfuse.URL, "/") + endpoint

	req, err := http.NewRequest(http.MethodGet, u, nil)
	if err != nil {
		return nil, 0, err
	}
	// Langfuse uses HTTP Basic auth with public key : secret key
	if h.cfg.Langfuse.PublicKey != "" && h.cfg.Langfuse.SecretKey != "" {
		req.SetBasicAuth(h.cfg.Langfuse.PublicKey, h.cfg.Langfuse.SecretKey)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := langfuseDataClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return body, resp.StatusCode, nil
}

// LangfuseHealth checks whether Langfuse is reachable.
func (h *Handler) LangfuseHealth(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Langfuse.Disabled || h.cfg.Langfuse.URL == "" {
		respondJSON(w, http.StatusOK, map[string]any{
			"healthy":  false,
			"disabled": true,
		})
		return
	}

	// Langfuse health endpoint (no auth needed)
	healthURL := strings.TrimRight(h.cfg.Langfuse.URL, "/") + "/api/public/health"
	resp, err := langfuseHealthClient.Get(healthURL)
	if err != nil {
		respondJSON(w, http.StatusOK, map[string]any{
			"healthy": false,
			"error":   err.Error(),
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	respondJSON(w, http.StatusOK, map[string]any{
		"healthy": resp.StatusCode == http.StatusOK,
		"status":  resp.StatusCode,
	})
}

// LangfuseMetrics returns daily usage metrics from Langfuse.
func (h *Handler) LangfuseMetrics(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Langfuse.Disabled || h.cfg.Langfuse.URL == "" {
		apiutil.RespondError(w, http.StatusServiceUnavailable, "LANGFUSE_DISABLED", "langfuse is disabled")
		return
	}

	// Build query params
	params := url.Values{}
	if v := r.URL.Query().Get("traceName"); v != "" {
		params.Set("traceName", v)
	}
	if v := r.URL.Query().Get("userId"); v != "" {
		params.Set("userId", v)
	}
	if v := r.URL.Query().Get("tags"); v != "" {
		params.Set("tags", v)
	}
	if v := r.URL.Query().Get("fromTimestamp"); v != "" {
		params.Set("fromTimestamp", v)
	}
	if v := r.URL.Query().Get("toTimestamp"); v != "" {
		params.Set("toTimestamp", v)
	}

	endpoint := "/api/public/metrics/daily"
	if len(params) > 0 {
		endpoint += "?" + params.Encode()
	}

	body, status, err := h.langfuseRequest(endpoint)
	if err != nil {
		apiutil.RespondError(w, http.StatusBadGateway, "LANGFUSE_ERROR", err.Error())
		return
	}
	if status != http.StatusOK {
		apiutil.RespondError(w, status, "LANGFUSE_ERROR", fmt.Sprintf("langfuse returned %d", status))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// LangfuseTraces returns recent traces from Langfuse.
func (h *Handler) LangfuseTraces(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Langfuse.Disabled || h.cfg.Langfuse.URL == "" {
		apiutil.RespondError(w, http.StatusServiceUnavailable, "LANGFUSE_DISABLED", "langfuse is disabled")
		return
	}

	params := url.Values{}
	// Forward supported query params
	for _, key := range []string{"page", "limit", "userId", "name", "sessionId", "fromTimestamp", "toTimestamp", "orderBy", "tags"} {
		if v := r.URL.Query().Get(key); v != "" {
			params.Set(key, v)
		}
	}
	// Default limit if none specified
	if params.Get("limit") == "" {
		params.Set("limit", "50")
	}

	endpoint := "/api/public/traces?" + params.Encode()
	body, status, err := h.langfuseRequest(endpoint)
	if err != nil {
		apiutil.RespondError(w, http.StatusBadGateway, "LANGFUSE_ERROR", err.Error())
		return
	}
	if status != http.StatusOK {
		apiutil.RespondError(w, status, "LANGFUSE_ERROR", fmt.Sprintf("langfuse returned %d", status))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// LangfuseScores returns evaluation scores from Langfuse.
func (h *Handler) LangfuseScores(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Langfuse.Disabled || h.cfg.Langfuse.URL == "" {
		apiutil.RespondError(w, http.StatusServiceUnavailable, "LANGFUSE_DISABLED", "langfuse is disabled")
		return
	}

	params := url.Values{}
	for _, key := range []string{"page", "limit", "userId", "name", "fromTimestamp", "toTimestamp"} {
		if v := r.URL.Query().Get(key); v != "" {
			params.Set(key, v)
		}
	}
	if params.Get("limit") == "" {
		params.Set("limit", "50")
	}

	endpoint := "/api/public/scores?" + params.Encode()
	body, status, err := h.langfuseRequest(endpoint)
	if err != nil {
		apiutil.RespondError(w, http.StatusBadGateway, "LANGFUSE_ERROR", err.Error())
		return
	}
	if status != http.StatusOK {
		apiutil.RespondError(w, status, "LANGFUSE_ERROR", fmt.Sprintf("langfuse returned %d", status))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// LangfuseModels returns model usage statistics from Langfuse.
// It queries traces grouped by model to provide per-model cost/token breakdowns.
func (h *Handler) LangfuseModels(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Langfuse.Disabled || h.cfg.Langfuse.URL == "" {
		apiutil.RespondError(w, http.StatusServiceUnavailable, "LANGFUSE_DISABLED", "langfuse is disabled")
		return
	}

	// Fetch recent observations (generations) which contain model-level data
	params := url.Values{}
	params.Set("limit", "100")
	params.Set("type", "GENERATION")
	for _, key := range []string{"fromTimestamp", "toTimestamp", "name"} {
		if v := r.URL.Query().Get(key); v != "" {
			params.Set(key, v)
		}
	}

	endpoint := "/api/public/observations?" + params.Encode()
	body, status, err := h.langfuseRequest(endpoint)
	if err != nil {
		apiutil.RespondError(w, http.StatusBadGateway, "LANGFUSE_ERROR", err.Error())
		return
	}
	if status != http.StatusOK {
		apiutil.RespondError(w, status, "LANGFUSE_ERROR", fmt.Sprintf("langfuse returned %d", status))
		return
	}

	// Parse and aggregate by model
	var result struct {
		Data []struct {
			Model           string          `json:"model"`
			ModelParameters json.RawMessage `json:"modelParameters"`
			Usage           *struct {
				Input  int `json:"input"`
				Output int `json:"output"`
				Total  int `json:"total"`
			} `json:"usage"`
			CalculatedTotalCost float64 `json:"calculatedTotalCost"`
			CompletionStartTime string  `json:"completionStartTime"`
			EndTime             string  `json:"endTime"`
			Level               string  `json:"level"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		// Fall back to raw response
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
		return
	}

	// Aggregate per model
	type modelStats struct {
		Model        string  `json:"model"`
		TotalCalls   int     `json:"totalCalls"`
		TotalTokens  int     `json:"totalTokens"`
		InputTokens  int     `json:"inputTokens"`
		OutputTokens int     `json:"outputTokens"`
		TotalCost    float64 `json:"totalCost"`
		Errors       int     `json:"errors"`
	}

	byModel := map[string]*modelStats{}
	for _, obs := range result.Data {
		name := obs.Model
		if name == "" {
			name = "unknown"
		}
		ms, ok := byModel[name]
		if !ok {
			ms = &modelStats{Model: name}
			byModel[name] = ms
		}
		ms.TotalCalls++
		ms.TotalCost += obs.CalculatedTotalCost
		if obs.Usage != nil {
			ms.InputTokens += obs.Usage.Input
			ms.OutputTokens += obs.Usage.Output
			ms.TotalTokens += obs.Usage.Total
		}
		if obs.Level == "ERROR" {
			ms.Errors++
		}
	}

	models := make([]modelStats, 0, len(byModel))
	for _, ms := range byModel {
		models = append(models, *ms)
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"models":            models,
		"totalObservations": len(result.Data),
	})
}
