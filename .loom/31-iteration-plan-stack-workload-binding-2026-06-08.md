# Iteration Plan — Phase 5 Slice C-3: Live Workload Binding (2026-06-08)

## Milestone

Phase 5 Local Stack Support → Service-to-Cluster Binding (live K8s workloads).

## Riskiest assumption + kill-test

**Load-bearing assumption**: FlexDeck can determine a verified service's
authoritative running namespace and replica health from live Deployments by
joining them to the Flux source through the `kustomize.toolkit.fluxcd.io/name`
label every Flux-applied resource carries.

**Kill test (run live BEFORE building, passed 2026-06-08)**:
- `kubectl get deploy -A -l kustomize.toolkit.fluxcd.io/name=flexdeck` → 3
  Deployments in ns `flexdeck` (`flexdeck`, `flexdeck-public`, `redis`), all
  1/1. Authoritative namespace `flexdeck` matches the inferred guess.
- The C-2 deterministic kustomization pick for flexinfer (`flexinfer-models`)
  has **no** Deployments; the sibling `flexinfer-system` owns 2 running
  Deployments in ns **`flexinfer-system`** (not the inferred `flexinfer`).

**Conclusions baked into the design**:
- Workload lookup must aggregate across **all** kustomizations of a source,
  not just the displayed one.
- The Deployment namespace is **more authoritative** than the inferred /
  targetNamespace guess and should override it.
- The displayed kustomization should prefer the one that actually owns
  workloads.

**Failure mode if wrong**: showing a service as bound to the wrong namespace,
or as having no workloads when it is in fact running.

**Status**: passed 2026-06-08.

## Scope

- In:
  - `RepoBinding.workload` (`{namespaces, deployments, ready, desired}`),
    additive.
  - Join Deployment → Kustomization (via Flux labels) → source path; aggregate
    per path; attach to `FluxTarget`.
  - `EnrichBindings`: set workload, override namespace from the single workload
    namespace, add signal `k8s-workload`; prefer the workload-owning
    kustomization for display.
  - Best-effort: no/failed Deployment list leaves bindings at C-2 behavior.
  - Frontend: workload type + a "N/M ready" chip on the Stack card.
- Out:
  - Pod-level health, rollout status, HPA, image-label / Loom HUD signals.
  - Non-Deployment workloads (StatefulSet/DaemonSet) — Deployments only here.

## Acceptance criteria

- A verified service with running Deployments gains `workload` with summed
  ready/desired and the namespace(s); its `namespace` becomes the single
  workload namespace when unambiguous (flexinfer → `flexinfer-system`).
- Services without workloads keep their C-2 verified binding unchanged.
- Endpoint degrades cleanly when the cluster/Deployment list is unavailable.
- `go test ./...`, `npm -C web run test|typecheck|lint|build` pass.

## Test plan

- `internal/workspace/binding_enrich_test.go`: workload attach + single-ns
  override + `k8s-workload` signal; no-workload path unchanged.
- `internal/api/handlers/workspace_binding_test.go`: extend `buildFluxTargets`
  over hand-built Deployments mirroring the live shapes (flexdeck 3 deploys ns
  flexdeck; flexinfer-system 2 deploys ns flexinfer-system attached to the
  flexinfer source; workload-owning kustomization preferred for display).
- `web/src/components/Stack/stackUtils.test.ts`: workload summary string.

## Next slice (handoff seed)

Add StatefulSet/DaemonSet workloads and pod/rollout health; fold in
image-label / Loom HUD project-metadata signals; add a binding-confidence /
health filter to the Stack view.
