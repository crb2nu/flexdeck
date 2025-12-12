# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Flexdeck is a Kubernetes dashboard/management service with a Go backend and web frontend. It provides interfaces for managing K8s resources, viewing logs (via Loki), metrics (via Prometheus), and vLLM model services.

## Build and Run Commands

```bash
# Run the server
go run ./cmd/server

# Build the binary
go build -o flexdeck ./cmd/server

# Run tests
go test ./...

# Run a single test
go test ./internal/auth -run TestMiddleware
```

## Architecture

### Backend (Go)
- `cmd/server/main.go` - Application entrypoint, sets up HTTP server with graceful shutdown
- `internal/config/` - Environment-based configuration loading
- `internal/auth/` - Token-based authentication middleware (Bearer token or cookie)
- `internal/api/` - HTTP handlers and router
- `internal/k8s/` - Kubernetes client wrapper
- `internal/loki/` - Loki log querying client

### Frontend
- `web/src/` - Web UI source
  - `components/` - UI components organized by feature (Dashboard, Logs, Models, Services, QuickLaunch)
  - `stores/` - State management
  - `lib/` - Shared utilities

## Configuration

All configuration is via environment variables. Key ones:
- `PORT` - Server port (default: 8080)
- `FLEXDECK_TOKEN` - Auth token (if empty, auth is disabled)
- `K8S_DISABLED` - Disable K8s integration
- `K8S_READONLY` - Enable read-only K8s mode
- `PROM_URL`, `LOKI_URL`, `VLLM_URL` - External service endpoints
