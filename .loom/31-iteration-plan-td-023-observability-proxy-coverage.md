# RALPH Iteration Plan

## Review

- Roadmap milestone: Technical Debt Remediation Plan, Wave 2.
- Spec section(s): `docs/tech-debt/2026-06-01-plan.md`, TD-023.
- Prior decisions to preserve: use fake upstreams and guard-path tests only; avoid production behavior changes.

## Align

- Slice name: TD-023 observability/proxy coverage.
- Scope in: LiteLLM health/models/router, vLLM models/health/completions, Grafana dashboard detail/datasources, ModelCache no-K8s guards.
- Scope out: metric-store-backed LiteLLM metrics, Loki SSE/export success, Langfuse aggregation branches, fake-K8s ModelCache success paths.
- Acceptance criteria: observability/proxy zero-coverage handlers gain deterministic tests; `internal/api/handlers` coverage rises; `go test ./...` stays green.
- Dependencies/blockers: deeper ModelCache coverage needs fake Kubernetes CRD/list/watch/log plumbing.

## Land

- Planned file areas: `internal/api/handlers/*_handlers_test.go`, `internal/api/handlers/grafana_test.go`, `docs/tech-debt/2026-06-01-plan.md`.
- Implementation steps:
  1. Add LiteLLM fake-upstream handler tests.
  2. Add vLLM fake-upstream and disabled/missing-param tests.
  3. Add Grafana detail/datasources tests and ModelCache no-K8s guard tests.

## Prove

- Tests to run: `go test ./internal/api/handlers -cover`; `go test ./...`.
- Lint/static checks: covered by Go compile and formatting (`gofmt`).
- CI checks: run after MR creation.

## Handoff/Harvest

- Docs to update: TD-023 outcome in `docs/tech-debt/2026-06-01-plan.md`; slice handoff in `.loom/42-slice-handoff-td-023-observability-proxy-coverage.md`.
- Agent-context entries to add: finding for coverage delta and remaining TD-023 work.
- Next-slice candidates: complete TD-023 with fake-K8s ModelCache success/error coverage or Langfuse/Loki deeper fake-upstream paths.
