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
