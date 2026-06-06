# RALPH Iteration Plan

## Review

- Roadmap milestone: Phase 5 Local Stack Support.
- Spec section(s): `.loom/brainstorm-local-stack-services-libs-2026-06-06.md`, F1/F8 and the completed local workspace inventory handoff.
- Prior decisions to preserve:
  - Keep local-stack support read-only until metadata surfaces are proven useful.
  - Treat `WORKSPACE_DIR/services` and `WORKSPACE_DIR/libs` as the integration root.
  - Defer process control and live K8s/Flux/GitLab/Loom HUD binding to later slices.

## Align

- Slice name: Stack Explorer UI.
- Scope in:
  - Typed frontend API client for `GET /api/workspace/repos`.
  - First-class `/stack` route, top nav item, command palette entry, and `g t` keyboard shortcut.
  - Searchable service/lib cards grouped by bucket.
  - Readiness summaries derived only from scanner metadata: dirty git state, missing manifests, and scanner/git warnings.
  - Context signals for worktrees and docs markers without treating those as readiness blockers.
  - Language filtering, bucket filtering, readiness filtering, loading/error/empty states.
  - Focused frontend tests for filtering, readiness helpers, and nav exposure.
- Scope out:
  - Process start/stop controls.
  - Running tests/builds across external repos.
  - Service-to-cluster, Flux, GitLab CI, or Loom HUD correlation.
  - Library adoption/dependency graph analysis.
- Acceptance criteria:
  - `/stack` renders repository inventory from `/api/workspace/repos`.
  - Users can search across names, paths, branches, manifests, package managers, and remotes.
  - Users can filter by services/libs, readiness, and primary language.
  - Summary tiles show repository totals, ready/review counts, dirty/worktree counts, CI manifest count, and docs coverage.
  - Route is discoverable from nav, command palette, and keyboard shortcut help.
- Dependencies/blockers:
  - Depends on the merged backend workspace inventory API.
  - Visual readiness is intentionally metadata-only until stronger binding heuristics exist.

## Land

- Planned file areas:
  - `web/src/lib/api/`
  - `web/src/components/Stack/`
  - `web/src/index.tsx`
  - `web/src/lib/featureFlags.ts`
  - `web/src/components/QuickLaunch/`
  - `web/src/hooks/useKeyboardShortcuts.ts`
  - `.loom/`
  - `ROADMAP.md`
- Implementation steps:
  1. Add typed workspace inventory API client.
  2. Add Stack Explorer route and read-only UI.
  3. Wire navigation and shortcuts.
  4. Add focused tests and update roadmap/handoff docs.

## Prove

- Tests to run:
  - `npm -C web run test -- --run src/components/Stack/index.test.tsx src/components/Stack/stackUtils.test.ts src/lib/featureFlags.test.ts`
  - `npm -C web run typecheck`
  - `npm -C web run lint`
  - `npm -C web run test`
- Lint/static checks:
  - `git diff --check`
- Browser checks:
  - Open `/stack` in the local app and verify the page is nonblank, responsive enough to scan, and renders loading/error/empty-ready UI without layout overlap.
- CI checks:
  - Not available until branch push/MR.

## Handoff/Harvest

- Docs to update:
  - `ROADMAP.md`
  - `.loom/31-iteration-plan-stack-explorer-ui-2026-06-06.md`
  - `.loom/42-slice-handoff-stack-explorer-ui-2026-06-06.md`
  - `.loom/40-decisions.md`
- Agent-context entries to add:
  - Decision: Stack Explorer remains read-only and metadata-only.
  - Finding: validation results and any UI/runtime limitations.
  - Task: next service-to-cluster binding heuristics slice.
- Next-slice candidates:
  - Service-to-cluster binding over repo names, remotes, image labels, Flux sources, GitLab project paths, and Loom HUD project metadata.
  - Library adoption and contract coverage radar from manifests.
  - Optional `.flexdeck.yaml` hints if automatic binding confidence is too low.
