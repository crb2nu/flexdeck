# Implementation Plan — Post-Coherence Follow-Through (2026-04-03)

## Scope
- Repository: `/Users/cblevins/workspace/services/flexdeck`
- Planning branch: `codex/reopen-planning-baseline`
- Focus:
  - reset the reopened planning stash into a current baseline
  - define the next evidence-backed implementation slice
  - prevent stale planning artifacts from re-entering active backlog as if they were unfinished work
- Out of scope for this branch:
  - shipping new frontend/backend feature code
  - redoing already-merged operator-state or pipeline-alignment work
  - treating binary artifacts as part of the planning deliverable

## Starting Line
- `main` is already at `67d2cd6` and includes:
  - FlexInfer/Loom operator-surface unification
  - pipeline detail state alignment
  - pipeline trends/history state alignment
- The reopened stash preserved older planning docs plus two non-plan diffs:
  - `ROADMAP.md` small issue-link change
  - `server` binary artifact
- The old March planning bundle is now better treated as archived rationale than as an active execution queue.

## Objectives
1. Rewrite the reopened planning docs so they accurately describe the current merged baseline.
2. Identify the next live execution slice from present evidence.
3. Keep the resulting branch cleanly scoped for future handoff or fresh-branch execution.

## Milestones

### M1. Baseline Reset
- Status: active in this branch
- Rewrite `.loom/00-index.md`, `.loom/00-mcp-inventory.md`, `.loom/10-research.md`, and `.loom/20-product-spec.md` around the current April 3 state.
- Record that the March operator-coherence plan is complete and should no longer be treated as pending work.

### M2. Next-Slice Qualification
- Status: active in this branch
- Use current repo evidence to choose the next implementation candidate.
- Prefer slices that improve confidence and reduce drift risk rather than reopening already-solved architectural work.

### M3. Handoff-Ready Execution Recommendation
- Status: pending
- Produce one recommended first implementation slice plus validation steps so a fresh execution branch can pick it up immediately.

## Prioritized Backlog

### Slice 1: Pipeline Controller Confidence
- Status: recommended first implementation slice
- Why first:
  - pipeline UX was just stabilized visually, so controller-level confidence is now the highest-leverage follow-through
  - `web/src/components/Pipeline/usePipelineController.ts` still lacks direct adjacent test coverage in the current inventory
- Target files:
  - `web/src/components/Pipeline/usePipelineController.ts`
  - `web/src/components/Pipeline/index.test.tsx`
  - new controller-focused test file adjacent to the hook if needed
- Deliverables:
  - direct tests for stale timing behavior
  - batch-fetch versus fallback path coverage
  - action notice / retry / cancel / play lifecycle assertions where practical
- Validation:
  - `npm -C web run test -- --run src/components/Pipeline/index.test.tsx src/components/Pipeline/utils.test.ts`
  - `npm -C web run typecheck`

### Slice 2: Dashboard Shell Confidence
- Status: next candidate
- Why next:
  - Dashboard remains a subsystem convergence surface and still lacks direct coverage at the page-shell level
- Target files:
  - `web/src/components/Dashboard/index.tsx`
  - `web/src/components/Dashboard/TopologyGraph.tsx`
  - new or adjacent `*.test.tsx` files
- Deliverables:
  - summary widget orchestration assertions
  - empty/error/loading state checks where dashboard sections multiplex multiple sources
  - topology shell smoke coverage that fails loudly if shared summary contracts regress
- Validation:
  - targeted vitest run for the new dashboard tests
  - `npm -C web run typecheck`

### Slice 3: Legacy Adapter End-State
- Status: follow-on cleanup candidate
- Why later:
  - adapter retention is already safe; deleting them is valuable, but lower urgency than confidence loops around live orchestration paths
- Target files:
  - `web/src/components/Models/InferenceTab.tsx`
  - `web/src/components/Models/ProxyTab.tsx`
  - `web/src/components/Models/PipelinesTab.tsx`
  - `web/src/components/Models/LegacyWorkbenchAdapter.tsx`
- Deliverables:
  - decide whether adapters stay intentionally or get removed in a dedicated cleanup pass
  - if retained, document the permanence more explicitly
  - if removed, verify no import path still depends on them

### Slice 4: Planning-Branch Hygiene
- Status: active follow-through for this branch
- Target files:
  - `.loom/*`
  - optionally `ROADMAP.md` if the issue-link tweak is intentionally kept
- Deliverables:
  - refreshed planning docs
  - explicit note that `server` is not part of the planning deliverable
  - clear handoff for the next execution branch

## Recommended Execution Order
1. Finish the planning baseline reset in `.loom/`.
2. Cut a fresh integration branch for the confidence wave.
3. Execute the confidence slices in parallel where file ownership is disjoint.
4. Merge the slices in dependency order and then re-evaluate legacy adapter cleanup.

## Parallel Slice Ship Plan (2026-04-04)

### Shared Contract Before Spawning
- Keep this planning branch doc-only; implementation work should happen on fresh slice branches.
- Treat `web/src/components/Pipeline/usePipelineController.ts` and `web/src/components/Dashboard/index.tsx` as separate ownership zones.
- Avoid changing shared API contracts or common utilities unless strictly necessary for testability.
- If a helper must be extracted for tests, the slice that introduces it owns the refactor and must keep the public behavior unchanged.

### Slice 1: Pipeline Controller Confidence
- Goal:
  - add direct controller coverage for the highest-churn pipeline orchestration logic
- Files:
  - `web/src/components/Pipeline/usePipelineController.ts`
  - `web/src/components/Pipeline/index.test.tsx`
  - optional adjacent controller test file
- Branch:
  - `feat/pipeline-controller-confidence`
- Acceptance criteria:
  - stale timing behavior is asserted directly
  - batch fetch success and fallback-to-individual fetch are covered
  - retry/cancel/play notice lifecycle is covered where practical without overspecifying UI copy
- Test strategy:
  - `npm -C web run test -- --run src/components/Pipeline/index.test.tsx src/components/Pipeline/utils.test.ts`
  - `npm -C web run typecheck`
- Complexity:
  - medium

### Slice 2: Dashboard Shell Confidence
- Goal:
  - add shell-level regression coverage for the dashboard’s multi-source summary and topology orchestration
- Files:
  - `web/src/components/Dashboard/index.tsx`
  - `web/src/components/Dashboard/TopologyGraph.tsx`
  - new or adjacent dashboard test file(s)
- Branch:
  - `feat/dashboard-shell-confidence`
- Acceptance criteria:
  - dashboard summary widgets are asserted against the existing summary-state contract
  - empty, loading, or degraded state transitions are covered for at least one multiplexed surface
  - topology shell smoke coverage fails loudly if summary/topology wiring regresses
- Test strategy:
  - targeted vitest run for dashboard tests
  - `npm -C web run typecheck`
- Complexity:
  - medium

### Slice 3: Planning And Integration Guardrails
- Goal:
  - keep the planning branch handoff-ready while the implementation slices execute elsewhere
- Files:
  - `.loom/30-implementation-plan.md`
  - `.loom/50-worklog.md`
  - optionally `ROADMAP.md` only if intentionally retained
- Branch:
  - `codex/reopen-planning-baseline`
- Acceptance criteria:
  - slice ownership, branch names, and merge order are written down
  - planning artifacts clearly distinguish planning-only work from implementation branches
  - binary artifacts remain explicitly out of scope
- Test strategy:
  - `git diff --stat`
  - spot-check `.loom/30-implementation-plan.md` and `.loom/50-worklog.md`
- Complexity:
  - low

## Integration Order
1. `feat/pipeline-controller-confidence`
2. `feat/dashboard-shell-confidence`
3. Re-run frontend validation on the combined branch

## Merge Strategy
- Create integration branch `feat/confidence-wave` from current `main`.
- Cherry-pick or merge Slice 1 first because it exercises the highest-risk orchestration path and may establish helper patterns for the dashboard tests.
- Merge Slice 2 second; resolve only test harness or shared mock drift if it appears.
- Keep planning/doc commits off the integration branch unless they are intentionally part of the final MR.

## Validation Plan
- Planning branch review:
  - `git diff --stat`
  - spot-check `.loom/00-index.md`, `.loom/10-research.md`, `.loom/20-product-spec.md`, `.loom/30-implementation-plan.md`
- Future execution branch validation:
  - targeted vitest for touched surfaces
  - `npm -C web run typecheck`
  - broader `npm -C web run test` / `npm -C web run lint` once a code slice exists

## Risks And Mitigations
- Risk: we overfit the next plan to historical March concerns.
  - Mitigation: qualify every new slice against current repo evidence before implementation.
- Risk: planning commits accidentally include binary artifacts.
  - Mitigation: treat `server` as out of scope and stage only the intended planning files.
- Risk: adapter cleanup steals focus from more valuable live-surface confidence work.
  - Mitigation: keep adapter deletion behind the pipeline/dashboard confidence slices.

## RALPH Addendum: FlexInfer Route-Stable Navigation (2026-05-17)

- Roadmap milestone: Phase 3 Deep FlexInfer integration, workbench operator-surface stability.
- Spec section(s): FlexInfer section navigation and shared sidebar primitive.
- Prior decisions preserved: keep `/flexinfer` as the primary route while retaining `/models` as a compatibility route; keep the workbench as a tabbed shell with one visible operator lane.
- Scope in: router search-param section state, link-capable `OperationsSidebarNav`, focused workbench and primitive regression tests.
- Scope out: broad router migration, visual redesign, `/models` removal, unrelated legacy model surface cleanup.
- Acceptance criteria: section changes preserve the `/flexinfer` route, active section loads from `?section=`, old scroll coupling does not run on lane switches, and the sidebar primitive still supports button-mode consumers.
- Validation: focused Vitest coverage passed, the full frontend test suite passed, `npm -C web run typecheck` passed, `npm -C web run lint` passed with 8 pre-existing warnings outside this slice, and a browser smoke confirmed direct-load/click behavior on the FlexInfer section route.

## Sources
- `git diff --stat`
- `git log --oneline --decorate -8`
- `.loom/10-research.md`
- `rg --files web/src | rg '\.test\.(ts|tsx)$' | sort | rg 'AppLayout|Dashboard|FlexInfer|Agents|Pipeline|Models'`
