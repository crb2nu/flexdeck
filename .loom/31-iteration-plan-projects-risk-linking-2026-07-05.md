# RALPH Iteration Plan

## Review

- Roadmap milestone: Phase 6 Unified Project Tracking follow-through (#31, P2).
- Spec section(s): Projects risk lifecycle carry-forward from `.loom/42-slice-handoff-risk-lifecycle-ui-2026-07-04.md`.
- Prior decisions to preserve: risks are stored in the shared `pm_risks` Qdrant collection; FlexDeck writes a narrow authenticated PATCH surface and invalidates Projects caches after writes.

## Align

- Slice name: Projects risk linking — task/issue/decision references.
- Scope in:
  - expose typed risk links in the Projects detail risk contract
  - allow `PATCH /api/projects/{id}/risks/{riskId}` to replace the risk link set
  - add a compact risk-row UI for linking to already-loaded tasks, GitLab issues, and decisions
  - cover backend validation/projection and frontend add/remove behavior
- Scope out:
  - creating new tasks/issues/decisions from a risk
  - editing non-status risk fields in the UI
  - cross-project links or plan/milestone linking
- Acceptance criteria:
  - risk detail responses include typed `links`
  - status-only updates keep existing links
  - link updates reject malformed link types or blank IDs
  - operators can add/remove a task, issue, or decision link from a risk row
  - successful link changes silently refresh the detail lane
- Dependencies/blockers:
  - existing project detail response must contain candidate tasks/issues/decisions
  - Qdrant payloads may contain legacy `links` values, so parsing must be tolerant

## Land

- Planned file areas:
  - `internal/api/handlers/projects.go`
  - `internal/api/handlers/projects_test.go`
  - `web/src/lib/api/projects.ts`
  - `web/src/components/Projects/index.tsx`
  - `web/src/components/Projects/index.test.tsx`
  - `web/src/components/Projects/projects.fixture.ts`
  - `web/src/components/Projects/projectsUtils.ts`
- Implementation steps:
  1. Add `projectRiskLink` parsing, validation, and PATCH handling in the backend.
  2. Extend the web API types and stable risk signature with links.
  3. Add a link picker/removal control in each risk row.

## Prove

- Tests to run:
  - `go test ./internal/api/...`
  - `npm -C web run test -- --run src/components/Projects/index.test.tsx`
- Lint/static checks:
  - `npm -C web run typecheck`
  - `npm -C web run lint`
- CI checks:
  - verify after push/MR if this slice is shipped from the worktree.

## Handoff/Harvest

- Docs to update:
  - `ROADMAP.md`
  - `.loom/42-slice-handoff-risk-linking-2026-07-05.md`
- Agent-context entries to add:
  - decision: typed links replace raw string-only risk links for the UI contract
  - finding: validation and legacy parsing behavior
- Next-slice candidates:
  - inline editing for title/likelihood/impact/mitigation/owner
  - plan/milestone link support if operators need it
