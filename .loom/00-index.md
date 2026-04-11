# Loom Context Pack

## Current Goal (2026-04-03)
- Convert the reopened planning stash into a current execution baseline instead of carrying pre-merge assumptions forward.
- Treat the operational-coherence wave as completed merged work, then define the next highest-value slice from live gaps.
- Keep planning artifacts truthful about what is historical context, what is already shipped on `main`, and what is still only a candidate.

## Current Status Summary (2026-04-03)
- `main` is at `67d2cd6`, which already includes the FlexInfer/Loom operator-surface merge and both follow-on pipeline state merges. Command: `git log --oneline --decorate -8`
- The March 28 planning bundle preserved strong direction, but its primary objectives are now complete on `main`:
  - shared operator-state vocabulary for Dashboard, FlexInfer, and Loom HUD
  - shared FlexInfer summary/data ownership
  - legacy model tabs neutralized as thin adapters
  - pipeline detail, trends, and history aligned to the same state language
- The older API-sync addendum is no longer a good "next slice" by default because the specific CRD, proxy-metric, and HUD-claim gaps it identified are already represented in the current repo-local code. Commands: `rg -n "hostPath|compilationCache|flashLoader|maxBlockSize|swapSpace|reconfigureCooldown|reconfiguredAt|originalMaxNumSeqs|reconfiguredMaxNumSeqs|evictedAt|cache\.quantization|capabilities|quantize" internal/k8s/models_crd.go web/src/lib/types.ts`, `rg -n "swap_signals|queued_requests_total|endpoint_changes_total|endpoint_count|routing_decisions_total|routing_target_hits_total|routing_key_cardinality|rate_limited_total|activation_retries_total|activation_failures_total" internal/api/handlers/flexinfer_proxy.go`, `rg -n "expires_at|expiresAt|updated_at|updatedAt|FileClaim" internal/api/handlers/hud_contracts.go web/src/lib/types.ts`
- The most useful preserved facts from the reopened bundle are still:
  - canonical codebase-memory repo ID `services/flexdeck`
  - stale alias `services-flexdeck`
  - the reminder to verify upstream `flexinfer` / `loom-core` contracts before assuming parity work is needed
- The freshest actionable gap is confidence and cleanup rather than architecture reinvention:
  - some high-churn orchestration files still lack direct component/controller tests
  - the retained legacy adapters still need an eventual end-state decision
  - the reopened planning branch still carries a tiny `ROADMAP.md` tweak plus a `server` binary artifact that should not be mistaken for plan work

## Quick Links
- Workspace snapshot: `00-workspace-snapshot.md`
- MCP inventory: `00-mcp-inventory.md`
- Research: `10-research.md`
- Product spec: `20-product-spec.md`
- Implementation plan: `30-implementation-plan.md`
- Decisions: `40-decisions.md`
- Worklog: `50-worklog.md`
- Roadmap reconciliation note: `../docs/roadmap-reconciliation-2026-04-02.md`

## Success Criteria For This Cycle
- The reopened planning docs describe merged work in past tense and stop presenting completed slices as pending execution.
- The next slice is selected from live, evidenced gaps rather than from stale pre-merge assumptions.
- The planning branch is clearly scoped to docs/governance and does not accidentally carry build artifacts into future execution work.
- Future sessions can resume from `.loom/` without re-litigating which March concerns are already solved.

## Risks
- Historical planning context can accidentally become pseudo-backlog if completed work is not explicitly archived as done.
- The preserved `server` binary and small `ROADMAP.md` tweak could leak into a future planning commit unless handled intentionally.
- If we pick the next slice without a live gap audit, we risk re-implementing work that already landed.

## Sources
- `git log --oneline --decorate -8`
- `.loom/30-implementation-plan.md`
- `.loom/50-worklog.md`
- `rg -n "hostPath|compilationCache|flashLoader|maxBlockSize|swapSpace|reconfigureCooldown|reconfiguredAt|originalMaxNumSeqs|reconfiguredMaxNumSeqs|evictedAt|cache\.quantization|capabilities|quantize" internal/k8s/models_crd.go web/src/lib/types.ts`
- `rg -n "swap_signals|queued_requests_total|endpoint_changes_total|endpoint_count|routing_decisions_total|routing_target_hits_total|routing_key_cardinality|rate_limited_total|activation_retries_total|activation_failures_total" internal/api/handlers/flexinfer_proxy.go`
- `rg -n "expires_at|expiresAt|updated_at|updatedAt|FileClaim" internal/api/handlers/hud_contracts.go web/src/lib/types.ts`
- `git diff --stat`
