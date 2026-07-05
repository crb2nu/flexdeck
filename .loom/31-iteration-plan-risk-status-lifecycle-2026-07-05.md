# RALPH Iteration Plan

## Review

- Roadmap milestone: Projects risk lifecycle follow-through under issue #31.
- Spec section(s): `.loom/42-slice-handoff-risk-capture-ui-2026-07-04.md`, `ROADMAP.md`.
- Prior decisions to preserve: keep project risks in the shared `pm_risks` Qdrant collection and treat FlexDeck writes as narrow, authenticated, audit-logged operations.

## Align

- Slice name: Projects risk status lifecycle controls.
- Scope in: project-scoped `PATCH /api/projects/{id}/risks/{riskId}` for status changes, compact Projects risk-lane status/close controls, focused backend/frontend tests.
- Scope out: risk title/owner/mitigation editing, risk links, bulk actions, and upstream loom-core API changes.
- Acceptance criteria:
  - backend validates status against `identified|mitigating|accepted|closed`
  - backend verifies the risk belongs to the requested project before updating
  - risk updates persist status/updated_at and invalidate Projects caches
  - UI can transition a risk status and close a risk, then refresh detail + rollup state
  - focused Go and Projects component tests pass
- Dependencies/blockers: Qdrant must be configured for live writes; missing or unavailable Qdrant returns the existing gateway/service errors.

## Rebase Note

- During ship, `origin/main` already contained the broader
  `feat(projects): link risks to work items` slice (`5c541d3`), which includes
  the status/close lifecycle path plus risk links and metadata editing support.
- The final branch preserves this iteration plan as RALPH history and resolves
  implementation conflicts to `origin/main` rather than replaying a narrower
  duplicate implementation.

## Land

- Planned file areas:
  - `internal/api/handlers/projects.go`
  - `web/src/lib/api/projects.ts`
  - `web/src/components/Projects/`
- Implementation steps:
  1. Add the project-scoped risk status PATCH handler and route.
  2. Add Projects risk-lane status/close controls and tests.
  3. On rebase, preserve the broader upstream implementation that superseded this narrower slice.

## Prove

- Tests to run:
  - `go test ./internal/qdrant ./internal/api/handlers`
  - `npm -C web run test -- --run src/components/Projects/index.test.tsx`
- Lint/static checks:
  - `npm -C web run typecheck`
  - `npm -C web run lint`
- CI checks: not verified in this local slice.

## Handoff/Harvest

- Docs to update: `ROADMAP.md`, `.loom/42-slice-handoff-risk-status-lifecycle-2026-07-05.md`, `.loom/50-worklog.md`.
- Agent-context entries to add: slice summary/finding and remaining follow-up task.
- Next-slice candidates: mock-mode write fixture fallback, distinct tones for `identified` and `accepted`, operator polish around the broader risk-linking controls.
