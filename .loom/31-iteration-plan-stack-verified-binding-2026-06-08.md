# Iteration Plan — Phase 5 Slice C-2: Verified Service-to-Cluster Binding (2026-06-08)

## Milestone

Phase 5 Local Stack Support → Service-to-Cluster Binding (raise `inferred`→`verified`).

## Riskiest assumption + kill-test

**Load-bearing assumption**: FlexDeck can confirm a repo's inferred cluster
binding against live Flux state by joining the repo's GitLab project path to a
Flux `GitRepository` source, and resolve the owning Kustomization.

**Kill test (run live BEFORE building, passed 2026-06-08)** via the cluster's
real Flux objects:
- All `GitRepository.spec.url` use the **internal** host
  `gitlab-vm.gitlab.svc.cluster.local` (e.g. `.../services/flexdeck.git`),
  while repo git remotes use `gitlab.flexinfer.ai`. A **host-based** match
  (the inferred `matchKey`) would FAIL; a **project-path** match
  (`services/flexdeck`) succeeds for both.
- The `GitRepository` name equals the repo name and the inferred `fluxSource`
  (`flexdeck`/`flexinfer`/`loom-core` all confirmed), living in `flux-system`.
- The owning `Kustomization/flexdeck` references `GitRepository/flexdeck` and
  sets **no** `targetNamespace` (manifests carry their own ns) — so namespace
  must stay inferred unless `targetNamespace` is explicitly set.
- One source can own **many** Kustomizations (`flexinfer` →
  `flexinfer-models`, `flexinfer-system`) — selection must be deterministic.

**Failure mode if wrong**: verified bindings would point at the wrong
source/namespace, eroding trust in the confidence chip.

**Status**: passed 2026-06-08 — design uses project-path join + deterministic
Kustomization selection + targetNamespace-only namespace upgrade.

## Scope

- In:
  - `RepoBinding.fluxNamespace` (additive); exported `ProjectPathFromURL`.
  - Pure `workspace.EnrichBindings(inv, targetsByPath)` upgrading matched
    **service** bindings to `verified` (real source name + namespace, owning
    Kustomization, targetNamespace when set; new signals `flux-source`,
    `flux-kustomization`).
  - Handler: list live GitRepository + Kustomization (best-effort) and a pure
    `buildFluxTargets` that parses them into `map[projectPath]FluxTarget`.
  - Graceful degradation: any cluster/list failure leaves bindings `inferred`
    (endpoint never breaks).
  - Frontend: `fluxNamespace` on the type + search; verified chip already
    supported.
- Out:
  - Live K8s Deployment/pod health, image-label and Loom HUD signals.
  - Marking libraries verified even when they have a Flux source.

## Acceptance criteria

- A service repo whose `gitlabProject` path matches a live GitRepository source
  becomes `confidence=verified` with the real `fluxSource`/`fluxNamespace`,
  resolved `kustomization`, and `namespace` upgraded only when the owning
  Kustomization sets `targetNamespace`.
- Unmatched services stay `inferred`; libraries stay `library/none`.
- The endpoint returns inferred bindings unchanged when the cluster is
  unreachable.
- `go test ./...`, `npm -C web run test|typecheck|lint|build` pass.

## Test plan

- `internal/workspace/binding_test.go`: `TestProjectPathFromURL` (internal host,
  public host, scp, `.git`) and `TestEnrichBindings` (verified upgrade,
  targetNamespace-only namespace change, unmatched stays inferred, library
  untouched).
- `internal/api/handlers/workspace_test.go`: `TestBuildFluxTargets` over
  hand-built unstructured objects mirroring the live shapes (internal-host URL,
  one source → many kustomizations, empty targetNamespace).
- `web/src/components/Stack/stackUtils.test.ts`: verified `summarizeBinding`.

## Next slice (handoff seed)

Bind to live K8s Deployments (running namespace + replica health) and fold in
image-label / Loom HUD project-metadata signals; surface a binding-confidence
filter on the Stack view.
