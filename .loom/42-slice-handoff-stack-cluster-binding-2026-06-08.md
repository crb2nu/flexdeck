# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 5 Local Stack Support.
- Slice: Service-to-Cluster Binding (C-1, inferred binding).
- Status: complete locally.

## What Landed

- Added an additive `binding` field to the workspace inventory model that
  infers each service repo's cluster identity from metadata the scanner
  already collects — no new filesystem or network reads.
- Service repos report `kind=service`, `confidence=inferred`, inferred
  `namespace`/`fluxSource`/`kustomization` (sanitized repo name),
  `gitlabProject`, a normalized `matchKey` (host/path for later live
  cross-reference), and a `signals` list naming the inputs used.
- Library repos report `kind=library`, `confidence=none` (consumed, not
  deployed).
- Wired derivation into both inventory sources (filesystem `Scan` and
  GitLab `ScanGitLab`).
- Surfaced an inferred "Cluster" line on Stack cards with a confidence
  chip, and folded binding fields into card search.
- Key files:
  - `internal/workspace/binding.go`
  - `internal/workspace/binding_test.go`
  - `internal/workspace/inventory.go`
  - `internal/workspace/gitlab_inventory.go`
  - `web/src/lib/api/workspace.ts`
  - `web/src/components/Stack/stackUtils.ts`
  - `web/src/components/Stack/stackUtils.test.ts`
  - `web/src/components/Stack/index.tsx`
  - `ROADMAP.md`
  - `.loom/40-decisions.md`
  - `.loom/31-iteration-plan-stack-cluster-binding-2026-06-08.md`

## Validation Results

- `go test ./...` passed (all packages).
- `go vet ./internal/workspace/... ./internal/api/...` and `go build ./...` passed.
- `npm -C web run test` passed: 51 files, 254 tests.
- `npm -C web run typecheck` passed.
- `npm -C web run lint` passed (`--max-warnings=0`).
- `npm -C web run build` passed.
- Kill-test (live scan of `/Users/cblevins/workspace`, 57 repos): inferred
  bindings match the documented Flux convention.
  - `services/flexdeck` → ns `flexdeck`, flux `flexdeck`, kustomization
    `flexdeck`, project `services/flexdeck`, matchKey
    `gitlab.flexinfer.ai/services/flexdeck`.
  - `services/flexinfer` and `services/loom-core` follow the same pattern.
  - Libraries (e.g. `libs/banner-kit`) classified as non-deployed.

## What Is Still Open

- Confidence is capped at `inferred`; no live cluster data is read.
- Known limitation: namespace/source are name-convention guesses. Repos
  that deploy to a non-name-matching namespace or Flux source will read
  incorrectly until live verification lands.

## Next Actions

1. Raise `confidence` to `verified` by cross-referencing `matchKey`
   against live Flux `GitRepository` source URLs and resolving the real
   namespace from the owning Kustomization.
2. Fold in image-label and Loom HUD project-metadata signals.
3. Add a Stack filter/badge for binding confidence once `verified` exists.

## Context Links

- Relevant docs/specs:
  - `.loom/31-iteration-plan-stack-cluster-binding-2026-06-08.md`
  - `.loom/42-slice-handoff-stack-explorer-ui-2026-06-06.md`
  - `.loom/40-decisions.md`
