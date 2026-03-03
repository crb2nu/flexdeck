# Research Brief — Post-Hardening Feature Improvements + Polish (2026-03-03)

## Problem Statement
Phase 3/3.5 reliability work is now largely shipped. The next planning gap is not missing major subsystems, but inconsistent polish across recently changed surfaces (Pipeline, Grafana, Dashboard/mobile, and CI delivery ergonomics).

## Method
- Refreshed workspace and MCP context pack state.
- Analyzed recent commit stream and touched-file hotspots.
- Sampled current implementation details in active UI surfaces for polish opportunities.

Commands used:
- `git log --since='2026-02-18' --pretty=format:'%h %ad %s' --date=short`
- `python - <<'PY' ... git log --name-only ... Counter ... PY`
- `nl -ba web/src/components/Pipeline/index.tsx | sed -n '1,260p'`
- `nl -ba web/src/components/Pipeline/CIPipelineViz.tsx | sed -n '1,320p'`
- `nl -ba web/src/components/Metrics/GrafanaDashboards.tsx | sed -n '1,320p'`
- `nl -ba web/src/components/Dashboard/index.tsx | sed -n '1,300p'`
- `rg -n "TODO|FIXME|XXX|HACK" internal web/src`

## Facts Found

### Delivery Baseline (Recent)
- Recent commits show concentrated fixes/enhancements in:
  - Pipeline reactivity, stage ordering, and deeper history.
  - Grafana auth fallback + hosted-route behavior + panel visibility polish.
  - Dashboard signal improvements (node resource panel, LiteLLM throughput on CRD cards).
  - Mobile overlay/layout refinements.
  - CI gate hardening and mirrored toolchain images.
- Roadmap marks Phase 3.5 reliability items complete and Phase 4 as partial/feature-gated.

### Hotspots By Change Frequency
Top files since 2026-02-18 include:
- `web/src/components/Dashboard/index.tsx` (8 touches)
- `internal/api/handlers/grafana.go` (6 touches)
- `web/src/AppLayout.tsx` (6 touches)
- `web/src/components/Pipeline/index.tsx` (3 touches)
- `web/src/components/Metrics/GrafanaDashboards.tsx` (4 touches)

### Implementation Signals For Polish
- Pipeline page already has active polling logic and action refresh scheduling, but state clarity can still improve when toggling between overview/detail and active/inactive pipelines (`web/src/components/Pipeline/index.tsx:30`, `web/src/components/Pipeline/index.tsx:134`).
- CI visualization keeps a demo fallback model and optimistic job actions; follow-up polish should prioritize explicit “live vs demo” affordances and action feedback semantics (`web/src/components/Pipeline/CIPipelineViz.tsx:67`, `web/src/components/Pipeline/CIPipelineViz.tsx:194`).
- Grafana dashboard parser now performs non-trivial query normalization and templating fallback; this is a strong integration baseline but benefits from clearer resolution diagnostics and test reinforcement (`web/src/components/Metrics/GrafanaDashboards.tsx:179`, `web/src/components/Metrics/GrafanaDashboards.tsx:221`).
- Dashboard aggregates three polling tracks (models, inference, agent activity) with mixed feature-gated pathways; polish should focus on unified freshness/error semantics and reduced status ambiguity (`web/src/components/Dashboard/index.tsx:176`, `web/src/components/Dashboard/index.tsx:120`).

## Gap Summary (What Is Still Missing)
1. Consistent freshness/status UX across high-frequency panels (Pipeline, Dashboard cards, Grafana live cards).
2. Stronger operator affordances around “data confidence” states (live, stale, fallback, demo, offline, partial).
3. End-to-end verification loop for UI polish changes (frontend tests + targeted backend checks + smoke flow).
4. Coordinated planning rhythm tying roadmap reconciliations to real code deltas (latest reconciliation reported no planning deltas while delivery code kept moving).

## Assumptions
- Current objective is to improve reliability and operator UX without introducing new backend subsystems.
- Changes should remain FlexDeck-local and leverage existing APIs/handlers.

## Open Questions
1. Should pipeline “overview” remain primarily poll-driven, or move to event-driven updates where available?
2. Which status taxonomy should be canonical across UI surfaces: `offline|partial|stale|fallback|demo|ready`?
3. Is a single shared “data freshness” component acceptable across Pipeline, Dashboard pulse cards, and Grafana panels?

## Key Conclusions
1. Next wave should be a focused polish release, not a scope-expansion release.
2. Pipeline + Grafana + Dashboard status coherence is the highest leverage UX reliability investment.
3. Planning artifacts should explicitly include a testing/ship loop and troubleshooting loop to prevent drift after fast fix cycles.

## Sources
- `ROADMAP.md:93`
- `ROADMAP.md:122`
- `docs/roadmap-reconciliation-2026-03-03.md:1`
- `web/src/components/Pipeline/index.tsx:30`
- `web/src/components/Pipeline/index.tsx:134`
- `web/src/components/Pipeline/CIPipelineViz.tsx:67`
- `web/src/components/Pipeline/CIPipelineViz.tsx:194`
- `web/src/components/Metrics/GrafanaDashboards.tsx:179`
- `web/src/components/Metrics/GrafanaDashboards.tsx:221`
- `web/src/components/Dashboard/index.tsx:120`
- `web/src/components/Dashboard/index.tsx:176`
- Command: `git log --since='2026-02-18' --pretty=format:'%h %ad %s' --date=short`
- Command: `python - <<'PY' ... git log --name-only ... Counter ... PY`
