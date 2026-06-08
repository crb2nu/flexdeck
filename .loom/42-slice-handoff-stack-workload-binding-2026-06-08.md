# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 5 Local Stack Support.
- Slice: Service-to-Cluster Binding (C-3, live K8s workload health).
- Status: complete locally.

## What Landed

- A verified service binding is joined to live **K8s Deployments** through the
  `kustomize.toolkit.fluxcd.io/{name,namespace}` labels Flux stamps on applied
  resources, aggregating replica health across **all** of the source's
  kustomizations.
- New `binding.workload` = `{namespaces, deployments, ready, desired}`. The
  single workload namespace **overrides** the inferred/targetNamespace guess
  (authoritative); the displayed Kustomization now prefers the one that owns
  workloads. New signal `k8s-workload`.
- Best-effort and additive: a failed/empty Deployment list leaves the C-2
  verified binding intact; the endpoint never breaks.
- Stack cards show a `ready/desired` chip (green when healthy, warn otherwise).
- Key files:
  - `internal/workspace/binding.go` (`Workload`, `FluxTarget.Workload`, `EnrichBindings`)
  - `internal/api/handlers/workspace_binding.go` (`fluxBindingTargets` lists Deployments; `aggregateWorkloads`; workload-aware `pickKustomization`)
  - `internal/workspace/binding_enrich_test.go`, `internal/api/handlers/workspace_binding_test.go`
  - `web/src/lib/api/workspace.ts`, `web/src/components/Stack/stackUtils.ts`, `web/src/components/Stack/index.tsx` (+ tests)
  - `ROADMAP.md`, `.loom/40-decisions.md`, `.loom/31-iteration-plan-stack-workload-binding-2026-06-08.md`

## Validation Results

- `go test ./...` passed (all packages).
- `npm -C web run test` (257 tests), `typecheck`, `lint`, `build` passed.
- Kill-test (live, before building): flexdeck Kustomization → 3 Deployments in
  ns `flexdeck`; flexinfer's running Deployments belong to `flexinfer-system`
  (ns `flexinfer-system`), not the C-2-picked `flexinfer-models`.
- Live end-to-end probe (real typed + dynamic clients, 198 Deployments):
  `services/flexdeck` → verified, ns `flexdeck`, 3/3 ready; `services/flexinfer`
  → verified, namespace corrected to `flexinfer-system`, 2/2 ready.

## What Is Still Open

- Only Deployments are counted — StatefulSets/DaemonSets and pod/rollout-level
  health are not yet included.
- Multi-namespace workloads intentionally do not override the namespace (kept
  ambiguous-safe); such services keep their inferred/targetNamespace value.

## Next Actions

1. Add StatefulSet/DaemonSet workloads and pod/rollout health (degraded vs
   progressing vs healthy).
2. Fold in image-label and Loom HUD project-metadata signals.
3. Add a binding-confidence / workload-health filter + sort to the Stack view.

## Context Links

- `.loom/31-iteration-plan-stack-workload-binding-2026-06-08.md`
- `.loom/42-slice-handoff-stack-verified-binding-2026-06-08.md`
- `.loom/40-decisions.md`
