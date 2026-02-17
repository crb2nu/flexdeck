# Implementation Plan — Reconciliation + Reliability-First Expansion

## Scope
- FlexDeck-only implementation in `/Users/cblevins/workspace/services/flexdeck`
- Reconciliation deliverables:
  - roadmap/docs/spec alignment
  - `.loom` context refresh
- Product deliverables:
  - Epic 1 + Epic 2 code changes
  - Epic 3 documentation/governance updates

## Milestones
1. **A — Reconciliation Artifacts**
   - Update roadmap status policy to include `Partial`.
   - Refresh `.loom` index/inventory/research.
   - Publish dated reconciliation report.
2. **B — Epic 1 Contract Hardening**
   - Normalize proxy metrics payload.
   - Extend inference endpoint reliability fields.
   - Update dashboard consumption contract.
3. **C — Epic 2 Feature Completion**
   - Add LoRA status in inference detail.
   - Add HUD claims + workflow cancel proxy/UI.
   - Add stale/live fallback indicators and dual-mode state.
4. **D — Epic 3 Governance Alignment**
   - README/config table alignment to actual env keys.
   - Add `/api/health` feature-flag truth-table references in docs.
5. **E — Validation + Handoff**
   - Run backend/frontend tests.
   - Record assumptions, dependencies, and unresolved risks.

## Implementation Steps
1. Backend API changes
   - `internal/api/handlers/flexinfer_proxy.go`
   - `internal/api/handlers/models_inference.go`
   - `internal/api/handlers/hud_proxy.go`
   - `internal/api/router.go`
2. Backend test additions
   - `internal/api/handlers/flexinfer_proxy_test.go`
   - `internal/api/handlers/models_inference_test.go`
   - `internal/api/handlers/hud_proxy_test.go`
3. Frontend contract and UX updates
   - `web/src/lib/types.ts`
   - `web/src/lib/api.ts`
   - `web/src/components/Dashboard/index.tsx`
   - `web/src/components/Models/InferenceTab.tsx`
   - `web/src/components/Agents/HUDTab.tsx`
   - `web/src/components/Agents/HUDActivityFeed.tsx`
4. Documentation reconciliation
   - `.loom/*` files listed in this cycle
   - `ROADMAP.md`
   - `README.md`
   - `docs/roadmap-reconciliation-2026-02-17.md`

## Test Plan
- Backend:
  - `go test ./internal/api/handlers/... ./internal/agents/... ./internal/k8s/...`
- Frontend:
  - `npm -C web run -s test`
- Manual checks:
  - Confirm `/api/flexinfer/proxy/metrics` includes legacy + normalized fields.
  - Confirm `/api/models/crd/{ns}/{name}/inference` returns additive reliability fields.
  - Confirm `/api/hud/claims` and `/api/hud/workflows/{id}/cancel` are reachable.
  - Confirm HUD tab indicates mode and stale fallback state.

## Rollout / Backout
- Rollout:
  - Deploy without changing feature-flag defaults.
  - Enable subsystems per existing env flags (`LOOM_HUD_*`, `RBAC_*`, etc.).
- Backout:
  - Revert deployment image.
  - Disable affected feature flags if immediate mitigation is needed.
  - No DB/schema migrations involved.

## Acceptance Criteria
- Roadmap/docs/specs are synchronized to shipped state.
- Data contract mismatch for dashboard inference is resolved.
- HUD claims/cancel and stale-state UX are present and functional.
- All listed test commands pass in repo baseline.

## Risks / Dependencies
- Upstream dependency:
  - Loom HUD endpoint availability for pull mode.
  - Prometheus scrape and metric family availability for FlexInfer proxy.
- Residual risk:
  - Push-only HUD mode has reduced data completeness.
  - Some metrics may remain zero when upstream series are absent.

## Sources
- `internal/api/router.go:221`
- `internal/api/router.go:308`
- `internal/api/handlers/flexinfer_proxy.go:136`
- `internal/api/handlers/models_inference.go:58`
- `internal/config/config.go:286`
- `web/src/components/Dashboard/index.tsx:95`
