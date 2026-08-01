# RALPH Iteration Plan

> Correction (2026-08-01): loom-core commit `2971df9b` already exposed the
> admin-gated `POST /api/mills/squads/{name}/route-test` diagnostic dry-run.
> FlexDeck still does not proxy it. The original plan below overstated the
> operator limitation at this slice's closeout.

## Review

- Roadmap milestone: Loom control-plane stabilization and enablement follow-through (#31, P2).
- Spec section(s): `.loom/31-iteration-plan-loom-control-plane-2026-06-30.md` slice 6, dark-launched Mills mutations.
- Prior decisions to preserve: Mills writes remain RBAC-admin gated, default-off by `LOOM_MILLS_MUTATIONS_ENABLED`, and require an upstream admin token before any browser control can mutate operator state.

## Align

- Slice name: Mills mutation readiness contract.
- Scope in:
  - expose non-secret readiness metadata on the existing `loom_control_plane_mutations` feature flag
  - distinguish disabled operator, dark-launch flag off, missing admin token, ready, and browser-user-not-admin states
  - render that readiness state in the Mills surface without revealing mutation controls to non-admins
  - cover backend feature metadata and frontend readiness rendering
- Scope out:
  - flipping `LOOM_MILLS_MUTATIONS_ENABLED`
  - adding new Mills mutating actions
  - exposing the admin token or probing token validity proactively
  - changing RBAC route policy
- Acceptance criteria:
  - `/api/health` still exposes `loom_control_plane_mutations.enabled`
  - disabled mutations include a `mode` and `reason` that explain the missing prerequisite
  - ready backend mutations still require an admin role in the UI before controls appear
  - Mills Overview and Policy surfaces show readiness text without rendering destructive controls when prerequisites are missing
- Dependencies/blockers:
  - readiness is configuration-based; upstream token validity is still proven only when a mutation is attempted

## Land

- Planned file areas:
  - `internal/api/handlers/health.go`
  - `internal/api/handlers/health_test.go`
  - `web/src/lib/featureFlags.ts`
  - `web/src/components/Loom/Mills/index.tsx`
  - `web/src/components/Loom/Mills/index.test.tsx`
  - `ROADMAP.md`
  - `.loom/42-slice-handoff-mills-mutation-readiness-2026-07-06.md`
- Implementation steps:
  1. Add a backend helper that builds the Mills mutation feature state with readiness metadata.
  2. Teach the Mills UI to render readiness labels and preserve existing admin-only controls.
  3. Add focused backend/frontend tests and update roadmap/handoff context.

## Prove

- Tests to run:
  - `go test ./internal/api/handlers`
  - `npm -C web run test -- --run src/components/Loom/Mills/index.test.tsx`
- Lint/static checks:
  - `npm -C web run typecheck`
- CI checks:
  - verify after push/MR if this slice is shipped from the worktree.

## Handoff/Harvest

- Docs to update:
  - `ROADMAP.md`
  - `.loom/42-slice-handoff-mills-mutation-readiness-2026-07-06.md`
- Agent-context entries to add:
  - finding: Stack pod reasons / Jobs-CronJobs roadmap item is already shipped on main
  - decision: Mills enablement remains explicit readiness metadata rather than enabling mutations
- Next-slice candidates:
  - operator-token validity probe surfaced as a read-only health check
  - Audit Logs / Multi-Cluster enablement readiness cards
