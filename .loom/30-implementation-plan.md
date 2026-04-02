# Implementation Plan — Operational Coherence And Surface Consolidation (2026-04-02)

## Scope
- Repository: `/Users/cblevins/workspace/services/flexdeck`
- Focus:
  - unify operational state/freshness semantics across Dashboard, FlexInfer, and Loom HUD
  - consolidate FlexInfer frontend data ownership around the shipped workbench architecture
  - add regression coverage and tracking hygiene for the highest-churn UX surfaces
- Out of scope:
  - new backend subsystems
  - broad redesign work
  - cross-repo API changes unless a repo-local consolidation task depends on them

## Starting Line
- `origin/main` now includes the deployment scheduling hardening from MR `!67`, so the next FlexInfer/Loom HUD slice can build on the current rollout baseline instead of carrying a pending GitOps side quest.
- Local branch/worktree cleanup is complete enough that the active repo state is reduced to:
  - clean `main`
  - one focused planning branch for the next phase
- Slices 1-3 are already implemented locally on `codex/flexinfer-loom-next-phase`, so the remaining execution risk is no longer architectural uncertainty; it is coverage, governance sync, and clean merge preparation.

## Objectives
1. Replace conflicting operator state vocabularies with one shared model.
2. Make the FlexInfer workbench the architectural center of gravity instead of one more parallel view.
3. Remove or neutralize orphaned legacy model surfaces so future work does not drift.
4. Add component/controller coverage where recent UI change velocity is highest.
5. Break the next round into small, shippable slices tied to current issue/governance reality.

## Milestones

### M1. Shared Operational State Primitives
- Status: implemented locally on `codex/flexinfer-loom-next-phase`
- Introduce a shared frontend state model that can represent loading, ready, partial, stale, offline, disabled, and fallback modes.
- Apply it to:
  - Dashboard summary cards
  - FlexInfer workbench section headers
  - Loom HUD feed/status messaging
- Keep detail strings additive so feature-flag and degraded-mode reasons remain visible.

### M2. FlexInfer Data Ownership Consolidation
- Status: implemented locally on `codex/flexinfer-loom-next-phase`
- Create a canonical data layer for the workbench/admin FlexInfer surfaces.
- Reuse normalized selectors in dashboard summaries where feasible.
- Decide whether legacy `InferenceTab` / `ProxyTab` / `PipelinesTab` are deleted or retained as thin adapters.

### M3. Confidence And Regression Safety
- Status: in progress
- Add component/controller tests for:
  - `AppLayout`
  - `FlexInfer/Workbench`
  - `Agents/HUDTab`
  - pipeline controller/status behavior where touched
- Keep a short manual smoke path for operator-critical journeys.

### M4. Governance / Backlog Decomposition
- Status: in progress
- Record the canonical repo ID and runtime assumptions in `.loom`.
- Decompose the enhancement round into issue/checklist slices under roadmap issue `#1`.
- Keep roadmap reconciliation notes synchronized with actual shipped slices.

## Prioritized Backlog

### Slice 1: Shared State Contract
- Status: implemented locally on `codex/flexinfer-loom-next-phase`
- Target files:
  - `web/src/lib/freshness.ts`
  - `web/src/components/Dashboard/statusSemantics.ts`
  - `web/src/components/Agents/hudDegradedMode.ts`
  - `web/src/components/Agents/HUDTab.tsx`
  - `web/src/components/FlexInfer/Workbench.tsx`
- Deliverables:
  - one shared operator-state vocabulary
  - consistent badge/label rendering rules
  - explicit mapping for disabled, partial, stale, and fallback states
- Why first:
  - it improves operator clarity immediately
  - it creates the contract the consolidation work can build around

### Slice 2: FlexInfer Shared Data Layer
- Status: implemented locally on `codex/flexinfer-loom-next-phase`
- Target files:
  - `web/src/components/FlexInfer/Workbench.tsx`
  - `web/src/components/Models/useModelsController.ts`
  - `web/src/lib/modelIntegration.ts`
  - `web/src/components/Dashboard/useDashboardSummaryState.ts`
  - new shared controller/store under `web/src/components/FlexInfer/` or `web/src/stores/`
- Deliverables:
  - one canonical owner for workbench operational fetches and selectors
  - reused model integration and proxy/router/catalog/cache selectors
  - fewer independent poll owners for the same FlexInfer facts
- Why second:
  - it addresses the highest remaining integration debt from the recent shipment

### Slice 3: Legacy Surface Retirement Or Adapter Pass
- Status: implemented locally on `codex/flexinfer-loom-next-phase`
- Target files:
  - `web/src/components/Models/InferenceTab.tsx`
  - `web/src/components/Models/ProxyTab.tsx`
  - `web/src/components/Models/PipelinesTab.tsx`
  - `web/src/components/Models/index.tsx`
  - `web/src/components/Admin/FlexInferTab.tsx`
- Deliverables:
  - either remove unused legacy model-era components or convert them into thin adapters over the new shared data layer
  - add inline architectural notes where compatibility wrappers are intentionally retained
- Why third:
  - it prevents the next few cycles from reintroducing duplicate behavior through old entry points

### Slice 4: Component And Controller Test Coverage
- Status: active next slice
- Target files:
  - `web/src/AppLayout.tsx`
  - `web/src/components/FlexInfer/Workbench.tsx`
  - `web/src/components/Agents/HUDTab.tsx`
  - `web/src/components/Pipeline/usePipelineController.ts`
  - new or adjacent `*.test.tsx` / `*.test.ts` files
- Deliverables:
  - coverage for mobile drawer dismissal and route-close behavior
  - workbench rendering assertions for ready/stale/error conditions
  - HUD degraded-mode render assertions
  - pipeline action-notice / polling assertions where touched
- Why fourth:
  - coverage is more effective once the shared state model and data ownership have stabilized

### Slice 5: Governance And Tracking
- Status: active this session
- Target files:
  - `.loom/00-index.md`
  - `.loom/00-mcp-inventory.md`
  - `.loom/10-research.md`
  - `.loom/20-product-spec.md`
  - `.loom/30-implementation-plan.md`
  - `.loom/40-decisions.md`
  - `.loom/50-worklog.md`
  - roadmap reconciliation note(s)
- Deliverables:
  - current plan/spec kept in sync
  - explicit issue/checklist decomposition under roadmap issue `#1`
  - canonical repo ID and runtime assumptions captured for future sessions

## Recommended Execution Order
1. Governance sync for Slices 1-3 so local progress is documented clearly.
2. Component coverage for `AppLayout`, `HUDTab`, and `Workbench`.
3. Broader validation and merge preparation once the coverage slice lands.

## Validation Plan
- Frontend:
  - targeted vitest coverage while Slice 4 is in flight:
    - `npm -C web run test -- --run src/components/FlexInfer/Workbench.test.tsx src/components/Agents/HUDTab.test.tsx src/components/Dashboard/useDashboardSummaryState.test.tsx src/lib/freshness.test.ts`
  - `npm -C web run -s test`
  - `npm -C web run -s lint`
  - `npm -C web run -s typecheck`
- Backend:
  - `go test ./...`
- Manual smoke:
  - verify Dashboard, `/flexinfer`, and `/loom-hud` present consistent state/freshness cues
  - verify hidden-tab pause/resume still works after any shared-state refactor
  - verify mobile drawer open/close behavior in `AppLayout`
  - verify admin and models FlexInfer surfaces still agree on shared data/state

## Risks And Mitigations
- Risk: a unified state model erases valuable nuance.
  - Mitigation: keep a detail/reason channel alongside the shared top-level state.
- Risk: consolidating FlexInfer data ownership regresses refresh timing.
  - Mitigation: migrate by selector group and preserve existing polling cadence until verified.
- Risk: removing legacy tabs breaks future reuse assumptions.
  - Mitigation: prefer thin adapters first when deletion risk is not yet justified.
- Risk: test coverage arrives too late to protect refactors.
  - Mitigation: land a small smoke-oriented test harness as soon as Slice 1 stabilizes.

## Open Questions
- Should pipeline adopt the same shared state contract in this exact cycle, or remain a follow-on after Workbench/HUD/Dashboard converge?
- Do we want to keep legacy adapters indefinitely for compatibility, or delete them in a later cleanup once no one relies on the old import paths?

## Sources
- `ROADMAP.md:93`
- `ROADMAP.md:122`
- `web/src/index.tsx:39`
- `web/src/index.tsx:40`
- `web/src/components/Models/index.tsx:12`
- `web/src/components/Admin/FlexInferTab.tsx:12`
- `web/src/components/Dashboard/statusSemantics.ts:1`
- `web/src/lib/freshness.ts:1`
- `web/src/components/Agents/hudDegradedMode.ts:1`
- `web/src/components/FlexInfer/Workbench.tsx:202`
- `web/src/components/FlexInfer/Workbench.tsx:218`
- `web/src/lib/flexinferSummary.ts:1`
- `web/src/stores/flexinferSurface.ts:1`
- `web/src/components/Models/LegacyWorkbenchAdapter.tsx:1`
- `web/src/components/Models/useModelsController.ts:61`
- `web/src/components/Models/useModelsController.ts:222`
- `web/src/components/Dashboard/useDashboardSummaryState.ts:201`
- `web/src/lib/modelIntegration.ts:97`
- Command: `rg -n "<InferenceTab|InferenceTab\\b|<ProxyTab|ProxyTab\\b|PipelinesTab\\b" web/src`
- Command: `rg --files web/src | rg '\\.test\\.(ts|tsx)$' | sort`
- Command: `git branch -vv && git worktree list --porcelain`
- Command: `git log --oneline --decorate -8 origin/main`
- `gitlab__get_merge_request(project="services/flexdeck", merge_request_iid=67)`
- `gitlab__list_issues(project="services/flexdeck", state="opened")`

## API Sync Slice (2026-03-31)

### Goal
Repair repo-local FlexInfer and Loom HUD contract drift against current upstream APIs without widening the scope into a larger UX refactor.

### Targeted Deliverables
1. Update `internal/k8s/models_crd.go` and `web/src/lib/types.ts` so FlexDeck preserves the current FlexInfer v1alpha2 `Model` fields it was dropping.
2. Expand `internal/api/handlers/flexinfer_proxy.go` normalized proxy metrics additively so newer upstream counters/gauges are visible to the UI and downstream selectors.
3. Keep Loom HUD route wiring unchanged, but align claim normalization/types with the current upstream expiry-based file-claim contract.
4. Add regression tests around CRD parsing, proxy metric parsing, and HUD claim normalization.

### File-Level Execution Plan
- Backend contract mirrors:
  - `internal/k8s/models_crd.go`
  - `internal/k8s/models_crd_test.go`
- Proxy metric normalization:
  - `internal/api/handlers/flexinfer_proxy.go`
  - `internal/api/handlers/flexinfer_proxy_test.go`
- Loom HUD normalization/type hygiene:
  - `internal/api/handlers/hud_contracts.go`
  - `internal/api/handlers/hud_proxy_test.go`
  - `web/src/lib/types.ts`

### Validation
- Run targeted backend tests first:
  - `go test ./internal/k8s ./internal/api/handlers/...`
- If type changes ripple into frontend compilation, follow with:
  - `npm -C web run -s typecheck`

### Non-Goals For This Slice
- no cross-repo upstream controller/HUD changes
- no route reshaping for Loom HUD
- no UI redesign work beyond type/contract compatibility
