# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 6 Unified Project Tracking.
- Slice: Projects risk lifecycle — inline status update/close (UI + backend).
- Status: complete

## What Landed

- Backend: `PATCH /api/projects/{id}/risks/{riskId}` (`UpdateProjectRisk` in
  `internal/api/handlers/projects.go`). It scrolls the project's `pm_risks`,
  matches the point by payload `id`, applies the provided (pointer) fields —
  status/likelihood/impact validated against the same ladders as create —
  bumps `updated_at`, and re-upserts in place (same point ID + zero vector).
  Cache invalidation mirrors the create path. Audit-logged as
  `project.risk.update`; route wired in `internal/api/router.go`.
- Frontend: each risk row now renders an inline status `Select` (`RiskRow` in
  `web/src/components/Projects/index.tsx`). Selecting a new status PATCHes via
  `projectsApi.updateRisk` and silently refreshes the detail lane; failures
  surface inline. Legacy statuses outside the canonical ladder (e.g. `open`,
  from mcp-pm-created risks) are preserved as the current option via
  `riskStatusOptions` so the control shows the true state while offering the
  canonical transition targets the backend accepts.
- Cleanup: removed the now-orphaned `riskStatusTone` util (its only consumer was
  the read-only status badge the inline control replaces).

## Contract

- Request body (all fields optional; omitted = unchanged):
  `{ title?, likelihood?, impact?, status?, mitigation?, owner? }`.
- 200 → updated risk `{ id, title, likelihood, impact, status }`.
- 404 when the risk id is not found in the project; 400 on invalid field;
  503 when Qdrant is unconfigured.

## Verification

- Go: `go test ./internal/api/...` green (4 new update tests: transition,
  not-found, validation table, blank risk id).
- Web: `vitest run` 353/353 (Projects/index 8, +2: status transition happy path
  + inline error surface); `tsc --noEmit` clean; `eslint src --max-warnings=0`
  clean.

## Remaining / Next

- Risk **linking** (risk → tasks/issues/decisions) is deliberately out of scope
  here; it needs a link-target picker UI and a distinct payload shape.
- Field editing beyond status (title/likelihood/impact/mitigation/owner) is
  wired end-to-end in the backend but not yet surfaced in the UI (status is the
  primary operator transition).
