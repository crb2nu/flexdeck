# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 5 Local Stack Support.
- Slice: Library Adoption & Contract Coverage (L-1, adoption mapping).
- Status: complete locally.
- Note: first slice of the **second** Phase 5 roadmap item (pivoted off the
  service-to-cluster binding arc, which shipped !172–!178).

## What Landed

- A post-`Scan` adoption pass (`internal/workspace/adoption.go`) maps
  service→lib dependencies. For each library it resolves identifiers — the
  `libs/<dir>` path, the Go module path, and the Python/Node package `name` —
  then text-scans each service's dependency manifests for them.
- `Repository.DependsOn` (libs a service uses) and `Repository.UsedBy` (services
  using a lib), additive. Filesystem scan only.
- Frontend: a "Uses libs" row on service cards, an "Adoption" row on lib cards
  (explicitly showing libs with **no** service adopters), and adoption in card
  search.
- Key files:
  - `internal/workspace/adoption.go`, `internal/workspace/adoption_test.go`
  - `internal/workspace/inventory.go` (`DependsOn`/`UsedBy` fields + `computeAdoption` wiring)
  - `web/src/lib/api/workspace.ts`, `web/src/components/Stack/{stackUtils.ts,index.tsx}` (+ tests)
  - `ROADMAP.md`, `.loom/40-decisions.md`, `.loom/31-iteration-plan-lib-adoption-2026-06-08.md`

## Validation Results

- `go test ./...` passed (all packages, incl. `TestComputeAdoptionAcrossEcosystems`,
  `TestLibraryIdentifiersResolvesPackageNames`).
- `npm -C web run test` (265 tests), `typecheck`, `lint`, `build` passed.
- **Live `Scan` probe** over the real workspace: 5 Go services declare
  workspace-lib deps (`diff-surgeon`, `fi-mcp-gateway`, `loom-core`,
  `mcp-orchestra`, `mcp-sandbox`); `mcp-go` used by 5, `fi-mcp-kit` by 3,
  `fi-accel` by 2. `flexinfer-site`'s script-path "visual-kit" reference was
  correctly **not** treated as adoption (no false positive).

## What Is Still Open

- The cross-cutting **contract libs** (py-observability/-resilience,
  visual-kit/ts-resilience) have **zero service adopters** via manifests today —
  surfaced as "No service adopters yet" but no dedicated coverage tile/filter yet.
- Python adoption has no live cases; contract *version*-drift, lib→lib
  adoption, and adoption via the GitLab-API inventory source are not covered.

## Next Actions

1. Add an adoption/contract-coverage summary tile + a filter for "unadopted
   libs" so the observability/resilience/UI-token coverage gap is a first-class
   signal.
2. Add contract version-drift (compare adopted vs current lib version) and
   lib→lib adoption.
3. Compute adoption for the GitLab-API inventory source (read repo files via API).

## Context Links

- `.loom/31-iteration-plan-lib-adoption-2026-06-08.md`
- `.loom/42-slice-handoff-stack-health-sort-2026-06-08.md` (prior arc end)
- `.loom/40-decisions.md`
