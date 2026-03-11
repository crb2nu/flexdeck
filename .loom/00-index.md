# Loom Context Pack

## Current Goal (2026-03-06 Addendum)
- Identify the next performance and UX improvements that will make FlexDeck feel consistently snappy.
- Audit whether Redis is being used as an independent platform cache or only as a side effect of LiteLLM metrics enablement.
- Produce an implementation-ready backlog grounded in local code evidence plus external guidance on dashboard performance, visibility-aware polling, caching, and Prometheus query optimization.

## Current Status Summary (2026-03-06 Addendum)
- Frontend runtime work has already improved topology, pipeline visualization, metrics polling, and Grafana live preview behavior, but several timer-heavy surfaces still poll independently (`web/src/components/Alerts/index.tsx:40`, `web/src/components/Agents/HUDTab.tsx:128`, `web/src/components/Models/InferenceTab.tsx:114`, `web/src/components/Models/GPUMetricsPanel.tsx:181`, `web/src/components/Dashboard/NodeResourcePanel.tsx:152`).
- Generic backend response caching is present across K8s, Grafana, CI, Alertmanager, FlexInfer, and LiteLLM handlers, but the cache bootstrap is currently tied to the LiteLLM metrics store (`internal/api/handlers/handlers.go:84`, `cmd/server/main.go:54`, `cmd/server/main.go:59`).
- Prometheus proxy endpoints currently bypass Redis entirely and proxy each query directly to Prometheus (`internal/api/handlers/prometheus.go:35`, `internal/api/handlers/prometheus.go:56`).
- Redis time-series storage exists for LiteLLM throughput and CI pipeline history, but hot summaries are recomputed from raw sorted sets on read (`internal/metrics/store.go:115`, `internal/metrics/pipeline_store.go:66`).
- Codebase search is available again through a lexical-only index after the embedding path failed in this environment; plan updates should treat semantic indexing as degraded but not unavailable.

## Quick Links
- Workspace snapshot: `00-workspace-snapshot.md`
- MCP inventory: `00-mcp-inventory.md`
- Research: `10-research.md`
- Product spec: `20-product-spec.md`
- Implementation plan: `30-implementation-plan.md`
- Decisions: `40-decisions.md`
- Worklog: `50-worklog.md`

## Current Goal (2026-03-03)
- Pick up from recent fixes/enhancements and define the next feature-improvement + polish wave.
- Keep delivery centered on reliability, operator clarity, and mobile/hosted usability.
- Produce execution-ready spec/plan updates grounded in shipped code and recent commit history.

## Current Status Summary
- Roadmap reflects Phase 3 and 3.5 delivery with Phase 4 marked partial behind flags.
- Recent changes clustered around:
  - CI reliability (`lint/typecheck` and mirrored build images).
  - Pipeline UX correctness (stage ordering, live status reactivity, deeper history/pagination).
  - Grafana integration hardening (auth fallback, expanded panel visibility, hosted base URL fixes).
  - Dashboard/model signal expansion (node resource panel, LiteLLM throughput on CRD cards).
  - Mobile behavior refinements (overlay and small-viewport fixes).
- Planning posture now shifts from feature introduction to consistency and polish across these surfaces.
- Workstream delivery status on `origin/main`:
  - Pipeline UX confidence (merged).
  - Grafana operability polish (merged).
  - Dashboard/mobile signal clarity (merged).
- Remaining backlog slice in this cycle is governance polish (checklists + reconciliation discipline).

## Success Criteria For This Cycle
- `.loom` docs capture a post-hardening improvement wave (not a re-plan of completed epics).
- Product spec defines clear polish requirements and acceptance criteria for Pipeline, Grafana, Dashboard/mobile, and delivery workflows.
- Implementation plan maps directly to touched files, tests, and operational checks.
- Known tooling constraints (notably codebase index connectivity) are explicit with fallback workflow.

## Risks
- Codebase semantic index is currently unavailable from this environment, reducing high-speed code traversal.
- UI state freshness can drift between SSE/poll-driven surfaces if status semantics diverge by page.
- Additional UX polish can regress on low-end mobile hardware if animation/render budgets are not guarded.

## Sources
- `ROADMAP.md:93`
- `ROADMAP.md:122`
- `docs/roadmap-reconciliation-2026-03-03.md:1`
- Command: `git log --since='2026-02-18' --pretty=format:'%h %ad %s' --date=short`
- `internal/api/handlers/handlers.go:84`
- `cmd/server/main.go:54`
- `cmd/server/main.go:59`
- `internal/api/handlers/prometheus.go:35`
- `internal/api/handlers/prometheus.go:56`
- `internal/metrics/store.go:115`
- `internal/metrics/pipeline_store.go:66`
- `web/src/components/Alerts/index.tsx:40`
- `web/src/components/Agents/HUDTab.tsx:128`
- `web/src/components/Models/InferenceTab.tsx:114`
- `web/src/components/Models/GPUMetricsPanel.tsx:181`
- `web/src/components/Dashboard/NodeResourcePanel.tsx:152`
