# Project Roadmap

## Tracking

- [Roadmap tracking issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/1)

> Last Updated: June 6, 2026

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

- ◐ **RBAC UI (Partial)**: Backend routes and admin UI tab are implemented behind `RBAC_*` flags; rollout/default enablement is pending. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/5))
- ◐ **Audit Logs (Partial)**: Audit API and UI tab exist behind `AUDIT_*` flags; deployment-level enablement and operational policy remain pending. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/6))
- ◐ **Multi-Cluster Support (Partial)**: Cluster registry APIs and selector/admin surfaces exist behind `MULTICLUSTER_*` flags; production readiness and rollout validation are pending. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/7))

### Phase 5: Local Stack Support (June 2026)

- [x] **Workspace Repository Inventory API**: Read-only `/api/workspace/repos` scanner for top-level `WORKSPACE_DIR/services` and `WORKSPACE_DIR/libs` repos, including language/package hints, docs markers, worktree counts, sanitized git remotes, branch, and dirty state.
- [x] **Stack Explorer UI**: Service/lib cards over the repository inventory with search, grouping, and readiness summaries.
- ◐ **Service-To-Cluster Binding (Partial)**: Inferred binding from inventory metadata, **upgraded to `verified`** by matching the repo's project path to a live Flux `GitRepository` source, then joined to live **K8s workloads** — Deployments, StatefulSets, and DaemonSets via the `kustomize.toolkit.fluxcd.io` labels — for the authoritative running namespace and aggregate replica health (`ready/desired`, per-kind counts), shown on Stack cards (2026-06-08). The workload namespace overrides the inferred guess (e.g. `jobsearch-app` → `daemon`) and StatefulSet-backed data tiers are now counted. Each workload is classified `healthy` / `progressing` / `degraded` from rollout state (Deployment Progressing/Available conditions + updated-vs-desired replicas), so an in-flight rollout is not flagged as broken. The Stack view has a **Cluster filter** (Verified / Degraded / Inferred), a 3-color workload health chip, a bound-services summary tile, and a **health-first sort** that surfaces degraded → progressing services to the top for triage. Remaining: pod-level reasons (crashloop/imagepull), Jobs/CronJobs, and image-label / Loom HUD signals.
- [ ] **Library Adoption And Contract Coverage**: Map local shared-lib usage across services and surface observability/resilience/UI-token contract drift.

### Phase 3.5: Reliability And Contract Hardening (March 2026)

- [x] **Inference Contract Hardening**: Normalized `/api/flexinfer/proxy/metrics` with additive `byModel`, `totals`, `requestsByStatus`, `partial` while preserving compatibility keys. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/8))
- [x] **Reliability Metrics Expansion**: Extended `/api/models/crd/{namespace}/{name}/inference` with additive error/queue/reject/retry fields and partial metadata. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/9))
- [x] **HUD Degraded-Mode UX**: Added explicit stale/poll-fallback indicators for stream disconnects and delayed pull freshness. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/10))
- [x] **Controller Integration Resilience**: Shared bounded-concurrency model integration fetch path with short TTL cache + in-flight dedupe across Controller and Inference views.

## References

| Document               | Purpose                        |
| ---------------------- | ------------------------------ |
| [README.md](README.md) | Project setup and architecture |
| [AGENTS.md](AGENTS.md) | Agent guidance                 |
| [Makefile](Makefile)   | Build and dev commands         |
