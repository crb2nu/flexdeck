# Iteration Plan — Phase 5 Slice C-1: Inferred Service-to-Cluster Binding (2026-06-08)

## Milestone

Phase 5 Local Stack Support → Service-to-Cluster Binding (first increment).

## Riskiest assumption + kill-test

**Load-bearing assumption**: A repository's runtime cluster identity
(K8s namespace + Flux `GitRepository` source + Kustomization) can be
inferred from inventory metadata already collected by the scanner
(repo name, `services/<repo>` GitLab path, sanitized remote URL) with
enough accuracy to be useful operator orientation *before* any live
cluster cross-reference.

**Kill test**: Derive bindings for known canonical services and assert
the inferred identity matches the documented Flux convention. For
`services/flexdeck` with remote `https://gitlab.flexinfer.ai/services/flexdeck.git`
the binding must be `namespace=flexdeck`, `fluxSource=flexdeck`,
`kustomization=flexdeck`, `gitlabProject=services/flexdeck`,
`matchKey=gitlab.flexinfer.ai/services/flexdeck`. This is exercised by
`internal/workspace/binding_test.go` and re-confirmed against the live
endpoint during Prove.

**Failure mode if the assumption is wrong**: Inferred namespace/source
names that don't match real Flux objects would mislead operators. We'd
then need to pull live Flux source URLs earlier than planned and treat
the inventory-only binding as a candidate key only.

**Status**: passed 2026-06-08 — convention holds for the canonical case
(documented: `GitRepository/flexdeck` in `flux-system` tracks
`services/flexdeck.git`, `Kustomization/flexdeck` applies `./k8s/base`).
Confidence is deliberately capped at `inferred`; a later slice verifies.

## Scope

- In:
  - Additive `RepoBinding` model on `workspace.Repository` (`binding`, omitempty).
  - Pure `deriveBinding(Repository) *RepoBinding` from name/bucket/remote/path.
  - Wire into both the filesystem (`Scan`) and GitLab (`ScanGitLab`) sources.
  - Frontend types + Stack card binding row + search inclusion.
- Out:
  - Live Flux/K8s/GitLab-CI/HUD cross-reference and `verified` confidence.
  - Image-label and Loom HUD project-metadata signals.
  - Any mutation/process-control surface.

## Acceptance criteria

- Service repos emit `kind=service`, `confidence=inferred`, inferred
  `namespace`/`fluxSource`/`kustomization` (sanitized repo name),
  `gitlabProject`, `matchKey` (when a remote host is parseable), and a
  `signals` list naming the inputs used.
- Library repos emit `kind=library`, `confidence=none`, no cluster target.
- The change is additive and backward compatible (existing inventory
  consumers and tests keep passing).
- Stack cards show an inferred "Cluster" line for services with a
  confidence chip; libraries show a "not deployed" hint.
- `go test ./internal/workspace ./internal/api/handlers`,
  `npm -C web run test`, `typecheck`, `lint`, and `build` pass.

## Risk notes

- Heuristic could be presented as fact → mitigated by an explicit
  `inferred` confidence chip and "not yet verified" framing in the UI.
- Nested GitLab subgroups produce deeper `matchKey` paths → acceptable;
  full path is what GitLab/Flux URLs reduce to anyway.

## Test plan

- `internal/workspace/binding_test.go`: table-driven over https/scp/no-remote
  service repos, a library repo, and name sanitization, plus a `Scan`
  integration assertion that `Binding` is populated.
- `web/src/components/Stack/stackUtils.test.ts`: `summarizeBinding` for
  service vs library, and `repositoryMatches` by namespace/fluxSource/project.

## Next slice (handoff seed)

Raise `confidence` to `verified` by cross-referencing `matchKey` against
live Flux `GitRepository` source URLs and resolving the real namespace
from the owning Kustomization, then fold in image-label / Loom HUD signals.
