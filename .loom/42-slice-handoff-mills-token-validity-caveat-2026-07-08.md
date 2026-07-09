# RALPH Slice Handoff

## Slice Summary

- Milestone: Loom control-plane stabilization and Mills enablement follow-through (#31).
- Slice: Mills admin-token validity caveat.
- Status: complete

## What Landed

- `/api/health` now includes a `reason` on enabled `loom_control_plane_mutations`
  clarifying that `LOOM_MILLS_ADMIN_TOKEN` is configured, but operator token
  validity is verified on the first mutation.
- The Mills readiness row surfaces that backend reason for admins when controls
  are enabled.
- The roadmap now distinguishes configured controls from a true read-only
  upstream token-validity probe.

## What Is Still Open

- The production enablement decision remains pending: configure the admin token
  and flip `LOOM_MILLS_MUTATIONS_ENABLED`, or keep the controls dark-launched.
- A true proactive token-validity probe requires a non-mutating admin-check
  endpoint in `loom-mills-operator`; current protected Mills routes are mutating
  POSTs.

## Validation

- `go test ./internal/api/handlers`
- `npm -C web run test -- --run src/components/Loom/Mills/index.test.tsx`
- `npm -C web run typecheck`
