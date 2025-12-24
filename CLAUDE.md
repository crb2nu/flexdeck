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

## Best Practices Standards

### 1. Code Style & Readability
- **Naming**: Use descriptive names (e.g., `trafficPool`, `serviceToPodsMap`). Avoid single-letter variables in complex math unless standard (e.g., `x`, `y`, `z` for vectors).
- **Comments**: Explain *why* specific constants or algorithms are used, especially in graphics/math code.
- **Type Safety**: Avoid `@ts-ignore` and `as any`. Use Type Guards or proper interface definitions.

### 2. Code Organization
- **Single Responsibility**: Break large components (God Components) into smaller, logical units (Hooks, Utils, Config, Shaders).
- **Separation of Concerns**: Keep configuration, shaders, and business logic separate from UI rendering code.
- **File Structure**: Use feature folders (e.g., `components/Dashboard/HoloDeck/`) to group related files.

### 3. Performance & Resource Management
- **Memory**: Explicitly dispose of Three.js/WebGL resources (Geometries, Materials, Textures). Use shared resources where possible.
- **Algorithms**: Avoid O(N^2) or worse complexity in render loops or reactive effects. Index data for fast lookups.
- **Throttling**: Throttle expensive operations like raycasting or heavy calculations in event handlers.

### 4. Maintainability
- **Configuration**: Externalize magic numbers, colors, and dimensions into a config file or theme object.
- **Shaders**: Move GLSL code to separate files for better readability and potential linting.
- **DRY**: Deduplicate logic (e.g., filtering, geometry creation) into utility functions.