# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 6 Unified Project Tracking.
- Slice: Projects risk linking — task/issue/decision references.
- Status: complete

## What Landed

- Key changes: `ProjectRisk` now exposes typed `links` (`task`, `issue`, or
  `decision`) from the shared `pm_risks` payload. The existing
  `PATCH /api/projects/{id}/risks/{riskId}` endpoint accepts a `links` array and
  replaces the risk's link set while preserving links on status-only updates.
- Backend behavior: link writes are strict (`type` must be task/issue/decision,
  `id` is required, max 20 entries, duplicate type/id pairs dedupe). Detail
  projection is tolerant of older malformed/legacy link payloads and skips
  entries it cannot type safely.
- Frontend behavior: each risk row renders existing links as removable chips and
  offers a compact picker over already-loaded project tasks, GitLab issues, and
  decisions. Adding/removing a link uses the same PATCH endpoint and silently
  refreshes the detail lane on success.
- Key files:
  - `internal/api/handlers/projects.go`
  - `internal/api/handlers/projects_test.go`
  - `web/src/lib/api/projects.ts`
  - `web/src/components/Projects/index.tsx`
  - `web/src/components/Projects/index.test.tsx`
  - `web/src/components/Projects/projects.fixture.ts`
  - `web/src/components/Projects/projectsUtils.ts`
  - `ROADMAP.md`
- Validation results:
  - `go test ./internal/api/...` passed
  - `npm -C web run test -- --run src/components/Projects/index.test.tsx` passed
    (10/10)
  - `npm -C web run typecheck` passed
  - `npm -C web run lint` passed

## What Is Still Open

- Inline editing for non-status risk fields (title, likelihood, impact,
  mitigation, owner) is still backend-capable but not surfaced in the UI.
- Plan/milestone linking remains out of scope until there is a concrete operator
  workflow for those references.

## Next Actions

1. Decide whether operators need inline field editing beyond status/link changes.
2. If yes, add an expanded risk editor over the already-supported PATCH fields.
3. Verify CI after the branch is pushed/MR'd.

## Context Links

- Agent-context session: `747df889f55a91f6`
- Task IDs: created in agent context during this slice
- Relevant docs/specs:
  - `.loom/31-iteration-plan-projects-risk-linking-2026-07-05.md`
  - `.loom/42-slice-handoff-risk-lifecycle-ui-2026-07-04.md`
  - `ROADMAP.md`
