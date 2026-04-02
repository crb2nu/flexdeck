# Loom Context Pack

## Current Goal (2026-04-02)
- Continue the next post-integration enhancement round for FlexDeck after the recent FlexInfer and Loom HUD UX shipments.
- Prioritize operational coherence, shared data flows, and regression resistance over net-new subsystem scope.
- Keep `.loom/` and reconciliation notes aligned with the local implementation state while preserving `ROADMAP.md` as a merged-history artifact.

## Current Status Summary (2026-04-02)
- Phase 3 Deep FlexInfer & Loom Integration and Phase 3.5 contract hardening are already marked shipped in the roadmap, so this cycle remains a follow-through wave rather than a feature-introduction wave. (`ROADMAP.md:93`, `ROADMAP.md:122`)
- Recent delivery clustered around the new unified FlexInfer workbench (`7081375`) and the follow-up inference-surface polish (`5314331`). Commands: `git show --stat --summary 7081375`, `git show --stat --summary 5314331`
- Both `/flexinfer` and `/models` now route to the same FlexInfer surface, and admin reuses that workbench with `surface="admin"`. (`web/src/index.tsx:39`, `web/src/index.tsx:40`, `web/src/components/Models/index.tsx:12`, `web/src/components/Admin/FlexInferTab.tsx:12`)
- Slice 1 is implemented locally on `codex/flexinfer-loom-next-phase`: Dashboard, shared freshness helpers, and Loom HUD now treat `disabled` and `fallback` as first-class operator states instead of collapsing them into stale/offline wording. (`web/src/lib/freshness.ts:1`, `web/src/components/Dashboard/statusSemantics.ts:1`, `web/src/components/Agents/hudDegradedMode.ts:1`)
- Slice 2 is implemented locally on `codex/flexinfer-loom-next-phase`: FlexInfer summary ownership now lives in the shared `flexinferSummary` + `flexinferSurface` layer consumed by both Dashboard and Workbench. (`web/src/lib/flexinferSummary.ts:1`, `web/src/stores/flexinferSurface.ts:1`, `web/src/components/Dashboard/useDashboardSummaryState.ts:1`, `web/src/components/FlexInfer/Workbench.tsx:1`)
- Slice 3 is implemented locally on `codex/flexinfer-loom-next-phase`: legacy `InferenceTab` / `ProxyTab` / `PipelinesTab` no longer carry independent polling or API logic and instead delegate to the canonical workbench surface. (`web/src/components/Models/LegacyWorkbenchAdapter.tsx:1`, `web/src/components/Models/InferenceTab.tsx:1`, `web/src/components/Models/ProxyTab.tsx:1`, `web/src/components/Models/PipelinesTab.tsx:1`)
- Slice 4 remains the active gap: the new shared surface contracts are stabilized, but component-level regression coverage still needs to catch up around `AppLayout`, `HUDTab`, and the workbench surface.
- Codebase indexing is healthy for repo ID `services/flexdeck` (`1952` chunks) while the older alias `services-flexdeck` is stale and should not be used for this cycle. Commands: `codebase_memory__codebase_stats(repo_id="services/flexdeck")`, `codebase_memory__codebase_stats(repo_id="services-flexdeck")`
- Local branch/worktree hygiene is complete enough to execute from one focused next-phase branch instead of a backlog of superseded feature worktrees. Command: `git branch -vv && git worktree list --porcelain`
- `origin/main` already includes the scheduling fix from MR `!67`, so the current branch baseline includes the GitOps deployment affinity change before the FlexInfer/HUD follow-through work. Sources: `git log --oneline --decorate -8 origin/main`, `gitlab__get_merge_request(project="services/flexdeck", merge_request_iid=67)`

## Quick Links
- Workspace snapshot: `00-workspace-snapshot.md`
- MCP inventory: `00-mcp-inventory.md`
- Research: `10-research.md`
- Product spec: `20-product-spec.md`
- Implementation plan: `30-implementation-plan.md`
- Decisions: `40-decisions.md`
- Worklog: `50-worklog.md`
- Roadmap reconciliation note: `../docs/roadmap-reconciliation-2026-04-02.md`

## Success Criteria For This Cycle
- Dashboard, FlexInfer, and Loom HUD present a consistent state/freshness vocabulary for operators.
- FlexInfer data ownership is consolidated enough that the workbench, dashboard summaries, and any retained legacy views do not drift.
- High-churn UX surfaces gain component-level regression coverage rather than utility-only coverage.
- Planning/governance artifacts explicitly separate local branch progress from merged roadmap status so future sessions do not overstate what is shipped.

## Risks
- Remaining component coverage may lag behind the shared-surface refactor long enough for regressions to slip into mobile nav or HUD/workbench operator states.
- Local implementation status could be mistaken for merged roadmap status unless reconciliation notes stay synchronized with branch progress.

## Sources
- `ROADMAP.md:93`
- `ROADMAP.md:122`
- `web/src/index.tsx:39`
- `web/src/index.tsx:40`
- `web/src/components/Models/index.tsx:12`
- `web/src/components/Admin/FlexInferTab.tsx:12`
- `web/src/lib/polling.ts:23`
- `web/src/lib/freshness.ts:1`
- `web/src/components/Dashboard/statusSemantics.ts:1`
- `web/src/components/Agents/hudDegradedMode.ts:1`
- `web/src/lib/flexinferSummary.ts:1`
- `web/src/stores/flexinferSurface.ts:1`
- `web/src/components/Models/LegacyWorkbenchAdapter.tsx:1`
- Command: `git show --stat --summary 7081375`
- Command: `git show --stat --summary 5314331`
- Command: `git branch -vv && git worktree list --porcelain`
- Command: `git log --oneline --decorate -8 origin/main`
- `gitlab__get_merge_request(project="services/flexdeck", merge_request_iid=67)`
- `codebase_memory__codebase_stats(repo_id="services/flexdeck")`
- `codebase_memory__codebase_stats(repo_id="services-flexdeck")`
