# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 5 Local Stack Support.
- Slice: Service-to-Cluster Binding (C-4, StatefulSet + DaemonSet workloads).
- Status: complete locally.

## What Landed

- Workload binding now aggregates **StatefulSets and DaemonSets** alongside
  Deployments, via the same `kustomize.toolkit.fluxcd.io/{name,namespace}` label
  join. Previously a StatefulSet-backed service (or data tier) showed no
  workload.
- The join was refactored through a kind-agnostic `workloadUnit` intermediate
  (`appsWorkloadUnits`); `Workload` gained per-kind counts (`deployments`,
  `statefulSets`, `daemonSets`); `ready`/`desired` sum across all kinds. DaemonSets
  use `desiredNumberScheduled`/`numberReady`.
- Best-effort per kind: a failed list of one workload kind still surfaces the
  others. Stack card workload chip tooltip now names the kinds.
- Key files:
  - `internal/workspace/binding.go` (`Workload` per-kind counts)
  - `internal/api/handlers/workspace_binding.go` (`appsWorkloadUnits`, `workloadUnit`, `aggregateWorkloads`)
  - `internal/api/handlers/workspace_binding_test.go`
  - `web/src/lib/api/workspace.ts`, `web/src/components/Stack/stackUtils.ts`, `web/src/components/Stack/index.tsx` (+ tests)
  - `ROADMAP.md`, `.loom/40-decisions.md`, `.loom/31-iteration-plan-stack-statefulset-binding-2026-06-08.md`

## Validation Results

- `go test ./...` passed (all packages).
- `npm -C web run test` (258 tests), `typecheck`, `lint`, `build` passed.
- Kill-test (live): service-backed StatefulSets exist (smarthome `home-assistant`;
  news-analyzer `minio`/`postgres`; jobsearch-app `neo4j`/`postgres`); Flux-labeled
  DaemonSets all belong to platform kustomizations, not service sources.
- Live end-to-end probe (198 deployments / 27 statefulsets / 26 daemonsets):
  `smarthome` dep=4/sts=1, `news-analyzer` dep=5/sts=2, `jobsearch-app` dep=3/sts=2
  in authoritative ns `daemon`; all services show 0 DaemonSets (correct).

## What Is Still Open

- Pod-level and rollout-condition health (progressing vs degraded) is not yet
  computed — only ready/desired replica counts.
- Jobs/CronJobs are not counted as workloads.

## Next Actions

1. Add pod/rollout-condition health classification (healthy / progressing /
   degraded) and Job/CronJob coverage.
2. Fold in image-label and Loom HUD project-metadata signals.
3. Add a binding-confidence / workload-health filter + sort to the Stack view.

## Context Links

- `.loom/31-iteration-plan-stack-statefulset-binding-2026-06-08.md`
- `.loom/42-slice-handoff-stack-workload-binding-2026-06-08.md`
- `.loom/40-decisions.md`
