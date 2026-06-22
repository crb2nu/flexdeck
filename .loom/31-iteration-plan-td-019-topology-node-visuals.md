# RALPH Iteration Plan

## Review

- Roadmap milestone: Technical Debt Remediation Plan, Wave 3.
- Spec section(s): `docs/tech-debt/2026-06-01-plan.md`, TD-019.
- Prior decisions to preserve: keep topology runtime behavior unchanged; make extraction-only changes with adjacent tests; keep `npm run perf:topology` within the large-scenario budget.

## Align

- Slice name: TD-019 topology node visuals extraction.
- Scope in: extract node visual/style helpers from `TopologyGraph.tsx` into a pure topology module; add adjacent unit coverage; keep existing canvas sprite and render paths intact.
- Scope out: renderer rewrite, simulation changes, HoloDeck changes, new topology UI features.
- Acceptance criteria: one cohesive concern is extracted with tests; normal frontend test/lint/typecheck/build checks pass; `npm run perf:topology` large scenario stays at or below the 193.9ms budget.
- Dependencies/blockers: none.

## Land

- Planned file areas: `web/src/components/Dashboard/TopologyGraph.tsx`, `web/src/components/Dashboard/topology/nodeVisuals.ts`, `web/src/components/Dashboard/topology/nodeVisuals.test.ts`, `web/src/test/setup.ts`, `web/vite.config.ts`, `docs/tech-debt/2026-06-01-plan.md`.
- Implementation steps:
  1. Move node color/radius/icon/truncated-label style-cache logic into `nodeVisuals.ts`.
  2. Cover visual helpers and cache refresh behavior with Vitest.
  3. Stabilize Vitest `localStorage` for Node 26 so the normal frontend suite stays green.

## Prove

- Tests to run: `npm run test`; `npm run typecheck`; `npm run lint`; `npm run build`; `npm run perf:topology`.
- CI checks: run after pushing this branch.

## Handoff/Harvest

- Docs to update: TD-019 outcome in `docs/tech-debt/2026-06-01-plan.md`; slice handoff in `.loom/42-slice-handoff-td-019-topology-node-visuals.md`.
- Agent-context entries to add: finding for the extraction and verification results.
- Next-slice candidates: extract spatial-grid hit testing or namespace aggregate rendering from `TopologyGraph.tsx`.
