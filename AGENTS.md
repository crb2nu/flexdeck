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
- **Keep heavy vendor libs off route bundles.** `three.js` (3D HoloDeck) and `yaml`
  (CI-config preview) are loaded via `lazy()` / dynamic `import()` so they stay out
  of the landing (`/`) and Pipeline bundles. The `perf:bundle` CI job (`npm run
  perf:bundle` in `web/`) enforces this: it reads the Rollup chunk graph and fails
  if a heavy vendor lib re-enters a route's static import closure, or the landing
  page exceeds its JS budget (`LANDING_JS_GZ_BUDGET_BYTES` in
  `web/scripts/perf/bundle-budget.mjs` — currently 160 kB gz). Adjust the budget
  intentionally. When adding a heavy dependency, import it lazily on the path that
  needs it.

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

<!-- BEGIN LOOM:AGENT-SAFETY -->
## Loom Agent Safety Policy (Generated)

- Pre-existing uncommitted/untracked files are baseline context, not an automatic blocker.
- Continue on the current branch/worktree by default.
- Stage and commit only files intentionally changed for the active task.
- Escalate only when new unexpected changes appear in files you are editing, or when a branch/worktree switch is explicitly requested.
- Dirty-worktree mode: `continue_scoped_commits`.

Canonical nudge for CLI hooks:
> Dirty worktree detected. Treat pre-existing changes as baseline context, continue work, and stage/commit only files for the active task. Escalate only if new unexpected changes appear in files you are editing.

<!-- END LOOM:AGENT-SAFETY -->
