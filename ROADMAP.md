# Project Roadmap

> Last Updated: January 2026

## Current Status

FlexDeck is the central dashboard for the flexinfer.ai ecosystem, currently featuring a robust Go backend with modular subsystems for Kubernetes, AI Models, Agents, and Observability. The frontend provides a reactive interface for these services.

### Implemented Features

#### Backend (Go)
- ✅ **Kubernetes Integration**: Direct client for cluster management and Flux GitOps sync.
- ✅ **LiteLLM Gateway**: Metrics scraping, Redis buffering, and proxying.
- ✅ **Model Management**:
    - Registry for tracking available models.
    - Downloader for HuggingFace and CivitAI artifacts.
    - GitOps generator for automated deployment manifests.
- ✅ **Agent Orchestration**: Registry and proxy for managing AI agents.
- ✅ **Observability**:
    - Prometheus metrics proxy.
    - Loki log streaming (SSE).
- ✅ **Infrastructure**:
    - Redis integration for state/metrics.
    - Configurable feature flags (disable subsystems via env).

#### Frontend (SolidJS)
- ✅ **Dashboard Layout**: Responsive sidebar/header layout.
- ✅ **Log Viewer**: Live tailing of Loki logs.
- ✅ **Metrics Charts**: Visualization of cluster and model performance.
- ✅ **Resource Views**: K8s deployments, pods, and services.

## Upcoming Work

### Phase 1: AI Workload Management
- [ ] **Model Browser UI**: Rich interface for browsing the model registry and triggering downloads.
- [ ] **GitOps visualizer**: Visual status of Flux synchronizations and drift detection.
- [ ] **vLLM Control Plane**: Direct scaling and configuration of inference endpoints.

### Phase 2: Agent Interaction
- [ ] **Agent Chat Interface**: Unified chat UI to interact with registered agents.
- [ ] **Flow Visualization**: Visual graph of agent interactions and dependencies.

### Phase 3: Enterprise Features
- [ ] **RBAC UI**: User management and role assignment.
- [ ] **Audit Logs**: Visual audit trail of all mutations performed via the dashboard.
- [ ] **Multi-Cluster Support**: Switching context between different K8s clusters.

## References

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | Project setup and architecture |
| [AGENTS.md](AGENTS.md) | Agent guidance |
| [Makefile](Makefile) | Build and dev commands |