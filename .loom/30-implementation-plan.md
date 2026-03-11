# Implementation Plan — Feature Improvements And Polish (2026-03)

## Implementation Plan — Snappy UX And Smarter Redis (2026-03-06)

### Scope
- Repository: `/Users/cblevins/workspace/services/flexdeck`
- Focus:
  - system-level performance improvements after the recent frontend runtime passes
  - Redis architecture and cache effectiveness
  - UX/freshness improvements that make data-heavy pages feel immediate
- Out of scope:
  - major new product features
  - cross-repo infrastructure migrations that are not required for FlexDeck performance

### Objectives
1. Make Redis an independent platform capability for FlexDeck, not a side effect of LiteLLM metrics.
2. Convert repeated dashboard reads into cache-friendly, coalesced, and where appropriate precomputed responses.
3. Standardize page polling so inactive tabs and inactive routes do not keep paying full refresh cost.
4. Expose freshness/degraded states clearly so the UI feels responsive even when data is being refreshed.

### Milestones

#### M1. Redis Decoupling And Cache Runtime Hardening
- Create an independent Redis bootstrap path in `cmd/server/main.go`.
- Pass a generic Redis cache/client into handlers even when LiteLLM is disabled.
- Extend `internal/cache/cache.go` with:
  - singleflight request coalescing
  - optional stale-while-revalidate windows
  - TTL jitter
  - lightweight hit/miss telemetry hooks

#### M2. Prometheus And Metrics Read Optimization
- Add normalized short-TTL backend caching for hot Prometheus query/query_range requests.
- Bucket time ranges to improve cache reuse.
- Identify repeated dashboard PromQL worth converting into recording rules.
- Optionally add a compact dashboard-summary endpoint to reduce six-way frontend panel fan-out.

#### M3. Redis Materialization For Hot Summaries
- Materialize:
  - LiteLLM throughput summaries by model/window
  - CI trend summaries by project/window
  - CI repository config-detection summaries
- Keep raw sorted sets for history and debugging.
- Stop recomputing expensive aggregates on every read path.

#### M4. Shared Polling And Freshness UX
- Expand visibility-aware polling patterns from Prometheus metrics into shared page infrastructure.
- Apply first to:
  - Agents
  - Alerts
  - Dashboard node resources
  - remaining Models subpanels
- Introduce consistent UI freshness states:
  - `live`
  - `cached`
  - `stale-refreshing`
  - `paused`
  - `degraded`

#### M5. Measurement And Verification
- Add backend cache metrics and Prometheus/Redis cache-hit instrumentation.
- Add frontend `PerformanceObserver` hooks for long tasks / long animation frames in development or debug mode.
- Validate with:
  - backend tests for cache behavior and handler semantics
  - frontend tests for polling lifecycle and freshness UI
  - targeted perf smoke runs on topology, pipeline, metrics, and CI repository views

### Prioritized Backlog

#### Slice 1: Independent Redis Cache Bootstrap
- Target files:
  - `cmd/server/main.go`
  - `internal/api/handlers/handlers.go`
  - `internal/config/config.go` if a clearer Redis/cache config split is needed
- Deliverables:
  - generic Redis client/cache exists whenever Redis is configured
  - `metrics.Store` becomes optional specialized storage on top of that client
- Why first:
  - unlocks broader cache coverage without frontend changes
  - removes an architectural footgun where disabling LiteLLM silently removes unrelated caching

#### Slice 2: Cache Wrapper Hardening
- Target files:
  - `internal/cache/cache.go`
  - `internal/cache/cache_test.go`
- Deliverables:
  - request coalescing
  - stale-while-revalidate mode for eligible handlers
  - TTL jitter
  - tests for concurrent misses and stale serve behavior
- Why second:
  - gives immediate protection to existing `GetOrFetch` call sites across K8s/Grafana/CI/Alertmanager/FlexInfer

#### Slice 3: Prometheus Query Caching
- Target files:
  - `internal/api/handlers/prometheus.go`
  - `web/src/components/Metrics/usePrometheusMetricsController.ts`
  - possibly `internal/api/handlers/apiutil/*` if request normalization helpers are needed
- Deliverables:
  - short-TTL cached query/query_range responses
  - normalized time-bucket keys
  - clear `last updated` / `cached` semantics in the UI
- Why third:
  - directly improves one of the most obviously repetitive dashboard request paths

#### Slice 4: Polling Registry Expansion
- Target files:
  - `web/src/lib/polling.ts`
  - `web/src/components/Agents/*`
  - `web/src/components/Alerts/index.tsx`
  - `web/src/components/Dashboard/NodeResourcePanel.tsx`
  - `web/src/components/Models/*`
- Deliverables:
  - common scheduling policy
  - visibility-aware pause/resume
  - route-active gating
  - consolidated refresh diagnostics

#### Slice 5: Materialized Redis Summaries
- Target files:
  - `internal/metrics/store.go`
  - `internal/metrics/pipeline_store.go`
  - `internal/api/handlers/litellm.go`
  - `internal/api/handlers/ci.go`
- Deliverables:
  - cached summary blobs updated on write or via bounded recompute windows
  - fewer full-key scans and repeated JSON deserializations on read

### Validation Plan
- Backend:
  - `go test ./internal/cache/... ./internal/api/handlers/... ./internal/metrics/...`
- Frontend:
  - `npm -C web run -s test`
  - `npm -C web run -s lint`
  - `npm -C web run -s typecheck`
- Perf-focused checks:
  - confirm hidden-tab polling stops for migrated pages
  - confirm Prometheus tab repeat loads hit backend cache
  - confirm CI repository list cold and warm timings improve
  - confirm stale-refresh UX renders immediately instead of spinner-only states

### Risks And Mitigations
- Risk: stale-while-revalidate hides real failures if freshness state is invisible.
  - Mitigation: always expose `cached` / `stale-refreshing` / `degraded` state in the UI.
- Risk: over-caching Prometheus responses can mislead operators during incidents.
  - Mitigation: keep TTLs short, align to query step, and bypass or reduce TTL for critical instant reads.
- Risk: materialized summaries drift from raw history.
  - Mitigation: treat raw sorted sets as source of truth and rebuild summaries deterministically when needed.
- Risk: polling centralization can break page-local assumptions.
  - Mitigation: migrate page by page behind stable controller APIs.

### Recommended Execution Order
1. Redis bootstrap decoupling
2. Cache wrapper hardening
3. Prometheus query caching
4. Polling registry rollout
5. Materialized metrics and CI summaries

### Sources
- `cmd/server/main.go:54`
- `cmd/server/main.go:59`
- `internal/api/handlers/handlers.go:84`
- `internal/cache/cache.go:27`
- `internal/api/handlers/prometheus.go:35`
- `internal/api/handlers/prometheus.go:56`
- `internal/api/handlers/ci.go:38`
- `internal/api/handlers/ci.go:78`
- `internal/api/handlers/ci.go:133`
- `internal/metrics/store.go:115`
- `internal/metrics/pipeline_store.go:66`
- `web/src/components/Metrics/usePrometheusMetricsController.ts:173`
- `web/src/components/Alerts/index.tsx:40`
- `web/src/components/Agents/HUDTab.tsx:128`
- `web/src/components/Models/InferenceTab.tsx:114`
- `web/src/components/Models/GPUMetricsPanel.tsx:181`
- `web/src/components/Dashboard/NodeResourcePanel.tsx:152`
- [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
- [Redis: Cache-Aside Pattern with Redis](https://redis.io/tutorials/howtos/solutions/microservices/caching/)
- [Grafana docs: data source query caching](https://grafana.com/docs/grafana/latest/administration/data-source-management/)
- [Grafana docs: Prometheus incremental dashboard queries](https://grafana.com/docs/grafana/latest/datasources/prometheus/query-editor/)
- [Prometheus: recording rules](https://prometheus.io/docs/prometheus/latest/configuration/recording_rules/)

## Scope
- Repository: `/Users/cblevins/workspace/services/flexdeck`
- Focus: polish and consistency across recently changed Pipeline, Grafana, Dashboard/mobile, and delivery workflows.
- Out of scope: new subsystem development, cross-repo API changes.

## Milestones
1. **M1 — Planning Baseline Refresh**
   - Refresh `.loom` context pack and MCP/runtime inventory.
   - Capture current constraints (codebase index connectivity issue).
2. **M2 — Pipeline Confidence Polish**
   - Land pipeline state/freshness UX and action feedback consistency.
3. **M3 — Grafana + Dashboard Signal Coherence**
   - Expose query resolution states and unify status semantics across cards.
   - Complete final mobile polish verification pass.
4. **M4 — Verification, Reconciliation, Handoff**
   - Execute test/ship loop and update roadmap-reconciliation evidence.

## Delivery Status (As Of 2026-03-03)
- Workstream A: Delivered on `origin/main` (`6587649`, pipeline polish/status clarity).
- Workstream B: Delivered on `origin/main` (`343565d`, Grafana resolution/fallback diagnostics).
- Workstream C: Delivered on `origin/main` (`3f39d9a`, dashboard status semantics + feature-gate clarity).
- Workstream D: Completed in this branch (governance sync + release smoke checklist), pending merge.

## Workstreams

### Workstream A: Pipeline UX Confidence
- Target files:
  - `web/src/components/Pipeline/index.tsx`
  - `web/src/components/Pipeline/CIPipelineViz.tsx`
  - `web/src/components/Pipeline/PipelineCard.tsx`
  - `web/src/components/Pipeline/utils.ts`
  - `web/src/components/Pipeline/utils.test.ts`
- Tasks:
  - Add explicit live/stale/static/offline status affordances.
  - Standardize retry/cancel/play feedback and refresh timing.
  - Tighten overview/detail synchronization logic under polling transitions.

### Workstream B: Grafana Operability Polish
- Target files:
  - `web/src/components/Metrics/GrafanaDashboards.tsx`
  - `internal/api/handlers/grafana.go` (if backend messaging adjustments are required)
- Tasks:
  - Surface query resolution path (`direct|templated|fallback`) in panel UI.
  - Improve unresolved-template diagnostics and unsupported-query messaging.
  - Verify expanded panel readability on constrained layouts.

### Workstream C: Dashboard/Mobile Signal Clarity
- Target files:
  - `web/src/components/Dashboard/index.tsx`
  - `web/src/AppLayout.tsx`
  - `web/src/components/Dashboard/PodLogPanel.tsx` (if overlay interaction adjustments are needed)
- Tasks:
  - Unify card status semantics across model/inference/agent polling surfaces.
  - Ensure feature-gated disabled states are distinguishable from runtime failures.
  - Regression-check sub-375px and touch overlay behavior.

### Workstream D: Testing + Governance
- Target files:
  - `.loom/00-index.md`
  - `.loom/10-research.md`
  - `.loom/20-product-spec.md`
  - `.loom/30-implementation-plan.md`
  - `.loom/50-worklog.md`
  - `docs/polish-release-smoke-checklist.md`
  - `docs/roadmap-reconciliation-*.md`
- Tasks:
  - Keep planning artifacts synchronized with code deltas.
  - Add concise smoke checklist for polish releases.

## Core Workflow Packs (Execution Design)
1. **Research loop**
   - Inputs: `git log`, touched-file frequency, targeted source reads.
   - Output: `.loom/10-research.md` evidence + prioritized polish gaps.
2. **Technical writing loop**
   - Inputs: roadmap + research findings.
   - Output: updated `.loom/20-product-spec.md` and `.loom/30-implementation-plan.md`.
3. **Testing + ship loop**
   - Commands:
     - `npm -C web run -s test`
     - `npm -C web run -s lint`
     - `go test ./internal/api/handlers/... ./internal/metrics/...`
     - `make lint` (if touched scope justifies full run)
4. **Troubleshooting loop**
   - Trigger: stale data, auth fallback failures, inconsistent poll state.
   - Tools: targeted UI logs + handler tests + endpoint spot checks.
5. **Coordination loop**
   - Track decisions/worklog updates in `.loom/40-decisions.md` and `.loom/50-worklog.md`.
   - Keep reconciliation notes aligned with meaningful code deltas.

## Validation Plan
- Functional:
  - Pipeline actions show deterministic post-action states.
  - Grafana panel cards expose resolution/fallback state.
  - Dashboard cards show consistent readiness semantics.
- Regression:
  - Mobile breakpoints: 320px, 375px, 390px, desktop.
  - Hosted route/API base behavior remains correct.
- Quality gates:
  - Frontend tests/lint pass.
  - Targeted backend tests pass for touched handlers.
  - Smoke checklist is executed and recorded in reconciliation notes (`docs/polish-release-smoke-checklist.md`).

## Risks And Mitigations
- Risk: semantic codebase index unavailable (`qdrant` route issue).
  - Mitigation: use deterministic local code-reading workflow for this cycle.
- Risk: polish changes introduce subtle UI regressions.
  - Mitigation: enforce explicit smoke checklist across Pipeline/Grafana/Dashboard mobile surfaces.
- Risk: mixed feature-flag states produce false “offline” signals.
  - Mitigation: normalize status vocabulary and render logic by feature gate.

## Sources
- `web/src/components/Pipeline/index.tsx:134`
- `web/src/components/Pipeline/CIPipelineViz.tsx:194`
- `web/src/components/Metrics/GrafanaDashboards.tsx:221`
- `web/src/components/Dashboard/index.tsx:176`
- `docs/roadmap-reconciliation-2026-03-03.md:1`
- Command: `codebase_memory__codebase_stats(repo_id="services-flexdeck")`
