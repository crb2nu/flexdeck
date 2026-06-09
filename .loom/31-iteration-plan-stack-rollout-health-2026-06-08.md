# Iteration Plan — Phase 5 Slice C-6: Rollout-Condition Health (2026-06-08)

## Milestone

Phase 5 Local Stack Support → Service-to-Cluster Binding (distinguish a healthy
rollout-in-progress from a genuinely degraded workload).

## Riskiest assumption + kill-test

**Load-bearing assumption**: Deployment/StatefulSet/DaemonSet status fields
reliably distinguish a rollout *in progress* (`progressing`) from a *stuck or
unhealthy* workload (`degraded`), so the binding's degraded signal stops
false-flagging in-flight deploys.

**Kill test (run live BEFORE building, 2026-06-08)**:
- A live Deployment (`flexdeck`) exposes `Progressing=True (NewReplicaSetAvailable)`
  + `Available=True` with `updatedReplicas==readyReplicas==spec.replicas` →
  classifies `healthy`. The stuck case is `Progressing=False
  (ProgressDeadlineExceeded)` / `Available=False`.
- A live StatefulSet (`home-assistant`) exposes `currentRevision==updateRevision`
  and `updatedReplicas==readyReplicas==spec.replicas` → `healthy`.
- **Limitation**: the cluster is entirely healthy right now (0 not-fully-ready
  Flux workloads), so the `progressing`/`degraded` branches are validated by
  unit tests over the documented field semantics, not by a live broken
  workload. The healthy path and field presence are live-confirmed.

**Failure mode if wrong**: an in-progress deploy reads as `degraded` (false
alarm) or a stuck workload reads as `progressing` (missed alarm).

**Status**: passed for the healthy path + field presence (2026-06-08);
progressing/degraded paths unit-tested.

## Classification (per workload, then worst-of per source)

- Deployment: `Progressing=False` or `Available=False` → degraded; else
  `updatedReplicas < desired` → progressing; else `readyReplicas < desired` →
  degraded; else healthy.
- StatefulSet: `updatedReplicas < desired` → progressing; else
  `readyReplicas < desired` → degraded; else healthy.
- DaemonSet: `updatedNumberScheduled < desired` → progressing; else
  `numberReady < desired` → degraded; else healthy.
- Aggregate per source = worst of its workloads (degraded > progressing > healthy).

## Scope

- In:
  - `Workload.Status` (`healthy`/`progressing`/`degraded`); per-kind classifier
    in the handler; worst-of aggregation.
  - Frontend: 3-color workload chip (ok/warn/error); `isDegradedBinding` becomes
    status-aware (a progressing workload is no longer "degraded").
- Out:
  - Pod/event-level reasons, crashloop detection, Jobs/CronJobs, image-label /
    Loom HUD signals.

## Acceptance criteria

- A workload mid-rollout (`updated < desired`, not stuck) classifies
  `progressing`, not `degraded`; a stuck Deployment classifies `degraded`.
- The Stack "Degraded" filter and tile count only genuinely-degraded services.
- Older payloads without `status` fall back to ready/desired (no regression).
- `go test ./...`, `npm -C web run test|typecheck|lint|build` pass.

## Test plan

- `internal/api/handlers/workspace_binding_test.go`: per-kind classifier
  (healthy / progressing via updated<desired / degraded via ProgressDeadline /
  degraded via ready<desired) and worst-of aggregation.
- `web/src/components/Stack/stackUtils.test.ts`: `summarizeBinding` status +
  `isDegradedBinding` status-awareness (progressing != degraded).

## Next slice (handoff seed)

Surface pod-level reasons (crashloop/imagepull) for degraded workloads;
Job/CronJob coverage; image-label / Loom HUD project-metadata signals.
