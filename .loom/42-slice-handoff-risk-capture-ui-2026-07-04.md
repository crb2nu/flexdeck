# RALPH Slice Handoff

## Slice Summary

- Milestone: Phase 6 Unified Project Tracking.
- Slice: Inline Projects risk-capture form (UI over the existing risk API).
- Status: complete

## What Landed

- Key changes: added an inline risk-capture form to the `/projects` Risks lane so
  non-API operators can create a risk directly. The form POSTs to the existing
  `POST /api/projects/{id}/risks` endpoint (shipped in the 2026-06-29 backend
  slice) and silently refreshes the detail lane on success so the new row appears.
- Fields: title (required), likelihood/impact (low|medium|high, default medium),
  status (identified|mitigating|accepted|closed, default identified), and optional
  owner + mitigation — mirroring the backend `createProjectRiskRequest` contract.
- UX: the form lives in an always-rendered `footer` slot on `SectionShell`, so the
  "+ Add risk" affordance stays reachable even when the Risks lane is empty (the
  section body itself only renders when count > 0). Uses the shared
  `Button`/`Input`/`Select` primitives. Client-side blank-title guard plus
  surfaced server errors.
- Key files: `web/src/lib/api/projects.ts` (added `createRisk` + `CreateProjectRiskInput`),
  `web/src/components/Projects/index.tsx` (`RiskForm`, `SectionShell` footer slot,
  wiring), `web/src/components/Projects/index.test.tsx` (2 new tests), `ROADMAP.md`.
- Validation results: `vitest run` 351/351 pass (Projects 6/6), `tsc --noEmit` clean,
  `eslint src --max-warnings=0` clean.

## What Is Still Open

- Risk lifecycle from the UI (update/link/close) — capture only, for now. The
  backend has no update/close endpoint yet either.
- Optimistic/mock-mode create: in dev `VITE_PROJECTS_MOCK` mode the POST hits the
  live backend and surfaces its error if unreachable; there is no fixture fallback
  for creation (read paths still fall back to fixtures).

## Next Actions

1. Add `PATCH`/close endpoints + lifecycle controls if operators need to manage
   risks (not just capture) from FlexDeck.
2. Consider extending `riskStatusTone` to color `identified`/`accepted` distinctly
   (currently both fall through to the neutral default tone).

## Context Links

- Prior backend slice: `.loom/42-slice-handoff-risk-capture-2026-06-29.md`
- Iteration plan: `.loom/31-iteration-plan-risk-capture-2026-06-29.md`
- Relevant docs/specs: `ROADMAP.md`, tracking issue #31
