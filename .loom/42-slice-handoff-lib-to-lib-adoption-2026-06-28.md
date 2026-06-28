# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 5 Local Stack Support → Library Adoption & Contract Coverage.
- Slice: Library→Library adoption (L-2). Continues L-1 (services→libs, !179),
  the coverage tile/filter (!212), and GitLab-API adoption (!214).
- Status: complete locally; all gates green.

## What Landed

- `matchAdoption` (`internal/workspace/adoption.go`) now treats **both services
  and libs** as consumers (was services-only). A lib that requires another
  workspace lib gets that lib in its own `DependsOn`; the depended-on lib records
  the consumer in a new `Repository.UsedByLibs`.
- `UsedBy` stays **service-only** on purpose, so the contract-coverage metric and
  the "unadopted" filter keep meaning "is this wired into a running service."
  Lib→lib usage is a separate, additive signal.
- Both scan paths feed lib consumer text through the one shared pure matcher:
  `computeAdoption` (filesystem) and `ScanGitLab` (GitLab-API, the prod default).
- Frontend: `usedByLibs` type field; `libAdoptionLabel` now appends lib consumers
  (`… · used by N libs: …`) so a lib used only by libs no longer reads as a dead
  orphan; lib cards show their own `dependsOn` ("Uses libs"); `usedByLibs` joins
  card search; the adoption row brightens when used by services **or** libs.
- Key files:
  - `internal/workspace/adoption.go` (+ `adoption_test.go`)
  - `internal/workspace/gitlab_inventory.go` (+ `gitlab_inventory_test.go`)
  - `internal/workspace/inventory.go` (`UsedByLibs` field + `dependsOn` comment)
  - `web/src/lib/api/workspace.ts`, `web/src/components/Stack/{stackUtils.ts,index.tsx}` (+ test)
  - `ROADMAP.md`, `.loom/31-iteration-plan-lib-to-lib-adoption-2026-06-28.md`

## Validation Results

- `go test ./...` passed (incl. new `TestComputeAdoptionLibToLib` and the extended
  `TestScanGitLabComputesAdoption` asserting `UsedByLibs` over the GitLab path).
- `go vet ./internal/workspace/...` clean.
- `npm -C web run test` (302 tests), `typecheck`, `lint`, `build` passed.
- `npm -C web run perf:bundle` passed (landing 102.6 kB gz < 160 kB budget).

## What Is Still Open

- Contract **version-drift** (a consumer pinning a different version than the lib
  declares) is the last remaining Library-Adoption sub-item.
- Service-to-cluster binding **depth** (pod-level crashloop/imagepull reasons,
  Jobs/CronJobs) is the other open Phase 5 thread.

## Next Actions

1. Contract version-drift: parse the pinned vs declared lib version per ecosystem
   and flag mismatches on the card.
2. Then pick up binding depth (Jobs/CronJobs binding mirrors the existing
   Deployment/StatefulSet/DaemonSet path).

## Context Links

- `.loom/31-iteration-plan-lib-to-lib-adoption-2026-06-28.md`
- `.loom/42-slice-handoff-lib-adoption-2026-06-08.md` (L-1, predecessor)
- `.loom/40-decisions.md`
