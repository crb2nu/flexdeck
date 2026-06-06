# RALPH Iteration Plan

## Review

- Roadmap milestone: Technical Debt Remediation Plan, Wave 1.
- Spec section(s): `docs/tech-debt/2026-06-01-plan.md`, TD-020.
- Prior decisions to preserve: keep runtime handler behavior unchanged; add fake-backed tests for external integration contracts.

## Align

- Slice name: TD-020 integration handler coverage.
- Scope in: representative Flux and CI handler success/error/empty coverage; a small dynamic-client injection seam for Flux tests.
- Scope out: production handler refactors, K8s/PublicTopology fake API server coverage, enterprise enablement, frontend changes.
- Acceptance criteria: handlers package coverage rises meaningfully; key zero/low Flux and CI functions gain direct fake-backed tests; `go test ./...` stays green.
- Dependencies/blockers: none; dynamic Flux tests need an injectable `dynamic.Interface` factory because handlers build clients from REST config.

## Land

- Planned file areas: `internal/api/handlers/handlers.go`, `internal/api/handlers/flux.go`, `internal/api/handlers/flux_handlers_test.go`, `internal/api/handlers/ci_test.go`, `docs/tech-debt/2026-06-01-plan.md`.
- Implementation steps:
  1. Add defaulted dynamic-client factory on `Handler`.
  2. Route Flux dynamic client construction through the factory.
  3. Add fake dynamic-client Flux handler tests and fake GitLab CI handler tests.

## Prove

- Tests to run: `go test ./internal/api/handlers -cover`; `go test ./...`.
- Lint/static checks: covered by Go compile and formatting (`gofmt`).
- CI checks: not run from this local slice.

## Handoff/Harvest

- Docs to update: TD-020 outcome in `docs/tech-debt/2026-06-01-plan.md`; slice handoff in `.loom/42-slice-handoff-td-020-integration-handler-coverage.md`.
- Agent-context entries to add: decision for the Flux fake seam; finding for coverage delta and validation.
- Next-slice candidates: TD-023 observability/proxy fake-upstream tests, or a smaller K8s/PublicTopology fake API pass if TD-020 breadth is extended.
