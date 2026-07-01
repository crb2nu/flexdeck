package handlers

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// The Flightdeck surface is a read-only proxy to the loom-flightdeck board JSON
// API (/api/v2/board/* and /api/v2/context/*), which wraps the Stall Board and
// Context Ledger query module. flexdeck injects the bearer token (internal/
// loomupstream) so the browser never holds it.

// proxyFlightdeckJSON forwards a GET to the flightdeck board API, passing through
// the raw JSON with short-TTL caching. Returns 503 when flightdeck is
// unconfigured/disabled; 502 (uncached) on upstream error.
func (h *Handler) proxyFlightdeckJSON(w http.ResponseWriter, r *http.Request, cacheKey string, ttl time.Duration, fdPath string) {
	if !h.loomFlightdeckEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "flightdeck disabled"})
		return
	}
	path := fdPath
	key := cacheKey
	if rq := strings.TrimSpace(r.URL.RawQuery); rq != "" {
		path += "?" + rq
		key += "?" + rq
	}
	h.cachedProxyJSON(w, r, key, ttl, "loom flightdeck", func() (any, error) {
		raw, err := h.flightdeckClient.Get(r.Context(), path)
		if err != nil {
			return nil, err
		}
		return raw, nil
	})
}

// --- Stall Board (Screen 1) ---

func (h *Handler) LoomFlightdeckBoardSummary(w http.ResponseWriter, r *http.Request) {
	h.proxyFlightdeckJSON(w, r, "loom:fd:board:summary", 10*time.Second, "/api/v2/board/summary")
}

func (h *Handler) LoomFlightdeckBoardStalls(w http.ResponseWriter, r *http.Request) {
	h.proxyFlightdeckJSON(w, r, "loom:fd:board:stalls", 15*time.Second, "/api/v2/board/stalls")
}

func (h *Handler) LoomFlightdeckBoardSession(w http.ResponseWriter, r *http.Request) {
	id := url.PathEscape(strings.TrimSpace(chi.URLParam(r, "id")))
	h.proxyFlightdeckJSON(w, r, "loom:fd:board:session:"+id, 20*time.Second, "/api/v2/board/session/"+id)
}

// --- Context Ledger (Screen 2) ---

func (h *Handler) LoomFlightdeckContextSummary(w http.ResponseWriter, r *http.Request) {
	h.proxyFlightdeckJSON(w, r, "loom:fd:context:summary", 30*time.Second, "/api/v2/context/summary")
}

func (h *Handler) LoomFlightdeckContextCatalog(w http.ResponseWriter, r *http.Request) {
	h.proxyFlightdeckJSON(w, r, "loom:fd:context:catalog", 60*time.Second, "/api/v2/context/catalog")
}

func (h *Handler) LoomFlightdeckContextRules(w http.ResponseWriter, r *http.Request) {
	h.proxyFlightdeckJSON(w, r, "loom:fd:context:rules", 60*time.Second, "/api/v2/context/rules")
}
