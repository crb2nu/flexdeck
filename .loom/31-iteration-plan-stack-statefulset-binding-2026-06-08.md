# Iteration Plan — Phase 5 Slice C-4: StatefulSet + DaemonSet Workloads (2026-06-08)

## Milestone

Phase 5 Local Stack Support → Service-to-Cluster Binding (broaden live workload
coverage beyond Deployments).

## Riskiest assumption + kill-test

**Load-bearing assumption**: Services run workloads as StatefulSets/DaemonSets
(not only Deployments) under their Flux Kustomization, so binding only to
Deployments under-reports — sometimes to zero.

**Kill test (run live BEFORE building, passed 2026-06-08)**:
- `services/smarthome` → StatefulSet `home-assistant` (ns `smarthome`) and **no
  Deployment** under its kustomization — C-3 shows it with no workload at all.
- `services/news-analyzer` → StatefulSets `minio` + `postgres`;
  `services/jobsearch-app` → `neo4j` + `postgres` (ns `daemon`). Data tiers are
  currently invisible.
- DaemonSets carrying Flux labels all belong to platform kustomizations
  (`apps`/`system`/`monitoring`) whose source is `gitops-gitlab`, not a service
  GitRepository — so they will not (mis)attach to any service binding.

**Failure mode if wrong**: StatefulSet-backed services keep showing as having no
running workload, undermining the workload signal.

**Status**: passed 2026-06-08.

## Scope

- In:
  - Aggregate StatefulSet + DaemonSet replica health into the existing workload
    join via the same `kustomize.toolkit.fluxcd.io` labels.
  - Per-kind counts on `Workload` (`deployments`/`statefulSets`/`daemonSets`);
    `ready`/`desired` sum across all kinds. Kind-correct replica extraction
    (DaemonSet uses `desiredNumberScheduled`/`numberReady`).
  - Refactor the join to a single `workloadUnit` intermediate so all three kinds
    aggregate uniformly and stay unit-testable.
  - Frontend: optional per-kind counts on the type; the existing workload chip
    now appears for StatefulSet-backed services; chip tooltip names the kinds.
- Out:
  - Pod-level / rollout-condition health (progressing vs degraded), Jobs/CronJobs.
  - Image-label / Loom HUD signals; Stack filter/sort.

## Acceptance criteria

- A StatefulSet-only service (smarthome) gains a `workload` with the StatefulSet
  counted and its namespace authoritative.
- `ready`/`desired` sum across Deployments + StatefulSets + DaemonSets; per-kind
  counts are reported.
- DaemonSets under non-service kustomizations do not attach to any binding.
- Endpoint degrades cleanly when any workload list fails (best-effort per kind).
- `go test ./...`, `npm -C web run test|typecheck|lint|build` pass.

## Test plan

- `internal/api/handlers/workspace_binding_test.go`: `appsWorkloadUnits` replica
  extraction (Deployment nil-replicas default, StatefulSet, DaemonSet
  desired/ready); `buildFluxTargets` over mixed-kind units — StatefulSet-only
  source gets a workload, per-kind counts correct, ready/desired summed.
- `web/src/components/Stack/stackUtils.test.ts`: workload summary for a
  StatefulSet-backed binding.

## Next slice (handoff seed)

Add pod/rollout condition health (healthy vs progressing vs degraded) and
Job/CronJob coverage; fold in image-label / Loom HUD signals; add a
binding-confidence / workload-health filter + sort to the Stack view.
