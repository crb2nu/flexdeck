# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 5 Local Stack Support.
- Slice: Service-to-Cluster Binding (C-5, Stack Cluster filter).
- Status: complete locally.

## What Landed

- A "Cluster" filter on the Stack Explorer: `Any cluster` / `Verified` /
  `Degraded` / `Inferred`, composing with the existing
  bucket/readiness/language/search filters and Reset.
- A "Cluster bound" summary tile (verified count; sub-line shows the degraded
  count and turns warn-toned when any service is degraded).
- Pure, unit-tested predicates in `stackUtils`: `isVerifiedBinding`,
  `isInferredBinding`, `isDegradedBinding` (verified service with
  `ready < desired`), and `matchesBindingFilter`.
- Frontend-only; no backend change. Internal UI over binding data already
  produced by C-1..C-4 and verified live, so no live kill-test required.
- Key files:
  - `web/src/components/Stack/stackUtils.ts`
  - `web/src/components/Stack/index.tsx`
  - `web/src/components/Stack/stackUtils.test.ts`
  - `ROADMAP.md`, `.loom/40-decisions.md`, `.loom/31-iteration-plan-stack-binding-filter-2026-06-08.md`

## Validation Results

- `npm -C web run test` passed: 51 files, 260 tests (14 in `stackUtils.test.ts`).
- `npm -C web run typecheck` / `lint` / `build` passed.
- The component render test (`index.test.tsx`) still passes with the added
  filter row + summary tile.

## What Is Still Open

- Not visually screenshot-verified in a live browser (requires WORKSPACE_DIR +
  server); the change is additive and the render test passes. A quick manual
  check of the `/stack` layout (6-tile summary grid, the new "Cluster" filter
  row) is the one remaining confidence step.
- "Degraded" uses replica counts only; a workload mid-rollout can briefly read
  as degraded until the rollout-condition health slice lands.

## Next Actions

1. Add rollout-condition health (healthy / progressing / degraded) so an
   in-progress deploy is not flagged as broken; Job/CronJob coverage.
2. Fold in image-label and Loom HUD project-metadata signals.
3. Consider a health-first sort option once rollout status exists.

## Context Links

- `.loom/31-iteration-plan-stack-binding-filter-2026-06-08.md`
- `.loom/42-slice-handoff-stack-statefulset-binding-2026-06-08.md`
- `.loom/40-decisions.md`
