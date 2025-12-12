# FlexDeck

Central dashboard for the flexinfer.ai ecosystem.

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
| `PROM_URL` | | Prometheus URL |
| `LOKI_URL` | | Loki URL |
| `VLLM_URL` | | vLLM API URL |

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
│   ├── api/             # HTTP handlers
│   ├── auth/            # Authentication
│   ├── config/          # Configuration
│   ├── k8s/             # Kubernetes client
│   └── loki/            # Loki SSE bridge
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
