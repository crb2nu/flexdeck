# Iteration Plan — Phase 5 Slice L-1: Library Adoption Mapping (2026-06-08)

## Milestone

Phase 5 Local Stack Support → Library Adoption & Contract Coverage (map which
services depend on which workspace libraries).

## Riskiest assumption + kill-test

**Load-bearing assumption**: Service dependency manifests reference workspace
libraries by a detectable identifier, so adoption can be mapped statically.

**Kill test (run live BEFORE building, 2026-06-08)**:
- **Go** (5 services): reference libs by the `libs/<name>` path / module
  `gitlab.flexinfer.ai/libs/<name>` in `go.mod` — detectable by substring.
- **Node**: libs are named `@flexinfer/visual-kit` / `@flexinfer/ts-resilience`
  (dir name != package name); detection must read the lib's `package.json`
  `name`. `flexinfer-site`'s only "visual-kit" reference is a *script path*, not
  a dependency — so a naive path scan would false-positive; name-based matching
  correctly excludes it.
- **Python**: libs are named `flexinfer-observability` / `flexinfer-resilience`,
  but **no service declares them** in pyproject — undetectable from manifests
  (zero live adopters).
- **Conclusion**: detection needs per-ecosystem identifier resolution (lib dir
  != package name); a uniform path scan only works for Go.

**Failure mode if wrong**: a service consuming a lib via a vendored copy or at
runtime (not declared in a manifest) would be missed.

**Status**: passed — live `Scan` over the real workspace produced the correct
graph (5 Go services → 3 Go libs; no Node/Python false positives).

## Scope

- In:
  - `Repository.DependsOn` (libs a service uses) and `Repository.UsedBy`
    (services using a lib), additive.
  - A post-`Scan` adoption pass: resolve each lib's identifiers
    (`libs/<dir>` + go module + py/node package name), then text-scan each
    service's manifests for them. Filesystem scan only.
  - Frontend: a "Uses libs" row on service cards, an "Adoption" row on lib cards
    (explicitly surfacing libs with **no** service adopters), and adoption in
    card search.
- Out:
  - Contract *version*-drift; lib→lib dependencies; Python adoption (no live
    cases); adoption for the GitLab-API inventory source.

## Acceptance criteria

- A Go service that requires a workspace lib lists it in `dependsOn`; the lib
  lists the service in `usedBy`. Node/Python package names resolve identically
  when a service declares them.
- A lib with no adopters shows "No service adopters yet" (the coverage gap).
- Additive; no regression to existing inventory consumers.
- `go test ./...`, `npm -C web run test|typecheck|lint|build` pass.

## Test plan

- `internal/workspace/adoption_test.go`: Go + Node adoption across a temp
  workspace; identifier resolution for go/py/node; unused lib and
  no-dependency service.
- `web/src/components/Stack/stackUtils.test.ts`: `libAdoptionLabel` (incl.
  unadopted) and adoption-aware search.

## Next slice (handoff seed)

Surface adoption coverage of the cross-cutting contract libs
(observability/resilience/UI-token) — they currently have zero service
adopters; add a coverage tile/filter. Then contract *version*-drift, lib→lib
adoption, and adoption via the GitLab-API source.
