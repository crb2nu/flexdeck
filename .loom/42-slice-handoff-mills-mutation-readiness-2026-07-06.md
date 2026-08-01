# RALPH Slice Handoff

> Correction (2026-08-01): loom-core commit `2971df9b` already exposed the
> admin-gated `POST /api/mills/squads/{name}/route-test` diagnostic dry-run.
> FlexDeck still does not proxy it. The original handoff below overstated the
> operator limitation at this slice's closeout.

## Slice Summary

- Milestone: Loom control-plane stabilization and enablement follow-through.
- Slice: Mills mutation readiness contract.
- Status: complete

## What Landed

- Key changes:
  - `/api/health` now publishes `mode` and `reason` on `loom_control_plane_mutations` so operators can distinguish disabled operator, dark-launch flag off, missing admin token, and ready states.
  - The Mills surface renders a compact mutation-readiness row in Overview and Policy.
  - Existing mutation controls remain hidden unless the backend flag is enabled and the signed-in user is an admin.
  - `ROADMAP.md` now records that Stack pod failure reasons plus Jobs/CronJobs already shipped, and narrows the Mills enablement item to the remaining token/flag decision.
- Key files:
  - `internal/api/handlers/health.go`
  - `internal/api/handlers/health_test.go`
  - `web/src/lib/featureFlags.ts`
  - `web/src/stores/health.ts`
  - `web/src/components/Loom/Mills/index.tsx`
  - `web/src/components/Loom/Mills/index.test.tsx`
  - `ROADMAP.md`
  - `.loom/40-decisions.md`
- Validation results:
  - `go test ./internal/api/handlers` passed
  - `npm -C web run test -- --run src/components/Loom/Mills/index.test.tsx` passed (5/5)
  - `npm -C web run typecheck` passed

## What Is Still Open

- The production enablement decision is still pending: configure `LOOM_MILLS_ADMIN_TOKEN` and flip `LOOM_MILLS_MUTATIONS_ENABLED`, or keep the controls dark-launched.
- Upstream admin-token validity is not proactively probed; it is still proven on mutation attempt.
- Audit Logs / Multi-Cluster enablement decisions remain separate roadmap items.

## Next Actions

1. Decide whether the current Mills operator policy is ready for production writes.
2. If yes, configure the admin token, flip the mutation flag, and verify an admin-only pause/resume smoke test.
3. Consider adding a read-only upstream token-validity probe if operators need preflight confidence before enabling writes.

## Context Links

- Agent-context session: `0a7c7bdb2ea6a187`
- Task IDs: created in agent context during this slice
- Relevant docs/specs:
  - `.loom/31-iteration-plan-mills-mutation-readiness-2026-07-06.md`
  - `.loom/31-iteration-plan-loom-control-plane-2026-06-30.md`
  - `ROADMAP.md`
