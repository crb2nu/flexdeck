package handlers

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// maxMillsMutationBody caps a mutation request body. Mills control payloads are
// tiny (a kill-switch reason, an escalation note), so 64KB is generous.
const maxMillsMutationBody = 64 << 10

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

// --- Mutations (slice 6, dark-launched) ---
//
// The operational control layer: pause / resume / escalate a pipeline run and
// the policy kill-switch. Each is gated by three independent checks so the
// dark-launch is fail-safe:
//
//  1. The route is mounted under RBAC PermAdmin (router.go) and audit-logged.
//  2. loomMillsMutationsEnabled requires the LOOM_MILLS_MUTATIONS_ENABLED flag
//     (default off) AND an admin token — even an admin gets 503 until flipped.
//  3. The operator itself enforces requireAdmin on every mutating route.

// loomMillsMutationsEnabled reports whether mills mutations are live: the mills
// surface is enabled, the mutations flag is flipped, and an admin token is
// configured for the upstream bearer.
func (h *Handler) loomMillsMutationsEnabled() bool {
	return h.loomMillsEnabled() && h.cfg.Mills.MutationsEnabled && h.millsClient.CanMutate()
}

// proxyMillsMutation forwards a POST to the mills operator with the admin
// bearer, passing the operator's status and body straight through. It returns
// 503 when mutations are disabled (the dark-launch default) and 502 on a
// transport failure, so the UI can distinguish "not available" from "upstream
// error". Affected read caches are invalidated so the next poll reflects the
// change.
func (h *Handler) proxyMillsMutation(w http.ResponseWriter, r *http.Request, millsPath string) {
	if !h.loomMillsMutationsEnabled() {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "mills mutations disabled"})
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, maxMillsMutationBody))
	if err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "failed to read request body"})
		return
	}

	raw, status, err := h.millsClient.Post(r.Context(), millsPath, body)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	// A 401/403 from the operator means flexdeck's mills admin token is missing
	// or rejected — a server-side misconfiguration, not the browser user's
	// session. Surface it as a gateway error so the frontend's RBAC login gate
	// (which reacts to 401) does not spuriously log the user out.
	if status == http.StatusUnauthorized || status == http.StatusForbidden {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": "mills operator rejected the admin token"})
		return
	}

	if h.cache != nil {
		h.cache.Invalidate(r.Context(), "loom:mills:status")
		h.cache.Invalidate(r.Context(), "loom:mills:pipeline:runs")
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}

// LoomMillsPipelinePause pauses a running pipeline.
func (h *Handler) LoomMillsPipelinePause(w http.ResponseWriter, r *http.Request) {
	id := millsPathParam(r, "id")
	h.proxyMillsMutation(w, r, "/api/mills/pipeline/runs/"+id+"/pause")
}

// LoomMillsPipelineResume resumes a paused pipeline.
func (h *Handler) LoomMillsPipelineResume(w http.ResponseWriter, r *http.Request) {
	id := millsPathParam(r, "id")
	h.proxyMillsMutation(w, r, "/api/mills/pipeline/runs/"+id+"/resume")
}

// LoomMillsPipelineEscalate escalates a pipeline run to human review.
func (h *Handler) LoomMillsPipelineEscalate(w http.ResponseWriter, r *http.Request) {
	id := millsPathParam(r, "id")
	h.proxyMillsMutation(w, r, "/api/mills/pipeline/runs/"+id+"/escalate")
}

// LoomMillsKillSwitch trips the autonomy kill-switch (halts all mills work).
func (h *Handler) LoomMillsKillSwitch(w http.ResponseWriter, r *http.Request) {
	h.proxyMillsMutation(w, r, "/api/mills/policy/kill-switch")
}
