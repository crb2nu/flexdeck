# RALPH Slice Handoff

## Slice Summary

- Milestone: Projects risk lifecycle follow-through.
- Slice: Risk status lifecycle controls for the Projects risk lane.
- Status: superseded-by-main

## What Landed

- Key changes: the local RALPH pass produced a narrow risk status/close slice, but rebase found `origin/main` already contains a broader merged implementation from `feat(projects): link risks to work items` (`5c541d3`). That upstream implementation includes the project-scoped PATCH path, status/close controls, risk links, and editable risk metadata support.
- Resolution: implementation conflicts were resolved to `origin/main` to avoid replacing the broader merged work with the narrower local variant. This handoff records the RALPH slice history and the supersession decision.
- Key files in the upstream implementation: `internal/api/handlers/projects.go`, `web/src/lib/api/projects.ts`, `web/src/components/Projects/index.tsx`, `web/src/components/Projects/projects.fixture.ts`, `web/src/components/Projects/projectsUtils.ts`, and focused backend/frontend tests.
- Local validation before rebase: `go test ./internal/qdrant ./internal/api/handlers` passed; `npm -C web run test -- --run src/components/Projects/index.test.tsx` passed; `npm -C web run typecheck` passed; `npm -C web run lint` passed.

## What Is Still Open

- Full risk metadata/link editing is no longer open on `origin/main`; it shipped in the broader risk-linking slice.
- Dev mock-mode writes still call the live backend and surface errors when unreachable.
- `identified` and `accepted` currently share the neutral/default status tone.

## Next Actions

1. Consider a mock write fixture path for local UI demos.
2. Split `riskStatusTone` for `identified` versus `accepted` if the visual distinction matters operationally.
3. Smoke the broader risk-linking controls in the deployed Projects lane after the next deploy.

## Context Links

- Agent-context session: `868decda58e71c87`
- Task IDs: `affef7b9ed9660e6`
- Relevant docs/specs: `ROADMAP.md`, `.loom/42-slice-handoff-risk-capture-ui-2026-07-04.md`, `.loom/31-iteration-plan-risk-status-lifecycle-2026-07-05.md`, `.loom/42-slice-handoff-risk-linking-2026-07-05.md`
