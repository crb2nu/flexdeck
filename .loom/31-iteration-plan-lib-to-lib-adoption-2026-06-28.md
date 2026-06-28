# Iteration Plan — Phase 5 Slice L-2: Library→Library Adoption (2026-06-28)

## Milestone

Phase 5 Local Stack Support → Library Adoption & Contract Coverage. Slice L-1
(services→libs adoption) shipped (flexdeck!179) and the coverage tile/filter
shipped (!212), GitLab-API source (!214). This slice closes the "lib→lib
adoption" remaining item named explicitly on ROADMAP line 129.

## Riskiest assumption + kill-test

**Load-bearing assumption**: A library's dependency manifest references *other*
workspace libraries by the same detectable identifiers a service uses (`libs/<dir>`
path, Go module path, py/node package name), so the existing pure `matchAdoption`
matcher works unchanged when libs are added as consumers.

**Kill test (≤30 min)**: Add a lib whose `go.mod` requires another lib's module
path to the existing `adoption_test.go` temp workspace; assert the consumer lib's
`DependsOn` and the depended lib's `UsedByLibs` populate. Since libs use the same
manifest formats as services and the matcher is already proven for services, a
green test exercising the real `Scan` path confirms the assumption end-to-end.

**Failure mode if wrong**: cross-cutting libs (observability/resilience) consumed
only by other libs keep showing "No service adopters yet" and read as dead
orphans, when they are in fact transitively used — the misleading signal the
coverage tile shipped on top of.

**Status**: passed 2026-06-28 — see Prove section (go test green over real Scan).

## Scope

- In:
  - `matchAdoption`: treat **services and libs** as consumers (was services-only).
    Populate `DependsOn` for lib repos (libs they depend on) and a new
    `Repository.UsedByLibs` (libs that depend on this lib). `UsedBy` stays
    **service-only** so the contract-coverage metric keeps meaning "is this wired
    into a running service".
  - Both scan paths feed lib consumer text: `computeAdoption` (FS) and
    `ScanGitLab` (GitLab-API).
  - Frontend: `usedByLibs` type field; `libAdoptionLabel` reveals lib consumers
    (a lib used only by libs no longer reads as a dead orphan); lib cards show
    their own `dependsOn` ("Uses libs"); `usedByLibs` joins card search.
- Out:
  - Contract *version*-drift (separate slice).
  - Redefining "coverage" — service adoption stays the headline metric; lib-only
    adoption is surfaced per-card, not folded into the coverage %.

## Acceptance criteria

- A lib whose manifest requires another workspace lib lists it in `dependsOn`;
  the depended lib lists the consumer in `usedByLibs`. Works on both the FS and
  GitLab-API scan paths.
- `UsedBy` remains service-only (no regression to coverage tile / unadopted
  filter semantics).
- A lib used only by other libs shows lib consumers in its adoption label rather
  than reading as a dead orphan.
- Additive JSON (`usedByLibs,omitempty`); no regression to existing consumers.
- `go test ./...`, `npm -C web run test|typecheck|lint|build` pass.

## Test plan

- `internal/workspace/adoption_test.go`: a lib→lib require in the temp workspace;
  assert consumer `DependsOn` + depended `UsedByLibs`; assert a service-only lib
  has empty `UsedByLibs` and a lib-only lib has empty `UsedBy`.
- `internal/workspace/gitlab_inventory_test.go`: extend the adoption fixture with
  a lib that requires another lib; assert `UsedByLibs` over the GitLab path.
- `web/src/components/Stack/stackUtils.test.ts`: `libAdoptionLabel` for the
  lib-only-consumer case; `usedByLibs` in `repositoryMatches`.

## Next slice (handoff seed)

Contract *version*-drift (a service/lib pinning a different version than the lib
declares). Then service-to-cluster binding depth (pod-level crashloop/imagepull
reasons, Jobs/CronJobs).
