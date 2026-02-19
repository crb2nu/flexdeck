![FlexDeck Banner](assets/banner.png)

# FlexDeck

Central dashboard for the flexinfer.ai ecosystem — Kubernetes workload management, FlexInfer AI model lifecycle (CRD), GPU metrics, Prometheus/Loki observability, Langfuse tracing, and Flux GitOps.

## Tech Stack

- **Frontend**: SolidJS + Tailwind CSS + Vite
- **Backend**: Go + Chi router + client-go
- **Deployment**: Docker + Kubernetes + Flux GitOps

## Development

### Prerequisites

- Go 1.24+
- Node.js 20+
- Docker (optional)

### Quick Start

```bash
# Install dependencies
make deps

# Run development servers (backend + frontend with hot reload)
make dev
```

Backend runs on `:8080`, frontend dev server on `:5173` (proxies API to backend).

### Individual Commands

```bash
# Backend only
make dev-backend

# Frontend only
make dev-frontend

# Build production
make build

# Run tests
make test
make test-frontend

# Lint
make lint
make lint-frontend
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `STATIC_DIR` | `./web/dist` | Static files directory |
| `FLEXDECK_TOKEN` | | Bearer token for auth |
| `K8S_HOST` | `https://kubernetes.default.svc` | K8s API server |
| `K8S_BEARER_TOKEN` | | K8s auth token |
| `K8S_DISABLED` | `false` | Disable K8s integration |
| `K8S_READONLY` | `false` | Disable mutation operations |
| `PROM_URL` | `http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090` | Prometheus URL |
| `PROM_DISABLED` | `false` | Disable Prometheus integration |
| `LOKI_URL` | `http://loki.logging.svc.cluster.local:3100` | Loki URL |
| `LOKI_DISABLED` | `false` | Disable Loki integration |
| `VLLM_URL` | | vLLM inference proxy URL (one of flexinfer's backends) |
| `FLEXINFER_PROXY_URL` | | FlexInfer proxy base URL |
| `FLEXINFER_PROXY_DISABLED` | `false` | Disable FlexInfer proxy integration |
| `LITELLM_URL` | `http://litellm.ai.svc.cluster.local:8000` | LiteLLM gateway URL |
| `LITELLM_DISABLED` | `false` | Disable LiteLLM integration |
| `REDIS_URL` | | Redis connection for caching/metrics |
| `LANGFUSE_URL` | | Langfuse observability URL |
| `LANGFUSE_PUBLIC_KEY` | | Langfuse public API key |
| `LANGFUSE_SECRET_KEY` | | Langfuse secret API key |
| `LOOM_HUD_URL` | `http://localhost:3333` | Loom HUD pull API base URL |
| `LOOM_HUD_DISABLED` | `false` | Disable Loom HUD integration |
| `LOOM_HUD_PUSH_TOKEN` | | Shared secret for HUD push webhook auth |
| `RBAC_DISABLED` | `true` | Disable RBAC subsystem |
| `RBAC_USERS_PATH` | `/data/rbac-users.json` | RBAC user store path |
| `RBAC_ADMIN_TOKEN` | | Bootstrap admin token |
| `AUDIT_DISABLED` | `true` | Disable audit subsystem |
| `AUDIT_TTL_DAYS` | `90` | Audit retention window |
| `MULTICLUSTER_DISABLED` | `true` | Disable multi-cluster subsystem |
| `CLUSTERS_REGISTRY_PATH` | `/data/clusters.json` | Cluster registry store path |

### HUD Degraded-Mode Thresholds

- Activity feed switches to poll fallback on SSE disconnect and retries with exponential backoff (`2s` base, `30s` max).
- Pull-mode stale warning is shown when successful HUD pull data is older than `45s`.

## Docker

```bash
# Build image
make docker

# Run container
docker run -p 8080:8080 flexdeck:dev
```

## Project Structure

```
flexdeck/
├── cmd/server/          # Go entrypoint
├── internal/
│   ├── agents/          # Agent orchestration
│   ├── api/             # HTTP handlers
│   ├── auth/            # Authentication
│   ├── cache/           # Redis caching layer
│   ├── config/          # Configuration
│   ├── k8s/             # Kubernetes client + FlexInfer CRD
│   ├── litellm/         # LiteLLM gateway proxy
│   ├── metrics/         # Prometheus metrics store + scraper
│   └── models/          # Model management + registry
├── web/
│   ├── src/
│   │   ├── components/  # SolidJS components
│   │   ├── stores/      # State management
│   │   ├── lib/         # Utilities
│   │   └── styles/      # CSS
│   └── ...
├── Dockerfile
├── Makefile
└── .gitlab-ci.yml
```

## License

MIT
