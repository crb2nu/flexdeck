# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 5 Local Stack Support.
- Slice: Service-to-Cluster Binding (C-7, health-first sort).
- Status: complete locally.

## What Landed

- The Stack list now sorts by cluster-health urgency first: `degraded` >
  `progressing` > everything else, then the existing scanner-readiness score,
  then bucket/name. Unhealthy services surface to the top automatically — even
  without applying the Cluster filter.
- Pure `stackUtils` helpers: `bindingSeverity(repo)` and
  `compareByBindingConcern(left, right)`; the list `.sort()` uses the latter.
- Frontend-only; no backend change. Internal UI over binding data already
  produced (C-6), so no live kill-test required.
- Key files:
  - `web/src/components/Stack/stackUtils.ts`
  - `web/src/components/Stack/index.tsx`
  - `web/src/components/Stack/stackUtils.test.ts`
  - `ROADMAP.md`, `.loom/40-decisions.md`, `.loom/31-iteration-plan-stack-health-sort-2026-06-08.md`

## Validation Results

- `npm -C web run test` passed: 51 files, 263 tests (17 in `stackUtils.test.ts`).
- `npm -C web run typecheck` / `lint` / `build` passed.
- The component render test (`index.test.tsx`) still passes.
- Not browser-screenshotted (prod pod has no `WORKSPACE_DIR`); the change is a
  pure reordering and the render + comparator tests cover it.

## Deferred This Cycle

- **Pod-level degraded reasons** (CrashLoopBackOff / ImagePullBackOff /
  OOMKilled) — the queued slice. A live scan found no currently-degraded
  *service* workload to validate reason extraction against (only completed Jobs
  and an already-recovered OOM on a non-service pod), and it is the
  highest-complexity option. Returned to the backlog for when a workload is
  actually degraded.

## Next Actions

1. When a service workload is degraded, add pod-level reasons from pod
   statuses/events so the card explains *why*.
2. Add Job/CronJob coverage.
3. Fold in image-label and Loom HUD project-metadata signals.

## Context Links

- `.loom/31-iteration-plan-stack-health-sort-2026-06-08.md`
- `.loom/42-slice-handoff-stack-rollout-health-2026-06-08.md`
- `.loom/40-decisions.md`
