package handlers

import (
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// The Mills surface is a thin, read-only proxy to the loom-mills-operator REST
// API (/api/mills/*). flexdeck talks to the operator directly (internal/
// loomupstream) because the in-cluster HUD upstream does not front mills — see
// the slice-1 kill-test. Mutating routes (start/pause/escalate/kill-switch) are
// admin-gated on the operator and land in slice 6.

// proxyMillsJSON forwards a GET to the mills operator, passing through the raw
// JSON with short-TTL caching. Returns 503 when mills is unconfigured/disabled
// so the UI can render an unavailable state. The upstream error path returns
// 502 (and is not cached), so a flaky operator serves the last good value.
func (h *Handler) proxyMillsJSON(w http.ResponseWriter, r *http.Request, cacheKey string, ttl time.Duration, millsPath string) {
	if !h.loomMillsEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "mills operator disabled"})
		return
	}
	path := millsPath
	key := cacheKey
	if rq := strings.TrimSpace(r.URL.RawQuery); rq != "" {
		path += "?" + rq
		key += "?" + rq
	}
	h.cachedProxyJSON(w, r, key, ttl, "loom mills", func() (any, error) {
		raw, err := h.millsClient.Get(r.Context(), path)
		if err != nil {
			return nil, err
		}
		return raw, nil
	})
}

// millsPathParam returns a URL-safe path segment from a chi route param.
func millsPathParam(r *http.Request, key string) string {
	return url.PathEscape(strings.TrimSpace(chi.URLParam(r, key)))
}

// --- Overview / policy ---

func (h *Handler) LoomMillsStatus(w http.ResponseWriter, r *http.Request) {
	h.proxyMillsJSON(w, r, "loom:mills:status", 10*time.Second, "/api/mills/status")
}

func (h *Handler) LoomMillsKPIs(w http.ResponseWriter, r *http.Request) {
	h.proxyMillsJSON(w, r, "loom:mills:kpis", 15*time.Second, "/api/mills/kpis")
}

func (h *Handler) LoomMillsPolicy(w http.ResponseWriter, r *http.Request) {
	h.proxyMillsJSON(w, r, "loom:mills:policy", 30*time.Second, "/api/mills/policy")
}

// --- Backlog ---

func (h *Handler) LoomMillsBacklog(w http.ResponseWriter, r *http.Request) {
	h.proxyMillsJSON(w, r, "loom:mills:backlog", 15*time.Second, "/api/mills/backlog")
}

func (h *Handler) LoomMillsBacklogItem(w http.ResponseWriter, r *http.Request) {
	id := millsPathParam(r, "id")
	h.proxyMillsJSON(w, r, "loom:mills:backlog:"+id, 15*time.Second, "/api/mills/backlog/"+id)
}

// --- Pipelines ---

func (h *Handler) LoomMillsPipelineRuns(w http.ResponseWriter, r *http.Request) {
	h.proxyMillsJSON(w, r, "loom:mills:pipeline:runs", 10*time.Second, "/api/mills/pipeline/runs")
}

func (h *Handler) LoomMillsPipelineRun(w http.ResponseWriter, r *http.Request) {
	id := millsPathParam(r, "id")
	h.proxyMillsJSON(w, r, "loom:mills:pipeline:run:"+id, 10*time.Second, "/api/mills/pipeline/runs/"+id)
}

// --- Council ---

func (h *Handler) LoomMillsCouncilRuns(w http.ResponseWriter, r *http.Request) {
	h.proxyMillsJSON(w, r, "loom:mills:council:runs", 15*time.Second, "/api/mills/council/runs")
}

func (h *Handler) LoomMillsCouncilRun(w http.ResponseWriter, r *http.Request) {
	id := millsPathParam(r, "id")
	h.proxyMillsJSON(w, r, "loom:mills:council:run:"+id, 30*time.Second, "/api/mills/council/runs/"+id)
}

func (h *Handler) LoomMillsCouncilDebate(w http.ResponseWriter, r *http.Request) {
	id := millsPathParam(r, "id")
	h.proxyMillsJSON(w, r, "loom:mills:council:debate:"+id, 60*time.Second, "/api/mills/council/runs/"+id+"/debate")
}

// --- Eval / squads / audit / policy proposals ---

func (h *Handler) LoomMillsEvalScores(w http.ResponseWriter, r *http.Request) {
	h.proxyMillsJSON(w, r, "loom:mills:eval:scores", 30*time.Second, "/api/mills/eval/scores")
}

func (h *Handler) LoomMillsSquads(w http.ResponseWriter, r *http.Request) {
	h.proxyMillsJSON(w, r, "loom:mills:squads", 30*time.Second, "/api/mills/squads")
}

func (h *Handler) LoomMillsSquad(w http.ResponseWriter, r *http.Request) {
	name := millsPathParam(r, "name")
	h.proxyMillsJSON(w, r, "loom:mills:squad:"+name, 30*time.Second, "/api/mills/squads/"+name)
}

func (h *Handler) LoomMillsAuditFindings(w http.ResponseWriter, r *http.Request) {
	h.proxyMillsJSON(w, r, "loom:mills:audit:findings", 30*time.Second, "/api/mills/audit/findings")
}

func (h *Handler) LoomMillsAuditFinding(w http.ResponseWriter, r *http.Request) {
	id := millsPathParam(r, "id")
	h.proxyMillsJSON(w, r, "loom:mills:audit:finding:"+id, 30*time.Second, "/api/mills/audit/findings/"+id)
}

func (h *Handler) LoomMillsPolicyProposals(w http.ResponseWriter, r *http.Request) {
	h.proxyMillsJSON(w, r, "loom:mills:policy:proposals", 20*time.Second, "/api/mills/policy/proposals")
}
