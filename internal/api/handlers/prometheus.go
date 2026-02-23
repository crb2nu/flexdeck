package handlers

import (
	"net/http"
	"net/url"

	"github.com/flexinfer/flexdeck/internal/api/handlers/apiutil"
)

func (h *Handler) PromHealth(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"ok":    false,
			"error": "prometheus disabled",
		})
		return
	}

	resp, err := apiutil.ShortClient.Get(h.cfg.Prom.URL + "/-/healthy")
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

	promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
		RawPath("/api/v1/query").
		Param("query", query).
		Param("time", r.URL.Query().Get("time")).
		String()

	apiutil.ProxyRequest(w, promURL)
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

	promURL := apiutil.NewURLBuilder(h.cfg.Prom.URL).
		RawPath("/api/v1/query_range").
		Param("query", query).
		Param("start", start).
		Param("end", end).
		Param("step", step).
		String()

	apiutil.ProxyRequest(w, promURL)
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

	apiutil.ProxyRequest(w, promURL)
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

	apiutil.ProxyRequest(w, promURL)
}

// respondJSON is a package-level helper that wraps apiutil.RespondRaw for backward compatibility.
// Other handlers in this package can use this directly. New code should use apiutil.RespondJSON
// or apiutil.RespondData for the standard response envelope.
func respondJSON(w http.ResponseWriter, status int, data any) {
	apiutil.RespondRaw(w, status, data)
}

// proxyRequest is a package-level helper that wraps apiutil.ProxyRequest.
func proxyRequest(w http.ResponseWriter, targetURL string) {
	apiutil.ProxyRequest(w, targetURL)
}

// Ensure url import is used (for URL building in other handlers that might import this)
var _ = url.QueryEscape
