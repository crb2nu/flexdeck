# Project Roadmap

## Tracking

- [Roadmap tracking issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/1)

> Last Updated: February 2026

## Current Status

FlexDeck is the central dashboard for the flexinfer.ai ecosystem, currently featuring a robust Go backend with modular subsystems for Kubernetes, AI Models, Agents, and Observability. The frontend provides a reactive interface for these services.

### Implemented Features

#### Backend (Go)

- ✅ **Kubernetes Integration**: Direct client for cluster management, events feed, and Flux GitOps sync.
- ✅ **LiteLLM Gateway**: Metrics scraping, Redis buffering, and proxying.
- ✅ **Model Management**:
  - Registry for tracking available models.
  - Downloader for HuggingFace and CivitAI artifacts.
  - GitOps generator for automated deployment manifests.
  - Auto-discovery of models from K8s deployments.
- ✅ **FlexInfer Controller Integration**: Model CRD v1alpha2 listing, SSE watch, mutations (scale, activate, restart).
- ✅ **Agent Orchestration**: Registry and proxy for managing AI agents (Dify, LangGraph, AgentScope).
- ✅ **Observability**:
  - Prometheus metrics proxy (queries, alerts, rules).
  - Prometheus Alerts API: query firing alerts and rules.
  - Loki log streaming (SSE).
  - Langfuse observability: trace ingestion and API proxy.
- ✅ **Infrastructure**:
  - Redis caching layer: SCAN-based iteration, regex caching, cache-aside pattern.
  - Configurable feature flags (disable subsystems via env).
  - Health endpoint with per-subsystem status.

#### Frontend (SolidJS)

- ✅ **Dashboard**: Topology graph (2D + 3D HoloDeck), resource PulseCards, K8s events feed, pod detail panels.
- ✅ **Services**: Full CRUD for Deployments, StatefulSets, DaemonSets, Jobs, Services, Ingresses.
- ✅ **Flux GitOps**: Visualizer for Kustomizations and HelmReleases with reconcile buttons and drift detection.
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

## Upcoming Work

### Phase 1: AI Workload Management

- [x] **Model Browser UI**: Rich interface for browsing the model registry and triggering downloads.
- [x] **GitOps Visualizer**: Visual status of Flux synchronizations and drift detection.
- [x] **FlexInfer Controller Integration**: CRD v1alpha2 listing, mutations, SSE watch. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/2))
- [x] **GPU Metrics** *(partial)*: Per-node DCGM/ROCm panels implemented. Remaining: historical time-series charts, multi-GPU aggregation, per-model GPU correlation. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/3))

### Phase 2: Agent Interaction

- [x] **Agent Chat Interface**: Neural Link chat UI for interacting with registered agents.
- [ ] **Flow Visualization**: Visual graph of agent interactions and dependencies. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/4))

### Phase 3: Enterprise Features

- [ ] **RBAC UI**: User management and role assignment. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/5))
- [ ] **Audit Logs**: Visual audit trail of all mutations performed via the dashboard. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/6))
- [ ] **Multi-Cluster Support**: Switching context between different K8s clusters. ([Issue](https://gitlab.flexinfer.ai/services/flexdeck/-/issues/7))

## References

| Document               | Purpose                        |
| ---------------------- | ------------------------------ |
| [README.md](README.md) | Project setup and architecture |
| [AGENTS.md](AGENTS.md) | Agent guidance                 |
| [Makefile](Makefile)   | Build and dev commands         |
