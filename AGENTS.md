# AGENTS.md

Guidance for coding agents working in this repository.

## Project Overview
- FlexDeck is a Kubernetes dashboard for the flexinfer.ai ecosystem — workload management, FlexInfer CRD lifecycle, GPU metrics, Langfuse tracing, and Flux GitOps.
- Backend: Go (Chi router, client-go, Prometheus, Loki, Langfuse, Redis cache).
- Frontend: SolidJS + Tailwind CSS + Vite, with D3/Three for visualizations.

## Key Paths
- `cmd/server/` application entrypoint
- `internal/` backend modules (agents, api, auth, cache, config, k8s, litellm, metrics, models)
- `internal/k8s/models_crd.go` FlexInfer v1alpha2 Model CRD operations
- `internal/cache/cache.go` Redis caching layer
- `internal/metrics/` Prometheus metrics store + scraper
- `web/src/` frontend source (components, stores, lib, styles)

## Common Commands
- `make deps`
- `make dev` (backend + frontend)
- `make dev-backend`
- `make dev-frontend`
- `make build`
- `make test` / `make test-frontend`
- `make lint` / `make lint-frontend`
- `go run ./cmd/server`
- `go test ./...`

## Library Dependencies

- `libs/visual-kit` - Design tokens, Tailwind preset, and SolidJS components

## Code Conventions
- Prefer descriptive names; avoid single-letter variables except in math-heavy code.
- Avoid `as any` and `@ts-ignore` in TypeScript; add types or guards instead.
- Keep components and handlers focused; extract reusable utilities when logic grows.
- Preserve existing Tailwind tokens and UI patterns.

## Performance Expectations
- Many views are perf-sensitive (canvas/graph rendering). Minimize per-frame allocations.
- Prefer O(n) loops, reuse arrays/object pools, and cache computed styles/labels.
- Throttle heavy work and allow animation loops to stop when idle.
- Scale visual detail with zoom/graph size to keep the UI responsive.

## Configuration
- Config is environment-driven; see README for variables.
- Do not hardcode secrets or edit local secret files (for example, `~/.config/secrets/*`).

## Testing and Validation
- Backend: `go test ./...`
- Frontend: `make test-frontend` or `npm run test` in `web/`
- Lint: `make lint` or `npm run lint` in `web/`

## Change Hygiene
- Make minimal edits to satisfy the request.
- Call out behavior changes and suggest a quick validation step.

## Planning
- See `ROADMAP.md` for project status and plans.
- Recent additions: FlexInfer controller integration, GPU metrics panels, Langfuse observability, Prometheus alerts API, Redis caching layer.

