# Product Spec — Feature Improvements And Polish Wave (2026-03)

## Summary
Define a focused polish release that builds on recent fixes already shipped in Pipeline, Grafana, Dashboard/model surfaces, mobile behavior, and CI reliability. Scope is FlexDeck-only with no new subsystem introduction.

## Goals
1. Improve operator confidence by making data freshness/state semantics explicit and consistent.
2. Reduce UI ambiguity in high-churn surfaces (Pipeline, Grafana panels, Dashboard pulse cards).
3. Preserve recent reliability gains while raising regression resistance for polish-level changes.

## Non-Goals
- New major subsystems or cross-repo feature launches.
- Replacing existing API contracts that were hardened in Phase 3.5.
- Large architectural refactors unrelated to current high-touch surfaces.

## Epic 1: Pipeline UX Confidence Polish (Priority 1)

### Requirements
- Introduce explicit pipeline data-state affordances:
  - `live`
  - `stale`
  - `static/demo`
  - `offline`
- Improve action lifecycle feedback for retry/cancel/play:
  - in-flight indication
  - post-action refresh confirmation
  - action-failed recovery hint
- Clarify overview/detail synchronization so active pipeline status does not appear inconsistent during polling transitions.

### Acceptance Criteria
- Operators can distinguish live vs static/demo pipelines without opening dev tools.
- Pipeline actions always return visible feedback within one interaction cycle.
- Polling pause/resume rules are visible and test-covered for key transitions (selected job open/close, active pipeline idle/run states).

## Epic 2: Grafana Integration Operability Polish (Priority 1)

### Requirements
- Surface query resolution status (`direct|templated|fallback`) in panel cards.
- Improve fallback observability when templated variables cannot be fully resolved.
- Standardize error messaging for auth failures and non-PromQL panel targets.

### Acceptance Criteria
- Panel cards with fallback expression substitution are clearly marked.
- Operators can differentiate “unsupported panel query” from “query failed.”
- Expanded panel flow remains readable on desktop and mobile breakpoints.

## Epic 3: Dashboard And Mobile Signal Clarity (Priority 2)

### Requirements
- Unify status vocabulary across pulse cards and observability widgets:
  - `ready`
  - `partial`
  - `stale`
  - `offline`
- Harmonize polling freshness indicators for models, inference, and agent activity cards.
- Apply final mobile polish pass for overlay control friction and compact-layout readability on sub-375px viewports.

### Acceptance Criteria
- No dashboard card reports ambiguous “error/offline” states when feature flags intentionally disable data sources.
- Mobile overlays can be opened/dismissed predictably on touch devices without layout clipping.
- Existing mobile remediations remain intact across supported breakpoints.

## Epic 4: Ship-Loop And Governance Polish (Priority 2)

### Requirements
- Keep roadmap/spec/worklog synchronized with actual code delta cadence.
- Add a concise regression checklist for polish releases:
  - frontend tests
  - targeted backend tests
  - CI lint/typecheck sanity
  - manual smoke for pipeline + grafana + dashboard
- Document temporary codebase-index outage and fallback workflow for planning/triage.

### Acceptance Criteria
- `.loom` plan/worklog include explicit verification gates and evidence links.
- Reconciliation updates no longer miss active code-only deltas in high-touch UI files.

## Cross-Cutting UX Rules
- Prefer additive UI indicators over silent behavior changes.
- Keep existing sci-fi visual language and Tailwind token patterns.
- Avoid introducing heavy per-frame allocations in visualization paths.

## Sources
- `ROADMAP.md:93`
- `ROADMAP.md:122`
- `docs/roadmap-reconciliation-2026-03-03.md:1`
- `web/src/components/Pipeline/index.tsx:30`
- `web/src/components/Pipeline/CIPipelineViz.tsx:67`
- `web/src/components/Metrics/GrafanaDashboards.tsx:221`
- `web/src/components/Dashboard/index.tsx:176`
- `docs/tech-debt/2026-02-24-mobile-implementation-report.md:1`
- Command: `git log --since='2026-02-18' --pretty=format:'%h %ad %s' --date=short`
