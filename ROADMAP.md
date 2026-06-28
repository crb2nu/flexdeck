# Project Roadmap

## Tracking

- [Roadmap tracking issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/1)

> Last Updated: June 26, 2026

## Current Status

FlexDeck is the central dashboard for the flexinfer.ai ecosystem, currently featuring a robust Go backend with modular subsystems for Kubernetes, AI Models, Agents, and Observability. The frontend provides a reactive interface for these services.

### Implemented Features

#### Backend (Go)

- ✅ **Kubernetes Integration**: Direct client for cluster management, events feed, Flux GitOps sync, storage (PVC/PV/StorageClass), ConfigMap/Secret viewer.
- ✅ **LiteLLM Gateway**: Metrics scraping, Redis buffering, proxying, model info API, router health/routing table.
- ✅ **Model Management**:
  - Registry for tracking available models.
  - Downloader for HuggingFace and CivitAI artifacts.
  - GitOps generator for automated deployment manifests.
  - Auto-discovery of models from K8s deployments.
- ✅ **FlexInfer Controller Integration**: Model CRD v1alpha2 listing, SSE watch, mutations (scale, activate, restart), per-model K8s events.
- ✅ **Agent Orchestration**: Registry and proxy for managing AI agents (Dify, LangGraph, AgentScope).
- ✅ **Observability**:
  - Prometheus metrics proxy (queries, alerts, rules).
  - Prometheus Alerts API: query firing alerts and rules.
  - Loki log streaming (SSE).
  - Langfuse observability: trace ingestion and API proxy.
  - Alertmanager proxy: alerts, silences, create/delete silence.
- ✅ **Infrastructure**:
  - Redis caching layer: SCAN-based iteration, regex caching, cache-aside pattern.
  - Configurable feature flags (disable subsystems via env).
  - Health endpoint with per-subsystem status.

#### Frontend (SolidJS)

- ✅ **Dashboard**: Topology graph (2D + 3D HoloDeck), resource PulseCards, K8s events feed, pod detail panels.
- ✅ **Services**: Full CRUD for Deployments, StatefulSets, DaemonSets, Jobs, Services, Ingresses.
- ✅ **Flux GitOps**: Visualizer for Kustomizations and HelmReleases with reconcile buttons, drift detection, inline values display, and revision history.
- ✅ **Pipeline / CI**: GitLab CI visualization, job trace viewer, retry/cancel/play actions.
- ✅ **Log Viewer**: Matrix-style live tailing of Loki logs (warp + rain modes).
- ✅ **Metrics**: Prometheus query dashboard with sparkline charts.
- ✅ **Models**: Registry browser, HuggingFace/CivitAI search, download/deploy/scale.
- ✅ **Agents**: Registry, health checks, CRUD, Neural Link chat interface.
- ✅ **Command Palette**: ⌘K quick navigation to all sections.
- ✅ **SystemCore**: Real-time health indicator showing subsystem status.
- ✅ **FlexInfer CRD Dashboard** (Controller tab): Browse, scale, activate, restart Model CRDs with live SSE.
- ✅ **GPU Metrics Panel**: Per-node utilization, VRAM, temperature, power (NVIDIA DCGM + AMD ROCm).
- ✅ **Alerts Panel**: Live Prometheus alerts on dashboard.
- ✅ **Langfuse Widget**: Observability traces on dashboard.
- ✅ **Vim Keyboard Shortcuts**: `g`-prefix navigation + `?` help overlay.
- ✅ **PulseCard Sparklines**: Rolling CPU/memory history.
- ✅ **Model Events Timeline**: Per-model K8s event history in CRD cards.
- ✅ **LiteLLM Router Panel**: Proxy health status and model routing table.
- ✅ **Model Comparison**: Side-by-side throughput, latency, GPU metrics for ready models.
- ✅ **Alertmanager UI**: Alert list, silence management, create/delete silences.
- ✅ **Storage Browser**: PVC/PV/StorageClass listing with status indicators.
- ✅ **ConfigMap/Secret Viewer**: Expandable rows with per-key reveal for secrets.
- ✅ **Helm Values/History**: Inline values display and revision history for HelmReleases.
- ✅ **Stack Explorer**: Read-only local services/libs explorer over the workspace repository inventory, with search, grouping, and readiness summaries.
- ✅ **Projects**: Unified project-tracking page federating GitLab issues/milestones, agent tasks, risks, decisions, and loom-core plans (with a riskiest-assumption + slice drill-in) on a shared canonical project key.

## Upcoming Work

### Status Legend

- ✅ Shipped and enabled in standard deployments
- ◐ Partial (implemented behind feature flag and/or reduced surface)
- ☐ Planned (not yet implemented)

### Phase 1: AI Workload Management

- [x] **Model Browser UI**: Rich interface for browsing the model registry and triggering downloads.
- [x] **GitOps Visualizer**: Visual status of Flux synchronizations and drift detection.
- [x] **FlexInfer Controller Integration**: CRD v1alpha2 listing, mutations, SSE watch. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/2))
- [x] **GPU Metrics**: Per-node DCGM/ROCm panels, sparkline history, multi-GPU aggregation, per-model GPU correlation table. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/3))

### Phase 2: Agent Interaction

- [x] **Agent Chat Interface**: Neural Link chat UI for interacting with registered agents.
- [x] **Flow Visualization**: Visual graph of agent interactions and dependencies. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/4))

### Phase 2.5: Feature Expansion & FlexInfer Integration (Feb 2026)

- [x] **Model Events Timeline**: Per-model K8s event history with cached API and vertical timeline UI.
- [x] **LiteLLM Router Panel**: Proxy health, model routing table with backend/mode/RPM columns.
- [x] **Model Comparison**: Side-by-side metrics (throughput, latency, GPU utilization) with chart and table views.
- [x] **Alertmanager UI**: Full alerts/silences browser with create/delete silence capability.
- [x] **Storage Browser**: PVC, PV, and StorageClass listing with phase indicators and capacity display.
- [x] **ConfigMap/Secret Viewer**: Expandable key-value browser with masked secret values and per-key reveal.
- [x] **Helm Values/History**: Inline Helm release values and revision history with status indicators.

### Phase 3: Deep FlexInfer & Loom Integration

*Spec and plan in `.loom/` context pack.*

#### Track 1: FlexInfer Inference Metrics
- [x] **Inference Metrics Tab**: Per-model TPS, p95 latency, error rate, queue depth, active connections from FlexInfer proxy Prometheus metrics.
- [x] **Scale-to-Zero Visibility**: Cold start p95 latency (Prometheus), idle-for duration (from lastActiveTime), and preemption timestamps are all surfaced. InferenceTab detail panel shows scaling row; Serverless admin section shows live idle countdown.
- [x] **GPU Sharing State**: Active/shared/preempted state per model, per-model swap timeline, group Gantt chart with configurable time windows (6/12/24/48h), and per-model stats.
- [x] **KV-Cache Pressure**: Utilization gauge, pressure events, eviction policy for vLLM models.
- [x] **LoRA Adapter Status**: Per-model loaded adapters with lifecycle state (Pending/Loaded/Unloading).
- [x] **Model Catalog Browser**: Registry entries from ModelCatalog CRDs (HuggingFace, OCI, Ollama sources).

#### Track 2: Loom Agent HUD
- [x] **Agent Presence Grid**: Active agent cards with type, status (active/idle/offline), session duration, current file.
- [x] **Task Board**: Kanban view of agent tasks (pending/in_progress/completed) with priority, agent assignment, file location.
- [x] **Workflow Monitor**: Active workflows with step indicators, approval gates, approve/reject/cancel controls.
- [x] **Activity Timeline**: Real-time event feed from Loom HUD SSE stream.
- [x] **File Claims & Conflicts**: Advisory lock display with conflict warnings.

#### Dashboard Widgets
- [x] **Inference Health Widget**: Model count by phase, total TPS, queue alerts.
- [x] **Agent Activity Widget**: Active agent count, tasks completed today, workflow approvals pending.

### Phase 4: Enterprise Features

- ✅ **RBAC UI**: Backend routes and admin UI tab behind `RBAC_*` flags, **enabled and enforcing in production since 2026-06-17** — fail-closed enforcement, a dedicated durable `redis-rbac` store (AOF + PVC, separate from the LRU cache), and a SOPS-managed admin token. Live verified: `RBAC_DISABLED=false`, 401 without a token / 200 with. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/5) — closed)
- ◐ **Audit Logs (Partial)**: Audit API and UI tab are implemented behind `AUDIT_*` flags (issue closed), but the feature is **off by default** (`AUDIT_DISABLED` defaults to `true`) and is not enabled in the standard deployment; deployment-level enablement and operational/retention policy remain pending. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/6) — closed)
- ◐ **Multi-Cluster Support (Partial)**: Cluster registry APIs and selector/admin surfaces are implemented behind `MULTICLUSTER_*` flags (issue closed), but the feature is **off by default** (`MULTICLUSTER_DISABLED` defaults to `true`) and is not enabled in the standard deployment; production readiness and rollout validation remain pending. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/7) — closed)

### Phase 5: Local Stack Support (June 2026)

- [x] **Workspace Repository Inventory API**: Read-only `/api/workspace/repos` scanner for top-level `WORKSPACE_DIR/services` and `WORKSPACE_DIR/libs` repos, including language/package hints, docs markers, worktree counts, sanitized git remotes, branch, and dirty state.
- [x] **Stack Explorer UI**: Service/lib cards over the repository inventory with search, grouping, and readiness summaries.
- ◐ **Service-To-Cluster Binding (Partial)**: Inferred binding from inventory metadata, **upgraded to `verified`** by matching the repo's project path to a live Flux `GitRepository` source, then joined to live **K8s workloads** — Deployments, StatefulSets, and DaemonSets via the `kustomize.toolkit.fluxcd.io` labels — for the authoritative running namespace and aggregate replica health (`ready/desired`, per-kind counts), shown on Stack cards (2026-06-08). The workload namespace overrides the inferred guess (e.g. `jobsearch-app` → `daemon`) and StatefulSet-backed data tiers are now counted. Each workload is classified `healthy` / `progressing` / `degraded` from rollout state (Deployment Progressing/Available conditions + updated-vs-desired replicas), so an in-flight rollout is not flagged as broken. The Stack view has a **Cluster filter** (Verified / Degraded / Inferred), a 3-color workload health chip, a bound-services summary tile, and a **health-first sort** that surfaces degraded → progressing services to the top for triage. Remaining: pod-level reasons (crashloop/imagepull), Jobs/CronJobs, and image-label / Loom HUD signals.
- ◐ **Library Adoption And Contract Coverage (Partial)**: A post-scan adoption pass maps which services depend on which workspace libs by resolving each lib's per-ecosystem identifier (`libs/<dir>` path + Go module path, Python/Node package `name`) and text-scanning service manifests. Stack cards show service `dependsOn` and lib `usedBy` (surfacing libs with no service adopters); adoption is searchable (2026-06-08). Live: 5 Go services → 3 Go libs (e.g. `mcp-go` used by 5). A **"Lib coverage" summary tile** (% of libs with ≥1 service adopter + zero-adopter count) and an **"Adoption" filter** (Any / Adopted / No adopters) surface the contract-coverage gap — the cross-cutting libs (observability/resilience/UI-token) with zero adopters now stand out (2026-06-26); adoption is also computed from the GitLab-API source (the prod default). **Lib→lib adoption** now maps which libraries depend on other libraries: a lib's own `dependsOn` and a new `usedByLibs` are computed by the shared matcher on both scan paths, so a lib consumed only by other libs reads as transitively used rather than a dead orphan — while `usedBy` (and the coverage metric) stays service-only (2026-06-28). Remaining: contract version-drift.

### Phase 3.5: Reliability And Contract Hardening (March 2026)

- [x] **Inference Contract Hardening**: Normalized `/api/flexinfer/proxy/metrics` with additive `byModel`, `totals`, `requestsByStatus`, `partial` while preserving compatibility keys. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/8))
- [x] **Reliability Metrics Expansion**: Extended `/api/models/crd/{namespace}/{name}/inference` with additive error/queue/reject/retry fields and partial metadata. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/9))
- [x] **HUD Degraded-Mode UX**: Added explicit stale/poll-fallback indicators for stream disconnects and delayed pull freshness. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/10))
- [x] **Controller Integration Resilience**: Shared bounded-concurrency model integration fetch path with short TTL cache + in-flight dedupe across Controller and Inference views.

### Phase 6: Unified Project Tracking (June 2026)

A workspace-wide `/projects` page that federates project state across the
ecosystem on a shared canonical key (GitLab `path_with_namespace`), separate from
the Devoted/ICC deployment. Live-verified end-to-end against production data.

- [x] **Projects Federation API**: `/api/projects` rollup + `/api/projects/{id}` detail correlating **six sources** on the `project` key — GitLab issues, GitLab native milestones, agent-context tasks, `mcp-pm` risks, agent-context decisions, and agent-context plans — with per-source error isolation (a single failed source degrades to a `partial` flag, never a failed response) and a cheap rollup (one GitLab list call + grouped Qdrant scrolls, no per-project fan-out).
- [x] **Projects UI**: SolidJS `/projects` page with a concern-sorted project picker and per-project lanes for each source; poll-stable lists.
- [x] **Risks Store (loom-core `mcp-pm`)**: A dedicated Qdrant-backed risks store (`pm_risk_create/list/update/link`) — the one planning entity nothing else owned — with write decoupled from embed. Currently dormant (no risks created yet).
- [x] **Plans Lane (loom-core Plan store)**: Read-only visibility of the loom-core Plan store per project — lifecycle phase, a compact kill-test verdict (free-form status collapsed to passed/failed/mixed with full text on hover), born-linked GitLab issue, MR count, slice landing progress (`M/N`), and an expandable drill-in revealing the riskiest assumption and the ordered slice list (name/phase/MR).
- ☐ **Risk Capture Wiring**: Nothing populates the risks store yet; the lane stays dormant until a workflow (e.g. riskiest-assumption kill-tests) calls `pm_risk_create`.

## References

| Document               | Purpose                        |
| ---------------------- | ------------------------------ |
| [README.md](README.md) | Project setup and architecture |
| [AGENTS.md](AGENTS.md) | Agent guidance                 |
| [Makefile](Makefile)   | Build and dev commands         |
