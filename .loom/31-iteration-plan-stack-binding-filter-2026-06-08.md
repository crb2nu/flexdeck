# Iteration Plan — Phase 5 Slice C-5: Stack Cluster-Binding Filter (2026-06-08)

## Milestone

Phase 5 Local Stack Support → make the service-to-cluster binding data
(C-1..C-4) actionable in the Stack Explorer.

## Riskiest assumption + kill-test

Internal-only UI slice: it filters/summarizes binding data the backend already
produces and that was verified live in C-2..C-4. No new external-system
assumption, so per the spec-riskiest-assumption policy no live kill-test is
required. The correctness risk is purely in the filter predicates, covered by
unit tests.

## Scope

- In:
  - A "Cluster" filter on the Stack view: `All` / `Verified` / `Degraded` /
    `Inferred`, wired into the existing filter pipeline + reset + active-filter
    detection.
  - A "Cluster bound" summary tile (verified count, with degraded as the
    sub-line).
  - Pure `stackUtils` predicates: `isVerifiedBinding`, `isDegradedBinding`,
    `isInferredBinding`, `matchesBindingFilter`.
- Out:
  - Backend changes; new workload kinds; rollout-condition health; sorting
    changes (the existing readiness sort is kept).

## Acceptance criteria

- `Verified` shows services whose binding confidence is `verified`; `Degraded`
  shows verified services with a workload where `ready < desired` (`desired>0`);
  `Inferred` shows confidence `inferred`; `All` shows everything.
- The summary tile counts verified-bound services and degraded ones.
- The filter composes with the existing bucket/readiness/language filters and
  search; Reset clears it; it counts toward "active filters".
- `npm -C web run test` / `typecheck` / `lint` / `build` pass.

## Test plan

- `web/src/components/Stack/stackUtils.test.ts`: predicates and
  `matchesBindingFilter` across verified / degraded / inferred / library /
  no-binding repos.

## Next slice (handoff seed)

Add rollout-condition health (healthy vs progressing vs degraded) so a workload
mid-deploy is not flagged as broken; Job/CronJob coverage; image-label / Loom
HUD project-metadata signals.
