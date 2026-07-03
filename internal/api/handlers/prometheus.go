package handlers

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/flexinfer/flexdeck/internal/api/handlers/apiutil"
	"github.com/flexinfer/flexdeck/internal/cache"
)

const (
	promInstantBucket = 15 * time.Second
	promMinFreshTTL   = 5 * time.Second
	promMaxFreshTTL   = 30 * time.Second
)

func (h *Handler) PromHealth(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":    false,
			"error": "prometheus disabled",
		})
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, h.cfg.Prom.URL+"/-/healthy", nil)
	if err != nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}

	resp, err := apiutil.ShortClient.Do(req)
	if err != nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":    false,
			"error": err.Error(),
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	respondJSON(w, http.StatusOK, map[string]any{
		"ok":     resp.StatusCode == http.StatusOK,
		"status": resp.StatusCode,
	})
}

func (h *Handler) PromQuery(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		apiutil.RespondError(w, http.StatusServiceUnavailable, "PROM_DISABLED", "prometheus is disabled")
		return
	}

	query := r.URL.Query().Get("query")
	if query == "" {
		apiutil.RespondError(w, http.StatusBadRequest, "MISSING_PARAM", "missing query parameter")
		return
	}

	queryTime := r.URL.Query().Get("time")
	if h.cache == nil {
		promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
			RawPath("/api/v1/query").
			Param("query", query).
			Param("time", queryTime).
			String()
		apiutil.ProxyRequest(r.Context(), w, promURL)
		return
	}

	effectiveTime := time.Now().UTC()
	if queryTime != "" {
		parsedTime, err := parsePromTimestamp(queryTime)
		if err != nil {
			promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
				RawPath("/api/v1/query").
				Param("query", query).
				Param("time", queryTime).
				String()
			apiutil.ProxyRequest(r.Context(), w, promURL)
			return
		}
		effectiveTime = parsedTime
	}
	normalizedTime := floorTimestamp(effectiveTime, promInstantBucket)
	promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
		RawPath("/api/v1/query").
		Param("query", query).
		Param("time", strconv.FormatInt(normalizedTime.Unix(), 10)).
		String()

	cacheKey := "prom:query:" + query + ":" + strconv.FormatInt(normalizedTime.Unix(), 10)
	h.proxyPromCached(w, r, cacheKey, promURL, promCacheOptions(promInstantBucket))
}

func (h *Handler) PromQueryRange(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		apiutil.RespondError(w, http.StatusServiceUnavailable, "PROM_DISABLED", "prometheus is disabled")
		return
	}

	query := r.URL.Query().Get("query")
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")
	step := r.URL.Query().Get("step")

	if query == "" || start == "" || end == "" {
		apiutil.RespondError(w, http.StatusBadRequest, "MISSING_PARAM", "missing required parameters (query, start, end)")
		return
	}

	if step == "" {
		step = "60" // Default 1 minute
	}

	stepValue, stepDuration, err := normalizePromStep(step)
	if err != nil || h.cache == nil {
		promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
			RawPath("/api/v1/query_range").
			Param("query", query).
			Param("start", start).
			Param("end", end).
			Param("step", step).
			String()
		apiutil.ProxyRequest(r.Context(), w, promURL)
		return
	}

	startTime, err := parsePromTimestamp(start)
	if err != nil {
		promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
			RawPath("/api/v1/query_range").
			Param("query", query).
			Param("start", start).
			Param("end", end).
			Param("step", stepValue).
			String()
		apiutil.ProxyRequest(r.Context(), w, promURL)
		return
	}
	endTime, err := parsePromTimestamp(end)
	if err != nil {
		promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
			RawPath("/api/v1/query_range").
			Param("query", query).
			Param("start", start).
			Param("end", end).
			Param("step", stepValue).
			String()
		apiutil.ProxyRequest(r.Context(), w, promURL)
		return
	}

	normalizedStart := floorTimestamp(startTime, stepDuration)
	normalizedEnd := floorTimestamp(endTime, stepDuration)
	promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
		RawPath("/api/v1/query_range").
		Param("query", query).
		Param("start", strconv.FormatInt(normalizedStart.Unix(), 10)).
		Param("end", strconv.FormatInt(normalizedEnd.Unix(), 10)).
		Param("step", stepValue).
		String()

	cacheKey := "prom:query_range:" + query + ":" + strconv.FormatInt(normalizedStart.Unix(), 10) + ":" + strconv.FormatInt(normalizedEnd.Unix(), 10) + ":" + stepValue
	h.proxyPromCached(w, r, cacheKey, promURL, promCacheOptions(stepDuration))
}

// PromAlerts returns active alerts from Prometheus Alertmanager
func (h *Handler) PromAlerts(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		apiutil.RespondError(w, http.StatusServiceUnavailable, "PROM_DISABLED", "prometheus is disabled")
		return
	}

	promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
		RawPath("/api/v1/alerts").
		String()

	apiutil.ProxyRequest(r.Context(), w, promURL)
}

// PromRules returns alert rules from Prometheus
func (h *Handler) PromRules(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		apiutil.RespondError(w, http.StatusServiceUnavailable, "PROM_DISABLED", "prometheus is disabled")
		return
	}

	promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
		RawPath("/api/v1/rules").
		Param("type", r.URL.Query().Get("type")).
		String()

	apiutil.ProxyRequest(r.Context(), w, promURL)
}

// respondJSON is a package-level helper that wraps apiutil.RespondRaw for backward compatibility.
// Other handlers in this package can use this directly. New code should use apiutil.RespondJSON
// or apiutil.RespondData for the standard response envelope.
func respondJSON(w http.ResponseWriter, status int, data any) {
	apiutil.RespondRaw(w, status, data)
}

// proxyRequest is a package-level helper that wraps apiutil.ProxyRequest.
func proxyRequest(ctx context.Context, w http.ResponseWriter, targetURL string) {
	apiutil.ProxyRequest(ctx, w, targetURL)
}

// Ensure url import is used (for URL building in other handlers that might import this)
var _ = url.QueryEscape

type promProxyError struct {
	statusCode  int
	contentType string
	body        []byte
}

func (e *promProxyError) Error() string {
	return "prometheus proxy request failed"
}

func (h *Handler) proxyPromCached(w http.ResponseWriter, r *http.Request, cacheKey, promURL string, opts cache.FetchOptions) {
	if h.cache == nil {
		apiutil.ProxyRequest(r.Context(), w, promURL)
		return
	}

	data, err := h.cache.GetOrFetchBytesWithOptions(r.Context(), cacheKey, opts, func(fetchCtx context.Context) ([]byte, error) {
		req, reqErr := http.NewRequestWithContext(fetchCtx, http.MethodGet, promURL, nil)
		if reqErr != nil {
			return nil, reqErr
		}

		resp, doErr := apiutil.ShortClient.Do(req)
		if doErr != nil {
			return nil, doErr
		}
		defer func() { _ = resp.Body.Close() }()

		body, readErr := io.ReadAll(resp.Body)
		if readErr != nil {
			return nil, readErr
		}
		if resp.StatusCode != http.StatusOK {
			return nil, &promProxyError{
				statusCode:  resp.StatusCode,
				contentType: resp.Header.Get("Content-Type"),
				body:        body,
			}
		}

		return body, nil
	})
	if err != nil {
		var proxyErr *promProxyError
		if errors.As(err, &proxyErr) {
			if proxyErr.contentType != "" {
				w.Header().Set("Content-Type", proxyErr.contentType)
			}
			w.WriteHeader(proxyErr.statusCode)
			_, _ = w.Write(proxyErr.body)
			return
		}
		apiutil.RespondError(w, http.StatusBadGateway, "PROM_QUERY_FAILED", err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func normalizePromStep(step string) (string, time.Duration, error) {
	if step == "" {
		return "60", 60 * time.Second, nil
	}

	if seconds, err := strconv.ParseFloat(step, 64); err == nil {
		duration := time.Duration(seconds * float64(time.Second))
		return strconv.FormatFloat(seconds, 'f', -1, 64), duration, nil
	}

	duration, err := time.ParseDuration(step)
	if err != nil {
		return "", 0, err
	}

	seconds := duration.Seconds()
	return strconv.FormatFloat(seconds, 'f', -1, 64), duration, nil
}

func parsePromTimestamp(value string) (time.Time, error) {
	if seconds, err := strconv.ParseFloat(value, 64); err == nil {
		return time.Unix(0, int64(seconds*float64(time.Second))).UTC(), nil
	}
	return time.Parse(time.RFC3339Nano, value)
}

func floorTimestamp(ts time.Time, step time.Duration) time.Time {
	if step <= 0 {
		return ts.UTC()
	}
	return time.Unix(0, ts.UTC().UnixNano()/int64(step)*int64(step)).UTC()
}

func promCacheOptions(step time.Duration) cache.FetchOptions {
	freshTTL := step
	if freshTTL < promMinFreshTTL {
		freshTTL = promMinFreshTTL
	}
	if freshTTL > promMaxFreshTTL {
		freshTTL = promMaxFreshTTL
	}

	return cache.FetchOptions{
		TTL:                      freshTTL,
		StaleTTL:                 freshTTL * 4,
		JitterFraction:           0.15,
		BackgroundRefreshTimeout: 3 * time.Second,
	}
}
