# Implementation Plan — Feature Improvements And Polish (2026-03)

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
