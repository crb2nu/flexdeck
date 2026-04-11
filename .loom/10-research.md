# Research Brief — Reopened Planning Bundle Review And Next-Phase Pivot (2026-04-03)

## Problem Statement
The reopened planning stash was valuable context, but it no longer describes the project honestly in future tense. Most of what it proposed has now merged on `main`. The current task is therefore not to continue the March execution plan verbatim. It is to separate preserved useful intent from stale assumptions, then define the next execution slice from live gaps.

## Method
- Reviewed the reopened diff bundle on `codex/reopen-planning-baseline`.
- Compared the restored planning docs against the current `.loom` implementation/worklog state.
- Checked recent `main` history to confirm which planning goals are already merged.
- Performed a narrow code audit on the old API-sync concerns to see whether they still represent live work.
- Scanned current test coverage around Dashboard, FlexInfer, Agents, Models, and Pipeline surfaces to identify remaining confidence gaps.

Commands used:
- `git diff --stat`
- `git log --oneline --decorate -8`
- `sed -n '1,220p' .loom/00-index.md`
- `sed -n '1,260p' .loom/30-implementation-plan.md`
- `sed -n '1,260p' .loom/50-worklog.md`
- `rg -n "hostPath|compilationCache|flashLoader|maxBlockSize|swapSpace|reconfigureCooldown|reconfiguredAt|originalMaxNumSeqs|reconfiguredMaxNumSeqs|evictedAt|cache\.quantization|capabilities|quantize" internal/k8s/models_crd.go web/src/lib/types.ts`
- `rg -n "swap_signals|queued_requests_total|endpoint_changes_total|endpoint_count|routing_decisions_total|routing_target_hits_total|routing_key_cardinality|rate_limited_total|activation_retries_total|activation_failures_total" internal/api/handlers/flexinfer_proxy.go`
- `rg -n "expires_at|expiresAt|updated_at|updatedAt|FileClaim" internal/api/handlers/hud_contracts.go web/src/lib/types.ts`
- `rg --files web/src | rg '\.test\.(ts|tsx)$' | sort | rg 'AppLayout|Dashboard|FlexInfer|Agents|Pipeline|Models'`

## Facts Found

### 1. The March operator-coherence plan is now merged work, not active backlog
- `main` already contains the FlexInfer/Loom operator-surface merge (`7e09dc0`) and both pipeline follow-up merges (`bf407f5`, `c13b1cd`). Command: `git log --oneline --decorate -8`
- Current `.loom` planning/worklog files already record the completion of:
  - shared operator-state vocabulary
  - shared FlexInfer summary ownership
  - legacy model-tab neutralization
  - component coverage additions for `AppLayout`, `HUDTab`, and `Workbench`
  - pipeline detail, trends, and history state alignment
- The reopened March research/spec docs therefore cannot remain the forward-looking plan without becoming misleading.

### 2. The old API-sync addendum is not the immediate next implementation slice anymore
- The repo-local FlexInfer model mirror and frontend types already contain the upstream-oriented fields that the March addendum called out, including cache, quantization, capability, and KV-cache fields. Command: `rg -n "hostPath|compilationCache|flashLoader|maxBlockSize|swapSpace|reconfigureCooldown|reconfiguredAt|originalMaxNumSeqs|reconfiguredMaxNumSeqs|evictedAt|cache\.quantization|capabilities|quantize" internal/k8s/models_crd.go web/src/lib/types.ts`
- The proxy metrics handler already knows about the newer additive counters/gauges from the addendum. Command: `rg -n "swap_signals|queued_requests_total|endpoint_changes_total|endpoint_count|routing_decisions_total|routing_target_hits_total|routing_key_cardinality|rate_limited_total|activation_retries_total|activation_failures_total" internal/api/handlers/flexinfer_proxy.go`
- HUD claim normalization already preserves `expiresAt` and falls back to it for `updatedAt` when upstream does not send a dedicated update timestamp. Command: `rg -n "expires_at|expiresAt|updated_at|updatedAt|FileClaim" internal/api/handlers/hud_contracts.go web/src/lib/types.ts`
- That means the addendum still matters as historical evidence, but not as an unexamined default build plan.

### 3. The most valuable preserved content is planning hygiene, not the old future-tense slice list
Useful preserved signals from the reopened bundle:
- canonical repo ID `services/flexdeck`
- explicit warning that `services-flexdeck` is stale
- cross-repo awareness that `flexinfer` and `loom-core` should be treated as dependency contracts, not guessed from memory
- the tiny `ROADMAP.md` issue-link tweak, which is still directionally helpful

Least useful preserved content:
- future-tense descriptions of work that has already merged
- the `server` binary artifact, which is not planning evidence and should not be shipped as part of a docs branch

### 4. The remaining gap is confidence and cleanup around orchestration surfaces
Current test inventory shows good coverage growth, but some higher-level orchestration files still do not have direct tests in the same way the newest FlexInfer/HUD/Pipeline slices now do. Command: `rg --files web/src | rg '\.test\.(ts|tsx)$' | sort | rg 'AppLayout|Dashboard|FlexInfer|Agents|Pipeline|Models'`

Notable examples without direct adjacent tests in the current inventory:
- `web/src/components/Dashboard/index.tsx`
- `web/src/components/Dashboard/TopologyGraph.tsx`
- `web/src/components/Agents/HUDActivityFeed.tsx`
- `web/src/components/Pipeline/usePipelineController.ts`

This suggests the next highest-value implementation work is likely one of:
- deeper controller/orchestration coverage
- a legacy-adapter end-state cleanup
- a small release-readiness/checklist hardening pass

### 5. This reopened branch is a planning branch, not a ready-to-ship code branch
- The branch still carries a reopened `ROADMAP.md` tweak and a binary `server` diff alongside the planning docs. Command: `git diff --stat`
- That is fine for review, but any future execution branch should intentionally keep or discard those artifacts rather than letting them ride along accidentally.

## Recommended Next Tracks

### Track A. Planning baseline reset
- Rewrite the restored March docs into present-tense archival context plus a current execution plan.
- Keep the repo-ID/runtime lessons, but clearly mark old runtime counts as carry-forward context rather than re-verified facts.

### Track B. Confidence depth on orchestration surfaces
- Add direct tests around `usePipelineController` action lifecycle, stale timers, and fallback paths.
- Add dashboard-shell coverage around `Dashboard/index.tsx` and any stateful summary/topology orchestration that still depends on multiple subsystems.
- Evaluate whether `HUDActivityFeed` needs direct rendering/empty/error state coverage.

### Track C. Legacy end-state cleanup
- Decide whether the retained compatibility adapters should remain intentionally permanent, or whether this is the right cycle to delete them once no import paths depend on them.

## Open Questions
- Is the next implementation slice primarily about higher-confidence tests, or do we want to use this branch only to finalize planning and then cut a fresh execution branch?
- Should the retained `ROADMAP.md` issue-link tweak be kept as part of this planning branch, or left out to keep planning-only commits scoped to `.loom/`?

## Sources
- `git diff --stat`
- `git log --oneline --decorate -8`
- `.loom/00-index.md`
- `.loom/30-implementation-plan.md`
- `.loom/50-worklog.md`
- `rg -n "hostPath|compilationCache|flashLoader|maxBlockSize|swapSpace|reconfigureCooldown|reconfiguredAt|originalMaxNumSeqs|reconfiguredMaxNumSeqs|evictedAt|cache\.quantization|capabilities|quantize" internal/k8s/models_crd.go web/src/lib/types.ts`
- `rg -n "swap_signals|queued_requests_total|endpoint_changes_total|endpoint_count|routing_decisions_total|routing_target_hits_total|routing_key_cardinality|rate_limited_total|activation_retries_total|activation_failures_total" internal/api/handlers/flexinfer_proxy.go`
- `rg -n "expires_at|expiresAt|updated_at|updatedAt|FileClaim" internal/api/handlers/hud_contracts.go web/src/lib/types.ts`
- `rg --files web/src | rg '\.test\.(ts|tsx)$' | sort | rg 'AppLayout|Dashboard|FlexInfer|Agents|Pipeline|Models'`
