# Research Brief — Roadmap Reconciliation + Next-Wave Epics (2026-02-17)

## Problem Statement
Planning artifacts still describe Phase 3 as prospective work, but the codebase already includes substantial FlexInfer and Loom HUD integration. This created drift across roadmap/spec/docs and masked the real next step: reliability hardening and feature-completion.

## Method
- Inspected FlexDeck backend routes/handlers and frontend tabs.
- Cross-checked upstream integration surfaces in local `flexinfer` and `loom-core` repos.
- Validated baseline test status for backend and frontend.

Commands used:
- `rg -n "flexinfer|hud|claims|workflow|inference|rbac|audit|cluster" internal web/src -S`
- `go test ./internal/api/handlers/... ./internal/agents/... ./internal/k8s/...`
- `npm -C web run -s test`
- `rg -n "flexinfer_proxy_|/api/claims|/api/workflows/{id}/cancel" /Users/cblevins/workspace/services/flexinfer /Users/cblevins/workspace/services/loom-core -S`

## Current-State Audit

### Code-vs-Roadmap Matrix
| Area | Roadmap Before Reconciliation | Code Reality | Gap Type |
|---|---|---|---|
| Phase 3 FlexInfer + HUD integration | Marked complete in roadmap, but older `.loom` docs still treated as planning scope | Routes + UI implemented (`/api/flexinfer/*`, `/api/hud/*`, Models Inference/Catalog, Agents HUD) | Documentation drift |
| Dashboard inference widget contract | Assumed `data.models` shape | Backend returned legacy category maps; normalized contract absent | Data contract mismatch |
| LoRA visibility | Listed as delivered | LoRA endpoint existed but was not consumed in inference-focused UI | Feature completion gap |
| HUD claims/cancel operations | Available upstream | Not proxied in FlexDeck HUD API | Surface coverage gap |
| Phase 4 (RBAC/Audit/Multi-cluster) | Marked not started | Backend routes and admin UI exist behind flags | Status policy drift |

### FlexDeck Findings
- FlexInfer + HUD route surface in backend:
  - `internal/api/router.go:221`
  - `internal/api/router.go:227`
- Models APIs include CRD inference + LoRA + catalogs:
  - `internal/api/router.go:252`
  - `internal/api/router.go:254`
  - `internal/api/router.go:255`
- Phase 4 APIs are implemented behind feature flags:
  - `internal/api/router.go:308`
  - `internal/api/router.go:325`
  - `internal/api/router.go:333`
- Dashboard inference consumed a mismatched schema:
  - `web/src/components/Dashboard/index.tsx:95`
  - `internal/api/handlers/flexinfer_proxy.go:136`
- Admin UI exists and is feature-gated:
  - `web/src/components/Admin/index.tsx:9`

### Upstream Delta (FlexDeck-only scope)
- `loom-core` currently exposes additional HUD endpoints that FlexDeck can proxy:
  - `/api/claims` and `/api/workflows/{id}/cancel`
  - Source: `/Users/cblevins/workspace/services/loom-core/internal/hud/app.go:488`, `/Users/cblevins/workspace/services/loom-core/internal/hud/app.go:481`
- `flexinfer` exposes reliability-relevant proxy metrics beyond currently normalized FlexDeck usage:
  - `flexinfer_proxy_queue_rejected_total`
  - `flexinfer_proxy_queue_wait_duration_seconds`
  - `flexinfer_proxy_activation_retries_total`
  - Source: `/Users/cblevins/workspace/services/flexinfer/internal/proxy/metrics.go:44`, `/Users/cblevins/workspace/services/flexinfer/internal/proxy/metrics.go:52`, `/Users/cblevins/workspace/services/flexinfer/internal/proxy/metrics.go:129`

## Validation Snapshot
- Backend tests: pass (`go test ./internal/api/handlers/... ./internal/agents/... ./internal/k8s/...`)
- Frontend tests: pass (`npm -C web run -s test`)

## Key Conclusions
1. The next cycle should not re-plan Phase 3; it should harden and complete it.
2. Reliability-first ordering is justified by an existing backend/frontend contract mismatch and partial observability.
3. Phase 4 should be represented as `Partial` rather than `Not started` because implementation exists behind flags.

## Sources
- `ROADMAP.md:87`
- `internal/api/router.go:221`
- `internal/api/router.go:308`
- `internal/api/handlers/flexinfer_proxy.go:136`
- `web/src/components/Dashboard/index.tsx:95`
- `web/src/lib/api.ts:536`
- `web/src/components/Admin/index.tsx:9`
- `internal/config/config.go:286`
- `/Users/cblevins/workspace/services/loom-core/internal/hud/app.go:476`
- `/Users/cblevins/workspace/services/flexinfer/internal/proxy/metrics.go:10`
