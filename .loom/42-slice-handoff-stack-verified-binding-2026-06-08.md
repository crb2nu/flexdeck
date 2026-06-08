# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 5 Local Stack Support.
- Slice: Service-to-Cluster Binding (C-2, verified via live Flux).
- Status: complete locally.

## What Landed

- Inferred service bindings are upgraded to `confidence=verified` when the
  repo's GitLab **project path** matches a live Flux `GitRepository` source.
  The owning Kustomization (and its `targetNamespace`, when set) is resolved.
- The join is **path-based**, not host-based: Flux sources use the internal
  git host `gitlab-vm.gitlab.svc.cluster.local` while repo remotes use the
  public `gitlab.flexinfer.ai`, so a host-qualified key would never match.
- Live listing is best-effort in the handler; the workspace package stays
  Kubernetes-free. When the cluster is unreachable, bindings stay `inferred`
  and the endpoint does not break.
- Key files:
  - `internal/workspace/binding.go` (`FluxTarget`, `EnrichBindings`, `ProjectPathFromURL`, `fluxNamespace`)
  - `internal/api/handlers/workspace_binding.go` (`fluxBindingTargets`, `buildFluxTargets`)
  - `internal/api/handlers/workspace.go` (enrich inside the cached scan)
  - `internal/workspace/binding_enrich_test.go`, `internal/api/handlers/workspace_binding_test.go`
  - `web/src/lib/api/workspace.ts`, `web/src/components/Stack/stackUtils.ts` (+ test)
  - `ROADMAP.md`, `.loom/40-decisions.md`, `.loom/31-iteration-plan-stack-verified-binding-2026-06-08.md`

## Validation Results

- `go test ./...` passed (all packages).
- `npm -C web run test` (Stack), `typecheck`, `lint`, `build` passed.
- Kill-test (live cluster, run before building): confirmed path-based join,
  GitRepo-name == repo-name, empty `targetNamespace` on flexdeck, one source →
  many kustomizations for flexinfer.
- Live end-to-end probe (real dynamic client over k3s kubeconfig, 16 sources /
  23 kustomizations): `services/flexdeck` → verified `flux-system/flexdeck`,
  kustomization `flexdeck`, ns `flexdeck`; `services/flexinfer` → verified,
  kustomization `flexinfer-models` (deterministic); an unmatched repo stayed
  `inferred`.

## What Is Still Open

- Verified namespace falls back to inferred when the Kustomization sets no
  `targetNamespace` (the common case here) — it is not yet confirmed against a
  live Deployment.
- Libraries with their own Flux source (e.g. `fi-fhir`) are intentionally left
  as `library/none`; only services verify.

## Next Actions

1. Bind to live K8s Deployments: confirm the running namespace + replica health
   and reflect it in the binding (authoritative namespace, ready/not-ready).
2. Fold in image-label and Loom HUD project-metadata signals.
3. Add a binding-confidence filter/badge to the Stack view once `verified` data
   is widespread.

## Context Links

- `.loom/31-iteration-plan-stack-verified-binding-2026-06-08.md`
- `.loom/42-slice-handoff-stack-cluster-binding-2026-06-08.md`
- `.loom/40-decisions.md`
