# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 5 Local Stack Support.
- Slice: Service-to-Cluster Binding (C-6, rollout-condition health).
- Status: complete locally.

## What Landed

- Each Flux-managed workload is classified `healthy` / `progressing` /
  `degraded`; the source's `Workload.Status` is the worst of its workloads.
  - `progressing`: a new revision is rolling out (`updatedReplicas < desired`).
  - `degraded`: rolled out but missing ready replicas, or a Deployment with
    `Progressing`/`Available` = `False` (ProgressDeadlineExceeded / unavailable).
  - `healthy`: fully rolled out and ready (or scaled to zero).
- Frontend: the workload chip is now 3-color (ok/warn/error) by status, and the
  Stack "Degraded" filter is status-aware — an in-flight rollout is no longer
  flagged degraded. Falls back to the replica comparison for older payloads.
- Key files:
  - `internal/workspace/binding.go` (`Workload.Status` + `Workload{Healthy,Progressing,Degraded}` constants)
  - `internal/api/handlers/workspace_binding.go` (`rolloutStatus`, `deploymentRolloutStatus`, `worseRolloutStatus`)
  - `internal/api/handlers/workspace_binding_test.go`
  - `web/src/lib/api/workspace.ts`, `web/src/components/Stack/stackUtils.ts`, `web/src/components/Stack/index.tsx` (+ tests)
  - `ROADMAP.md`, `.loom/40-decisions.md`, `.loom/31-iteration-plan-stack-rollout-health-2026-06-08.md`

## Validation Results

- `go test ./...` passed (all packages, incl. `TestRolloutStatus`,
  `TestDeploymentRolloutStatusUsesConditions`, `TestWorkloadStatusAggregatesWorst`).
- `npm -C web run test` (261 tests), `typecheck`, `lint`, `build` passed.
- Kill-test (live): confirmed the status fields exist and the healthy path
  (flexdeck `Progressing=NewReplicaSetAvailable`+`Available=True`,
  `updated==ready==desired`).
- Live end-to-end probe (real cluster, 198 deploy / 27 sts / 26 ds): classified
  15 services → 14 healthy + **1 genuinely degraded (`smarthome`)**. Both healthy
  and degraded paths are live-confirmed; the `progressing` path is unit-tested
  only (nothing was mid-rollout during validation).

## What Is Still Open

- No pod-level reason (crashloop / imagepull / OOM) for a degraded workload —
  only the rollout/replica classification.
- StatefulSets/DaemonSets have no Progressing/Available condition, so a "stuck"
  StatefulSet is detected only via the replica comparison.

## Next Actions

1. Surface pod-level reasons for degraded workloads (crashloop/imagepull) from
   pod statuses/events.
2. Add Job/CronJob coverage.
3. Fold in image-label and Loom HUD project-metadata signals.

## Context Links

- `.loom/31-iteration-plan-stack-rollout-health-2026-06-08.md`
- `.loom/42-slice-handoff-stack-binding-filter-2026-06-08.md`
- `.loom/40-decisions.md`
