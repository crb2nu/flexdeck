# RALPH Iteration Plan

## Review

- Roadmap milestone: Phase 6 Unified Project Tracking.
- Spec section(s): `ROADMAP.md` Phase 6 risk capture wiring; existing `/api/projects` federation contract in `internal/api/handlers/projects.go`.
- Prior decisions to preserve: keep project federation keyed on GitLab `path_with_namespace`; keep Qdrant source failures isolated; match loom-core `mcp-pm` `pm_risks` payload shape.

## Align

- Slice name: Projects risk capture API.
- Scope in: authenticated backend risk-create route, Qdrant collection/index/upsert support, loom-core-compatible validation/defaults, cache invalidation, focused tests.
- Scope out: inline Projects UI form, risk update/link/close actions, embedding provider calls, broader plan/risk workflow automation.
- Acceptance criteria: callers can create a risk for `/api/projects/{id}`; the created risk lands in `pm_risks` with canonical `project`, `status`, likelihood/impact defaults, timestamps, and a vector accepted by Qdrant; existing detail/rollup reads see the new risk after cache invalidation; invalid values return 400.
- Dependencies/blockers: no live MCP `pm_risk_create` bridge is available inside FlexDeck; direct Qdrant write mirrors the loom-core persistence contract.

## Land

- Planned file areas: `internal/qdrant`, `internal/api/handlers/projects.go`, `internal/api/router.go`, tests, roadmap/handoff docs.
- Implementation steps:
  1. Extend the Qdrant client with collection ensure, keyword index ensure, and point upsert.
  2. Add `POST /api/projects/{id}/risks` with validation/defaults and cache invalidation.
  3. Cover the Qdrant and handler contracts with focused Go tests.

## Prove

- Tests to run: `go test ./internal/qdrant ./internal/api/handlers`; `go test ./...`.
- Lint/static checks: `gofmt`; Go compile through tests.
- CI checks: verify after branch/MR if this slice is shipped through GitLab.

## Handoff/Harvest

- Docs to update: `ROADMAP.md`, `.loom/42-slice-handoff-risk-capture-2026-06-29.md`.
- Agent-context entries to add: decision for direct FlexDeck Qdrant risk capture and finding for remaining UI workflow.
- Next-slice candidates: inline risk form on `/projects`, risk update/link/close actions, or workflow shortcut from plan riskiest-assumption drill-in.
