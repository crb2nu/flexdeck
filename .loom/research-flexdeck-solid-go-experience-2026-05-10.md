# Research Brief: FlexDeck SolidJS + Go Experience Patterns

**Date**: 2026-05-10
**Scope**: Improved frontend/backend patterns for FlexDeck smoothness, performance, visual coherence, and generated artifacts.

## Findings

1. Solid's model supports FlexDeck's dashboard needs when components keep derivations pure and narrow. Solid docs describe fine-grained updates as targeted UI updates, and `createMemo` memoizes derived values while suppressing downstream updates when results are equal. FlexDeck already uses this correctly in chart model construction and stable list preservation: `web/src/components/Metrics/EnhancedChart.tsx:27`, `web/src/lib/stableList.ts:7`.

2. Stores and batching should be preferred for complex nested UI state. Solid store setters batch multi-path updates before downstream effects run, which maps well to dashboard controllers that update loading/error/data/freshness together. FlexDeck already uses `batch` in `web/src/stores/dashboardSummary.ts:1` and should make that the norm for controller state updates.

3. FlexDeck already has a strong polling baseline: jittered intervals, staggered immediate fires, page-visibility pause/resume, and in-flight suppression in `web/src/lib/polling.ts:13`, `web/src/lib/polling.ts:46`, `web/src/lib/polling.ts:107`, and `web/src/lib/polling.ts:119`. The next pattern is documenting when polling gives way to SSE or push snapshots.

4. The topology renderer contains the most valuable frontend performance lessons: particle pools, large-graph thresholds, frame pressure counters, worker build messages, visibility caching, and perf HUD state appear in `web/src/components/Dashboard/TopologyGraph.tsx:36`, `web/src/components/Dashboard/TopologyGraph.tsx:75`, and `web/src/components/Dashboard/TopologyGraph.tsx:175`. D3's own docs note that large force layouts should be computed in a worker to avoid freezing UI, which validates topology's worker direction and suggests `AgentFlowGraph.tsx` should not scale as a pure SVG/D3 island.

5. MDN documents worker `requestAnimationFrame` as available in dedicated workers and designed to call animation callbacks before repaint. That makes worker/OffscreenCanvas a reasonable option for future high-density canvases, but only after simpler SVG or main-thread Canvas budgets are exhausted.

6. Backend smoothness depends on materialized and coalesced reads. FlexDeck's cache layer uses Redis, stale fallback, TTL jitter, background refresh, and `singleflight.Group` in `internal/cache/cache.go:35`, `internal/cache/cache.go:112`, `internal/cache/cache.go:121`, and `internal/cache/cache.go:128`. The Go singleflight package is explicitly for duplicate-call suppression. The infra worker complements this by pre-warming snapshots on separate tickers in `internal/infra/worker.go:61`.

7. Chi middleware already gives FlexDeck useful HTTP defaults: request IDs, logging, recovery, compression, CORS, and static serving in `internal/api/router.go:27`. Chi docs confirm compression and timeout/throttle middleware are available; FlexDeck should consider route-group timeout/throttle only on expensive upstream fan-out routes, not globally.

8. FlexDeck's local token system is mature but partly local: `web/src/styles/variables.css:1` maps loom-core canonical tokens to FlexDeck aliases, while `libs/visual-kit` exports tokens, Tailwind preset, and Solid components. Generated artifacts should consume the same token JSON/CSS variables to avoid a second visual language.

9. Artifact tools are relevant when they clarify operational state: `py-diagram-gen` supports Go/TypeScript architecture diagrams and SVG output; `py-sprite-kit` can generate SVG/PNG icons/effects and sprite sheets; `py-chiptune` can emit MIDI/WAV status cues. For FlexDeck, diagrams and SVG assets are first-class; chiptune belongs behind optional accessibility/demo settings.

## Implications For FlexDeck

- New operator surfaces should implement a shared "snapshot surface" shape: `data`, `loading`, `refreshing`, `error`, `lastUpdated`, `freshness`, and stable row identity.
- Backend handlers that touch K8s, Prometheus, GitLab, Grafana, Loki, or model controller APIs should choose one of: cache-aside with stale fallback, materialized worker snapshot, or streaming watch endpoint.
- Visualizations should have an explicit engine choice in review: Solid DOM, SVG, Canvas, Canvas + worker, or Three only when 3D carries real operational meaning.
- Generated diagrams and sprites should be reproducible artifacts with source config/prompt, token mapping, and tests or screenshot checks.

## Recommended Next Action

Make Infra or Metrics the reference "snapshot surface contract" because both already have backend snapshot/cache behavior and visible UI refresh states. Extract the contract into a small frontend helper and a backend response/freshness convention, then port one adjacent surface to prove the pattern before touching topology.

## Sources

- Solid fine-grained reactivity: https://docs.solidjs.com/advanced-concepts/fine-grained-reactivity
- Solid `createMemo`: https://docs.solidjs.com/reference/basic-reactivity/create-memo
- Solid stores: https://docs.solidjs.com/concepts/stores
- D3 force simulations: https://d3js.org/d3-force/simulation
- MDN worker `requestAnimationFrame`: https://developer.mozilla.org/en-US/docs/Web/API/DedicatedWorkerGlobalScope/requestAnimationFrame
- Go singleflight: https://pkg.go.dev/golang.org/x/sync/singleflight
- Chi middleware: https://pkg.go.dev/github.com/go-chi/chi/v5/middleware
- Local `visual-kit`: `/Users/cblevins/workspace/libs/visual-kit/README.md`
- Local `py-diagram-gen`: `/Users/cblevins/workspace/libs/py-diagram-gen/README.md`
- Local `py-sprite-kit`: `/Users/cblevins/workspace/libs/py-sprite-kit/README.md`
- Local `py-chiptune`: `/Users/cblevins/workspace/libs/py-chiptune/README.md`
