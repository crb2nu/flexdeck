# Decisions

Record decisions as they are made, with date, rationale, and sources.

## Template

### YYYY-MM-DD: Decision title

- Decision:
- Rationale:
- Alternatives considered:
- Consequences:
- Sources:
  - [S1] ...

---

### 2026-02-16: Phase 3 scope — Full integration (FlexInfer + Loom)

- Decision: Implement both FlexInfer inference metrics (Track 1) and Loom Agent HUD (Track 2) in Phase 3, rather than splitting across phases.
- Rationale: The two tracks touch completely different handler files and frontend components (Models page vs Agents page). Both use established patterns (cache-aside, feature flags). Combining them maximizes dashboard value per release without conflicting code changes.
- Alternatives considered:
  - Option B: FlexInfer only (defers agent visibility, lower value)
  - Option C: Loom HUD only (defers operationally useful inference metrics)
- Consequences: Larger scope (~14 backend handlers, ~6 new frontend components), but no additional architectural complexity. Both tracks are feature-flagged independently.
- Sources:
  - [S1] `.loom/10-research.md` — exploration findings from flexinfer and loom-core codebases
  - [S2] `.loom/20-product-spec.md` — product specification with endpoint table

### 2026-02-16: FlexInfer proxy metrics via Prometheus, not direct scraping

- Decision: Query FlexInfer proxy metrics through the existing Prometheus instance rather than scraping the proxy `/metrics` endpoint directly.
- Rationale: FlexDeck already has a Prometheus query client (`internal/metrics/`). Using PromQL queries (e.g., `rate(flexinfer_proxy_requests_total{model="..."}[5m])`) gives aggregated, time-series data suitable for sparkline charts. Direct scraping would only give point-in-time counters.
- Alternatives considered: Direct HTTP scrape of proxy `/metrics` endpoint (simpler but loses time-series).
- Consequences: Requires Prometheus to be scraping the FlexInfer proxy ServiceMonitor. Adds dependency on Prometheus availability, but FlexDeck already depends on it for other metrics.
- Sources:
  - [S1] `internal/metrics/scraper.go` — existing Prometheus client pattern
  - [S2] `flexinfer/internal/proxy/metrics.go` — proxy metrics exported

### 2026-02-16: Loom HUD integration via HTTP proxy, not direct MCP calls

- Decision: FlexDeck backend proxies Loom HUD REST API endpoints rather than making MCP tool calls directly to loom-core.
- Rationale: The HUD REST API is a stable, well-documented HTTP interface with 100+ endpoints already consumed by the Svelte frontend. MCP tool calls require a daemon socket connection and complex marshaling. HTTP proxying fits FlexDeck's existing handler pattern perfectly.
- Alternatives considered: Direct MCP tool calls via loom daemon socket (more complex, fragile).
- Consequences: Requires HUD to be running and reachable from FlexDeck. Feature flag + health check mitigates unavailability.
- Sources:
  - [S1] `services/loom-core/internal/hud/app.go` — HUD route registration
  - [S2] `internal/agents/hud.go` — existing HUD client in FlexDeck

### 2026-02-17: Normalize proxy metrics contract while preserving legacy keys

- Decision: Extend `/api/flexinfer/proxy/metrics` with additive normalized fields (`byModel`, `totals`, `requestsByStatus`, `partial`) and keep legacy response keys untouched.
- Rationale: Dashboard and model UIs were consuming inconsistent shapes. Additive normalization fixes contract drift without breaking existing clients.
- Alternatives considered:
  - Replace legacy payload entirely (breaking change risk).
  - Only fix frontend assumptions (leaves backend contract ambiguous).
- Consequences: Slightly larger payload, but explicit schema and backward compatibility.
- Sources:
  - [S1] `internal/api/handlers/flexinfer_proxy.go`
  - [S2] `web/src/components/Dashboard/index.tsx`

### 2026-02-17: Mark feature-gated shipped capabilities as Partial in roadmap

- Decision: Use `Partial` status for capabilities implemented in code but disabled by default or not fully enabled across deployments.
- Rationale: Binary done/not-done states were misleading for RBAC, Audit, Multi-cluster, and some integration surfaces.
- Alternatives considered:
  - Mark complete immediately (hides rollout reality).
  - Keep unchecked until broad rollout (hides engineering progress).
- Consequences: Roadmap communicates implementation and rollout state separately.
- Sources:
  - [S1] `internal/api/router.go`
  - [S2] `web/src/components/Admin/index.tsx`
  - [S3] `ROADMAP.md`

### 2026-02-17: Keep this cycle FlexDeck-only and track upstream expectations as dependencies

- Decision: Implement only FlexDeck changes; treat `flexinfer` and `loom-core` APIs as dependency contracts.
- Rationale: The requested scope is repository-local and can deliver immediate value without cross-repo coordination latency.
- Alternatives considered:
  - Cross-repo change set in same cycle (higher coordination cost and risk).
- Consequences: Some potential enhancements remain dependency items rather than immediate implementation.
- Sources:
  - [S1] `.loom/10-research.md`
  - [S2] `.loom/20-product-spec.md`

### 2026-03-03: Prioritize polish and coherence over net-new subsystem scope

- Decision: The next wave will focus on UX/state coherence across Pipeline, Grafana, Dashboard/mobile, and delivery workflows, rather than launching additional subsystem surfaces.
- Rationale: Recent commits show substantial capability delivery; the highest value now is reducing operator ambiguity and regression risk in high-touch interfaces.
- Alternatives considered:
  - Expand into new backend feature areas (higher scope and risk, lower immediate operator impact).
  - Continue only documentation reconciliation (insufficient product value by itself).
- Consequences: Workstream planning centers on consistency, feedback clarity, and verification loops; success is measured by reduced ambiguity and smoother operations.
- Sources:
  - [S1] `.loom/10-research.md`
  - [S2] `.loom/20-product-spec.md`
  - [S3] `ROADMAP.md`

### 2026-03-03: Use local evidence workflow while semantic index path is unavailable

- Decision: Treat semantic codebase-memory indexing as temporarily unavailable and use local deterministic inspection (`rg`, `nl`, `git log`) for planning evidence.
- Rationale: `codebase_memory__codebase_stats` currently fails due Qdrant route failure; waiting for index recovery would block planning progress.
- Alternatives considered:
  - Block planning until index services recover.
  - Proceed with assumptions without evidence (rejected).
- Consequences: Planning remains evidence-backed but uses command/file references instead of semantic index traversal for this cycle.
- Sources:
  - [S1] `.loom/00-mcp-inventory.md`
  - [S2] `codebase_memory__codebase_stats(repo_id="services-flexdeck")`

### 2026-03-28: Prioritize operational coherence and FlexInfer consolidation over net-new features

- Decision: The next enhancement round should focus on shared state semantics, FlexInfer data consolidation, and regression coverage rather than introducing another major surface.
- Rationale: The recent workbench/HUD shipment changed the primary operator surfaces, but the remaining debt is mostly coherence debt: different state vocabularies, duplicated data ownership, orphaned legacy model views, and light component coverage.
- Alternatives considered:
  - Launch another feature slice immediately (higher novelty, lower immediate usability payoff).
  - Do governance/docs only (improves bookkeeping but not operator experience).
- Consequences: The next coding cycle will likely be frontend-heavy and architecture-oriented, with smaller user-visible wins per PR but better long-term maintainability and operator trust.
- Sources:
  - [S1] `.loom/10-research.md`
  - [S2] `.loom/20-product-spec.md`
  - [S3] `git show --stat --summary 7081375`
  - [S4] `git show --stat --summary 5314331`

### 2026-03-28: Use `services/flexdeck` as the canonical codebase-memory repo ID

- Decision: Standardize future planning and codebase-memory queries on `repo_id="services/flexdeck"` for this repository.
- Rationale: The older alias `services-flexdeck` now returns zero chunks, while `services/flexdeck` returns the active index with 1952 chunks.
- Alternatives considered:
  - Continue probing both IDs every session (wastes time and risks stale assumptions).
  - Keep using the stale alias in docs for historical continuity (incorrect operationally).
- Consequences: Existing `.loom` references to `services-flexdeck` should be treated as historical artifacts and updated opportunistically.
- Sources:
  - [S1] `codebase_memory__codebase_stats(repo_id="services/flexdeck")`
  - [S2] `codebase_memory__codebase_stats(repo_id="services-flexdeck")`

### 2026-04-02: Treat `disabled` and `fallback` as first-class operator states

- Decision: Promote `disabled` and `fallback` to explicit shared operator states across Dashboard, FlexInfer, and Loom HUD instead of collapsing them into generic stale/offline wording.
- Rationale: Operators need to distinguish "feature intentionally unavailable" from "data path degraded" without reading implementation-specific text. The previous vocabulary drift made Dashboard, Workbench, and HUD disagree about materially different situations.
- Alternatives considered:
  - Keep per-surface status wording and only harmonize badge styling.
  - Map everything degraded into `stale`/`offline` to reduce vocabulary size.
- Consequences: Shared freshness/state helpers carry a slightly richer contract, but the surfaces now speak the same language and tests can assert those states directly.
- Sources:
  - [S1] `web/src/lib/freshness.ts`
  - [S2] `web/src/components/Dashboard/statusSemantics.ts`
  - [S3] `web/src/components/Agents/hudDegradedMode.ts`
  - [S4] `web/src/components/Agents/HUDTab.tsx`

### 2026-04-02: Retain legacy model tabs as thin adapters over the workbench

- Decision: Keep legacy `InferenceTab`, `ProxyTab`, and `PipelinesTab` as compatibility adapters that render the canonical FlexInfer workbench instead of deleting them outright.
- Rationale: The old files were no longer mounted, but they still represented potential future import points. Replacing their polling/API logic with thin adapters removes drift risk now without forcing a hard cleanup decision in the same slice.
- Alternatives considered:
  - Delete the legacy files immediately and fix any breakage later.
  - Leave the legacy files untouched until a bigger cleanup phase.
- Consequences: Compatibility remains available, but the repo no longer has two separate operational implementations for the same FlexInfer facts.
- Sources:
  - [S1] `web/src/components/Models/LegacyWorkbenchAdapter.tsx`
  - [S2] `web/src/components/Models/InferenceTab.tsx`
  - [S3] `web/src/components/Models/ProxyTab.tsx`
  - [S4] `web/src/components/Models/PipelinesTab.tsx`

### 2026-04-03: Treat the March operator-coherence plan as completed history, not active backlog

- Decision: Reframe the reopened March planning bundle as archived rationale plus carry-forward context, and build the next plan from current April evidence instead of from the old future-tense slice list.
- Rationale: The central March objectives have already merged on `main` through the FlexInfer/Loom operator-surface and pipeline state-alignment slices. Leaving the old docs in future tense would create false backlog and invite redundant work.
- Alternatives considered:
  - Keep the March plan mostly intact and simply add notes that some parts shipped.
  - Delete the old planning context entirely.
- Consequences: The planning docs become more accurate and easier to resume from, but they now explicitly distinguish historical context from active execution intent.
- Sources:
  - [S1] `git log --oneline --decorate -8`
  - [S2] `.loom/30-implementation-plan.md`
  - [S3] `.loom/50-worklog.md`

### 2026-04-03: Do not use the old API-sync addendum as the default next implementation slice without fresh drift evidence

- Decision: Keep the March API-sync addendum as historical context, but do not treat it as the active next build plan unless a fresh audit shows new drift.
- Rationale: The specific CRD, proxy-metric, and HUD-claim gaps named in the addendum are already represented in the current repo-local code, so reheating that plan would spend effort rediscovering solved work.
- Alternatives considered:
  - Continue with the API-sync slice anyway for completeness.
  - Delete the addendum entirely.
- Consequences: The next slice selection shifts toward confidence and cleanup work, while preserving the addendum as a useful audit pattern for future upstream parity checks.
- Sources:
  - [S1] `rg -n "hostPath|compilationCache|flashLoader|maxBlockSize|swapSpace|reconfigureCooldown|reconfiguredAt|originalMaxNumSeqs|reconfiguredMaxNumSeqs|evictedAt|cache\.quantization|capabilities|quantize" internal/k8s/models_crd.go web/src/lib/types.ts`
  - [S2] `rg -n "swap_signals|queued_requests_total|endpoint_changes_total|endpoint_count|routing_decisions_total|routing_target_hits_total|routing_key_cardinality|rate_limited_total|activation_retries_total|activation_failures_total" internal/api/handlers/flexinfer_proxy.go`
  - [S3] `rg -n "expires_at|expiresAt|updated_at|updatedAt|FileClaim" internal/api/handlers/hud_contracts.go web/src/lib/types.ts`

### 2026-06-06: Start local-stack support with read-only workspace inventory

- Decision: Begin the services/libs local-stack program with a read-only repository inventory API instead of UI, process control, or cross-repo configuration changes.
- Rationale: The new brainstorm's load-bearing assumption is that FlexDeck can derive useful metadata from `WORKSPACE_DIR/services` and `WORKSPACE_DIR/libs` safely. A backend scanner proves that assumption with the least blast radius and creates a stable foundation for the future Stack Explorer.
- Alternatives considered:
  - Build the Stack Explorer UI first (higher UX payoff, but risks anchoring on unproven scanner data).
  - Add local dev process controls first (faster daily loop, but unsafe without explicit repo config and audit semantics).
  - Start with library contract drift (valuable, but less directly tied to FlexDeck's current K8s/Flux/CI/HUD strengths).
- Consequences: The first slice is backend-heavy and read-only. Future slices can add UI and service-to-cluster binding once the scanner output is proven useful.
- Sources:
  - [S1] `.loom/brainstorm-local-stack-services-libs-2026-06-06.md`
  - [S2] `.loom/31-iteration-plan-local-stack-inventory-kill-test-2026-06-06.md`
  - [S3] `internal/workspace/inventory.go`

### 2026-06-06: Ship Stack Explorer as a read-only route over workspace inventory

- Decision: Add `/stack` as a first-class FlexDeck route that consumes `GET /api/workspace/repos` and renders searchable, grouped service/lib cards with local readiness summaries.
- Rationale: The backend inventory kill-test proved useful metadata can be derived safely. The next highest-value slice is making that metadata visible in the operator UI before adding process controls, live cluster binding, or dependency/adoption analysis.
- Alternatives considered:
  - Add service-to-cluster binding first (higher operational value, but it depends on a stable local repo browser surface).
  - Add local process controls first (faster daily loop, but unsafe without explicit repo config and audit semantics).
  - Keep the endpoint API-only for another cycle (lower risk, but leaves Phase 5 invisible to operators).
- Consequences: The Stack view remains metadata-only and read-only. Follow-up work can bind cards to K8s/Flux/GitLab/Loom HUD state once confidence heuristics are defined.
- Sources:
  - [S1] `ROADMAP.md`
  - [S2] `.loom/42-slice-handoff-local-stack-inventory-kill-test-2026-06-06.md`
  - [S3] `web/src/components/Stack/index.tsx`

### 2026-06-08: Ship inferred service-to-cluster binding before live verification

- Decision: Add an additive `binding` field to the workspace inventory that infers each service repo's cluster identity (namespace, Flux source, Kustomization, GitLab project, and a normalized `matchKey`) purely from metadata the scanner already collects, surfaced on Stack cards at `inferred` confidence. Libraries are classified as non-deployed.
- Rationale: The Phase 5 handoff named service-to-cluster binding as the next slice. The smallest end-to-end increment derives binding from existing inventory signals (repo name, `services/<repo>` GitLab path, sanitized remote) without coupling the read-only scanner to live cluster availability. This proves the binding contract and naming-convention assumption cheaply, and the live cross-reference slice can raise confidence to `verified` against the same `matchKey`.
- Alternatives considered:
  - Cross-reference live Flux `GitRepository` source URLs immediately (higher value, but couples the inventory scan to cluster availability and is harder to test deterministically).
  - Defer binding until `.flexdeck.yaml` hints exist (more explicit, but blocks visible progress on convention-following repos that need no hints).
- Consequences: Bindings are honest about being heuristic via an `inferred` confidence chip; no live data is read. The kill-test confirmed the convention holds for canonical services (`flexdeck`/`flexinfer`/`loom-core` → matching namespace/source). Next slice verifies `matchKey` against live Flux sources and folds in image-label/HUD signals.
- Sources:
  - [S1] `internal/workspace/binding.go`
  - [S2] `.loom/31-iteration-plan-stack-cluster-binding-2026-06-08.md`
  - [S3] `web/src/components/Stack/stackUtils.ts`

### 2026-06-08: Verify service bindings via project-path join to live Flux sources

- Decision: Upgrade an inferred service binding to `confidence=verified` when the repo's GitLab **project path** matches a live Flux `GitRepository.spec.url`, then resolve the owning Kustomization (and its `targetNamespace` when set). The live list happens in the handler (`fluxBindingTargets`) and feeds a pure `workspace.EnrichBindings`; the workspace package stays Kubernetes-free.
- Rationale: The kill-test against the real cluster proved the binding can be verified, but also that Flux `GitRepository` URLs use the **internal** git host (`gitlab-vm.gitlab.svc.cluster.local`) while repo remotes use the public host (`gitlab.flexinfer.ai`). A host-based `matchKey` join would silently fail; a **path-based** join (`services/flexdeck`) works for both. Keeping the I/O in the handler and the join pure keeps the scanner decoupled and unit-testable, and best-effort enrichment means the endpoint degrades to `inferred` when the cluster is unreachable.
- Alternatives considered:
  - Match on the host-qualified `matchKey` (simplest, but the internal-vs-public host mismatch makes it never match in this cluster).
  - Resolve the deploy namespace from live Deployments instead of the Kustomization (more authoritative, but larger surface; deferred to the next slice).
  - Compute the join inside `internal/workspace` with an injected client (couples the scanner to Kubernetes; rejected).
- Consequences: Canonical services verify correctly (live probe: `flexdeck`→`flux-system/flexdeck`, `flexinfer`→`flexinfer-models` deterministically). One source can own many Kustomizations, so selection prefers the repo-name match else the lexicographically smallest. Namespace is only overridden when the Kustomization sets `targetNamespace` (flexdeck's does not), so it stays inferred there.
- Sources:
  - [S1] `internal/api/handlers/workspace_binding.go`
  - [S2] `internal/workspace/binding.go` (`EnrichBindings`, `ProjectPathFromURL`)
  - [S3] `.loom/31-iteration-plan-stack-verified-binding-2026-06-08.md`

### 2026-06-08: Bind services to live K8s Deployments via Flux labels for authoritative namespace + health

- Decision: Join live Deployments to a service's Flux source through the `kustomize.toolkit.fluxcd.io/{name,namespace}` labels Flux stamps on everything it applies, aggregate replica health per source across **all** of its kustomizations, and attach a `workload` (`{namespaces, deployments, ready, desired}`) to the verified binding. The single workload namespace overrides the inferred/targetNamespace guess; the displayed Kustomization prefers the one that owns workloads.
- Rationale: The kill-test showed the C-2 deterministic kustomization pick is not where the workloads necessarily live — flexinfer's running Deployments belong to the `flexinfer-system` kustomization in namespace `flexinfer-system`, not the inferred `flexinfer`. The Flux label join is authoritative and already used elsewhere in the dashboard. Listing Deployments cluster-wide once inside the cached `workspace:repos` fetch is cheap; the typed lister gives replica counts directly.
- Alternatives considered:
  - Match Deployments by name == repo name (fragile; flexinfer has no `flexinfer` Deployment, its workloads are `kokoro-tts`/`pyannote-diarization`).
  - Scope workloads to the single displayed Kustomization (would show flexinfer as having no workloads).
  - Use `targetNamespace` as authoritative (usually empty; the running namespace is the real signal).
- Consequences: Live probe — `flexdeck` 3/3 ready in `flexdeck`; `flexinfer` 2/2 ready with namespace corrected to `flexinfer-system`. Multi-namespace workloads do not override the namespace (kept ambiguous-safe). Only Deployments are covered; StatefulSet/DaemonSet and pod/rollout health are deferred. Best-effort: a failed Deployment list leaves the C-2 verified binding intact.
- Sources:
  - [S1] `internal/api/handlers/workspace_binding.go` (`aggregateWorkloads`, `pickKustomization`)
  - [S2] `internal/workspace/binding.go` (`Workload`, `EnrichBindings`)
  - [S3] `.loom/31-iteration-plan-stack-workload-binding-2026-06-08.md`
