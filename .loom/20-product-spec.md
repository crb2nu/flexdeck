# Product Spec — Post-Coherence Execution Reset (2026-04-03)

## Summary
This planning branch is no longer defining the original operational-coherence wave. That wave has already landed on `main`. The purpose of this spec is to reset the branch into a truthful next-step artifact: preserve the still-useful context from the reopened stash, clearly archive completed work, and define how we choose and execute the next live slice without dragging stale assumptions or build artifacts forward.

## Goals
1. Convert the reopened March planning bundle into a current April execution baseline.
2. Preserve useful context such as canonical repo-ID/runtime guidance and upstream contract-awareness.
3. Select the next implementation slice from live evidence rather than from already-merged backlog items.
4. Keep future execution work cleanly separated from unrelated binary artifacts or accidental restored diffs.

## Non-Goals
- Re-planning the already-merged operator-state and pipeline state-alignment work as if it were still pending.
- Treating the March API-sync addendum as mandatory new work without fresh drift evidence.
- Mixing build artifacts into planning commits.
- Broad roadmap rewriting that obscures the distinction between merged history and branch-local planning.

## Epic 1: Planning Baseline Reset (Priority 1)

### Requirements
- Rewrite the reopened `.loom` docs so completed March/April work is described as completed, not pending.
- Preserve the canonical `services/flexdeck` repo-ID guidance and the stale `services-flexdeck` warning.
- Mark the inventory snapshot as carry-forward context unless a fresh runtime census is explicitly re-run.

### Acceptance Criteria
- A new session can read `.loom/` and immediately tell which work is already merged versus what remains speculative.
- The planning docs no longer invite re-implementation of finished FlexInfer/HUD/Pipeline operator-state work.

## Epic 2: Live Gap Re-Qualification (Priority 1)

### Requirements
- Audit the remaining high-churn orchestration surfaces for direct confidence gaps.
- Use current evidence, not March assumptions, to determine the next slice.
- Treat reopened binary/artifact diffs as separate cleanup decisions, not implicit scope.

### Candidate Focus Areas
- `web/src/components/Pipeline/usePipelineController.ts`
- `web/src/components/Dashboard/index.tsx`
- `web/src/components/Dashboard/TopologyGraph.tsx`
- `web/src/components/Agents/HUDActivityFeed.tsx`

### Acceptance Criteria
- The next implementation target is named explicitly with file-level ownership.
- The rationale is anchored in current repo evidence.

## Epic 3: First Follow-On Slice Selection (Priority 2)

### Preferred First Slice
Controller and orchestration confidence:
- add direct tests for pipeline controller polling/action lifecycle and fallback behavior
- add dashboard-shell assertions for summary/topology orchestration where multiple subsystems converge

### Alternative Slice
Legacy adapter end-state:
- decide whether `InferenceTab`, `ProxyTab`, and `PipelinesTab` remain permanent compatibility shells or are ready for deletion in a dedicated cleanup pass

### Acceptance Criteria
- The branch ends with one clearly recommended first implementation slice, including validation steps.
- Future execution can start from a clean branch without redoing this planning triage.

## Cross-Cutting Rules
- Prefer truthful planning over optimistic backlog carry-forward.
- Preserve historical context, but label it as historical context.
- Keep planning branches scoped to planning documents unless the user explicitly asks for mixed execution work.
- Avoid bundling `server` or other generated artifacts into planning-oriented commits.

## Validation
- Review the planning diff with `git diff --stat` and spot-check the updated `.loom` documents.
- If this branch is later converted into an execution branch, restage only the intended planning files.

## Sources
- `git diff --stat`
- `git log --oneline --decorate -8`
- `.loom/00-index.md`
- `.loom/10-research.md`
- `.loom/30-implementation-plan.md`
- `.loom/50-worklog.md`
