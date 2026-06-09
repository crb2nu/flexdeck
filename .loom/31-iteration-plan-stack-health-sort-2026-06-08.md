# Iteration Plan — Phase 5 Slice C-7: Health-First Stack Sort (2026-06-08)

## Milestone

Phase 5 Local Stack Support → complete the binding triage UX
(classify → filter → **sort**) so unhealthy services surface first.

## Riskiest assumption + kill-test

Internal-only UI slice over binding data the backend already produces (C-6).
No new external-system assumption, so per the spec-riskiest-assumption policy no
live kill-test is required; correctness lives in the comparator unit tests.

Context: the originally-queued slice (pod-level degraded *reasons*) was
deferred — a live scan found no currently-degraded service workload to validate
reason extraction against, and it is the highest-complexity option (pod listing
+ owner/name matching). It returns to the backlog for when a workload is broken.

## Scope

- In:
  - `bindingSeverity(repo)` — `degraded`=2, `progressing`=1, else 0.
  - `compareByBindingConcern(left, right)` — orders by binding severity, then the
    existing readiness score, then bucket, then name. The Stack list uses it as
    its primary sort so degraded → progressing → readiness-flagged → clean.
- Out:
  - Pod-level reasons; Job/CronJob coverage; backend changes; a user-facing sort
    toggle (health-first is the sensible default for a triage dashboard).

## Acceptance criteria

- A degraded service sorts above a progressing one, which sorts above healthy /
  readiness-flagged ones; ties fall back to the existing readiness/bucket/name
  ordering.
- Libraries and bindings without workloads keep severity 0 (sorted by the
  existing keys).
- `npm -C web run test` / `typecheck` / `lint` / `build` pass.

## Test plan

- `web/src/components/Stack/stackUtils.test.ts`: `bindingSeverity` per status and
  `compareByBindingConcern` ordering (degraded-first, progressing-second,
  readiness tiebreak, name tiebreak).

## Next slice (handoff seed)

When a service workload is actually degraded, add pod-level reasons
(CrashLoopBackOff / ImagePullBackOff / OOMKilled) so the card explains *why*;
then Job/CronJob coverage and image-label / Loom HUD signals.
