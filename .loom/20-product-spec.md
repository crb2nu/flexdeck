# Product Spec — Next-Wave FlexInfer + Loom Integration (Reliability-First)

## Summary
Define the next implementation wave as three ordered epics:
1. Integration contract hardening.
2. FlexInfer + Loom feature-completion surfaces.
3. Rollout/governance alignment.

Scope is FlexDeck-only; upstream repos are treated as dependency surfaces.

## Goals
1. Eliminate backend/frontend data-contract drift in inference metrics.
2. Complete key operator-visible integration surfaces (LoRA status, claims, workflow cancel, stale-state UX).
3. Align roadmap/docs with shipped feature-gated capabilities.

## Non-Goals
- Changing `flexinfer` or `loom-core` code.
- Introducing new external dependencies.
- Re-architecting existing FlexDeck cache/auth subsystems.

## Epic 1: Integration Contract Hardening (Priority 1)

### Requirements
- Extend `GET /api/flexinfer/proxy/metrics` with additive fields:
  - `byModel`
  - `totals`
  - `requestsByStatus`
  - `partial`
- Preserve existing legacy keys:
  - `requests`, `latency`, `queue_depth`, `active_conn`, `scale_ups`
- Correct parser behavior for `flexinfer_proxy_requests_total{model,status}` so values aggregate per status and per model.
- Extend `GET /api/models/crd/{namespace}/{name}/inference` with additive fields:
  - `errorRate`
  - `queueWaitP95Ms`
  - `rejectedRequestsPerSec`
  - `scaleUps5m`
  - `activationRetries5m`
  - `partial`
  - `missingMetrics`
- Partial degradation rule:
  - if one or more PromQL queries fail, return best-effort payload with `partial=true` and non-failing fields intact.

### API Contract Additions
- `FlexInferProxyMetricsResponse` (frontend):
  - `byModel: Record<string, FlexInferProxyModelMetrics>`
  - `totals: FlexInferProxyTotals`
  - `requestsByStatus: Record<string, Record<string, number>>`
  - `partial: boolean`
- `InferenceMetrics` (frontend):
  - existing fields + additive reliability fields listed above.

### Acceptance Criteria
- Dashboard inference card consumes normalized totals and no longer assumes `data.models`.
- Inference endpoint still returns valid response with all numeric fields defaulting to `0` when Prometheus returns empty vectors.
- Handler tests verify both legacy and normalized payload keys.

## Epic 2: FlexInfer + Loom Feature-Completion Surfaces (Priority 2)

### Requirements
- Show LoRA adapter state in inference model detail using existing endpoint:
  - `GET /api/models/lora/{namespace}/{name}`
- Inference table adds reliability columns:
  - error rate
  - queue wait p95
  - rejected requests/sec
  - retries (5m)
  - reliability badge (`Healthy|Degraded|Partial|Unknown`)
- Add HUD claims surface:
  - `GET /api/hud/claims` proxy + UI panel
- Add workflow cancel surface:
  - `POST /api/hud/workflows/{id}/cancel` proxy + UI action
- Stale-mode UX:
  - Activity feed shows live/connecting/poll-fallback state.
  - HUD panel shows stale warning when SSE is stale or pull polling freshness exceeds threshold.
- Preserve dual-mode behavior:
  - Pull mode (full HUD surface via `LOOM_HUD_URL`)
  - Push mode (presence snapshots via agents endpoint when pull unavailable)

### Acceptance Criteria
- Claims panel renders when pull mode is enabled and claims are available.
- Workflow cancel action invokes backend proxy and refreshes workflow state.
- HUD view visibly indicates mode (`pull` vs `push`) and stale fallback state.
- LoRA adapters render in model detail without adding new backend dependencies.

## Epic 3: Rollout + Governance Alignment (Priority 3)

### Requirements
- Roadmap status policy:
  - use `Partial` for implemented-but-feature-gated capabilities (RBAC/Audit/Multi-cluster and partially completed integration surfaces).
- `/api/health` contract documentation:
  - explicitly map `loom_hud`, `loom_hud_push`, `rbac`, `audit`, `multi_cluster` to UI behavior.
- Config docs alignment:
  - document actual env var names from `internal/config/config.go`.
- Operator checklist:
  - per-subsystem enablement checks for staging/prod-like rollout.
- Dependency register:
  - list upstream API/metric families FlexDeck assumes.

### Acceptance Criteria
- `ROADMAP.md`, `.loom` docs, and `README.md` no longer disagree about subsystem status or env keys.
- Reconciliation report for 2026-02-17 captures changed statuses and rationale.

## Test Scenarios
1. Parser test: multiple status samples aggregate correctly.
2. Handler test: proxy metrics payload includes both legacy and normalized sections.
3. Handler test: inference payload additive fields default to zero on empty Prometheus result.
4. Handler test: HUD claims + cancel proxies forward correctly.
5. Frontend: inference table/badge rendering for normalized + partial data.
6. Frontend: HUD claims rendering and workflow cancel action.
7. Frontend: stale/live/poll-fallback indicator behavior.
8. Integration: feature flags control admin/nav/HUD modes as expected.

## Sources
- `internal/api/router.go:221`
- `internal/api/router.go:308`
- `internal/api/handlers/flexinfer_proxy.go:136`
- `internal/api/handlers/models_inference.go:58`
- `internal/api/handlers/hud_proxy.go:73`
- `web/src/components/Dashboard/index.tsx:95`
- `web/src/components/Models/InferenceTab.tsx:1`
- `web/src/components/Agents/HUDTab.tsx:1`
- `internal/config/config.go:286`
