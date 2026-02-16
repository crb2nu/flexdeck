# Project Roadmap

## Tracking

- [Roadmap tracking issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/1)

> Last Updated: February 2026

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

## Upcoming Work

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
- [x] **Scale-to-Zero Visibility**: Cold start activations, idle timeout state, queue wait time.
- [x] **GPU Sharing State**: Active model, queue position, swap history from GPUGroup metrics.
- [x] **KV-Cache Pressure**: Utilization gauge, pressure events, eviction policy for vLLM models.
- [x] **LoRA Adapter Status**: Per-model loaded adapters with lifecycle state (Pending/Loaded/Unloading).
- [x] **Model Catalog Browser**: Registry entries from ModelCatalog CRDs (HuggingFace, OCI, Ollama sources).

#### Track 2: Loom Agent HUD
- [x] **Agent Presence Grid**: Active agent cards with type, status (active/idle/offline), session duration, current file.
- [x] **Task Board**: Kanban view of agent tasks (pending/in_progress/completed) with priority, agent assignment, file location.
- [x] **Workflow Monitor**: Active workflows with step indicators, approval gates, approve/reject controls.
- [x] **Activity Timeline**: Real-time event feed from Loom HUD SSE stream.
- [x] **File Claims & Conflicts**: Advisory lock display with conflict warnings.

#### Dashboard Widgets
- [x] **Inference Health Widget**: Model count by phase, total TPS, queue alerts.
- [x] **Agent Activity Widget**: Active agent count, tasks completed today, workflow approvals pending.

### Phase 4: Enterprise Features

- [ ] **RBAC UI**: User management and role assignment. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/5))
- [ ] **Audit Logs**: Visual audit trail of all mutations performed via the dashboard. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/6))
- [ ] **Multi-Cluster Support**: Switching context between different K8s clusters. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/7))

## References

| Document               | Purpose                        |
| ---------------------- | ------------------------------ |
| [README.md](README.md) | Project setup and architecture |
| [AGENTS.md](AGENTS.md) | Agent guidance                 |
| [Makefile](Makefile)   | Build and dev commands         |
