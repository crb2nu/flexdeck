# Loom Context Pack

## Quick Links
- Workspace snapshot: `00-workspace-snapshot.md`
- MCP inventory: `00-mcp-inventory.md`
- Research: `10-research.md`
- Product spec: `20-product-spec.md`
- Implementation plan: `30-implementation-plan.md`
- Decisions: `40-decisions.md`
- Worklog: `50-worklog.md`

## Current Goal (2026-02-17)
- Reconcile roadmap/spec/docs against shipped FlexDeck code.
- Define the next reliability-first feature wave as three decision-complete epics:
  - Integration contract hardening
  - FlexInfer + Loom feature-completion surfaces
  - Rollout/governance alignment

## Current Status Summary
- Phase 3 integration routes and UI are implemented (`/api/flexinfer/*`, `/api/hud/*`, Models Inference/Catalog tabs, Agents HUD tab).
- Phase 4 capability exists behind feature flags:
  - Backend routes for RBAC/Audit/Multi-cluster
  - Admin UI tabs and cluster selector
- Remaining work is primarily:
  - Contract consistency and reliability metrics normalization
  - Completing HUD claims/cancel and stale-mode UX
  - Documentation and rollout alignment for feature-gated subsystems

## Success Criteria For This Cycle
- `.loom` pack reflects current shipped state and no longer treats Phase 3 as unplanned.
- Product spec and implementation plan are decision-complete for the next 3 epics.
- Roadmap uses `Partial` status for feature-gated capabilities that are implemented but not broadly enabled.
- README env vars match live config keys.

## Risks
- Metrics contract drift between backend and frontend can reintroduce silent dashboard misreporting.
- HUD pull endpoint reachability may vary across deployment topologies; push-only mode has narrower data coverage.
- Feature-flag defaults (`RBAC`, `AUDIT`, `MULTICLUSTER`) can hide shipped functionality if docs remain stale.

## Sources
- `internal/api/router.go:221`
- `internal/api/router.go:308`
- `web/src/components/Models/InferenceTab.tsx:1`
- `web/src/components/Agents/HUDTab.tsx:1`
- `internal/config/config.go:286`
