# Brainstorm: FlexDeck SolidJS + Go Experience Patterns

**Date**: 2026-05-10
**Triggered by**: Research and brainstorm improved SolidJS frontend and backend patterns for performant, smooth, beautiful FlexDeck experiences with unified tokens and generated artifacts.
**Constraints noted**: Preserve existing SolidJS + Tailwind + Go/Chi architecture; use `libs/visual-kit` tokens; keep render loops smooth; prefer existing local artifact tools (`py-sprite-kit`, `py-diagram-gen`, `py-chiptune`) where they create real product value.

## Phase 1 - Framings

### F1 - Reactive State Contracts

Treat every busy dashboard surface as a small reactive state machine: last-good snapshot, refresh-in-flight, stale/fallback/offline state, explicit operator copy, and stable row identity. This extends existing FlexDeck patterns from `web/src/lib/polling.ts`, `web/src/lib/stableList.ts`, `web/src/lib/freshness.ts`, and panel-level stale UX into a standard surface contract.

- **Bet**: Most perceived jank comes from unstable data identity and ambiguous background refresh states.
- **Risk**: Over-standardizing too soon can flatten legitimate differences between logs, topology, metrics, and control-plane workflows.

### F2 - Visualization Engine Ladder

Choose rendering technology by data size and interaction needs: Solid DOM for forms and low-cardinality panels, SVG for small semantic diagrams, Canvas for high-cardinality live topology, Web Worker/OffscreenCanvas for force layout or render work that can freeze the main thread. FlexDeck already has the advanced end of this ladder in `TopologyGraph.tsx`; the gap is making the ladder explicit for newer graph/chart work.

- **Bet**: A clear ladder prevents components like `AgentFlowGraph.tsx` from growing into expensive SVG/D3 islands without inheriting topology's perf lessons.
- **Risk**: Moving too much into workers can make accessibility, testing, and debugging worse for views that do not need it.

### F3 - Token-First Interface Polish

Make `variables.css` plus `visual-kit` the source of visual truth, then drive all generated SVG, diagrams, sprites, and chart colors from those tokens. The goal is less decorative novelty and more coherent operational mood: quiet surfaces, crisp status semantics, restrained motion, and artifact assets that look native to FlexDeck.

- **Bet**: Beauty comes more from token consistency, hierarchy, and motion discipline than from adding new visual effects.
- **Risk**: If visual-kit and FlexDeck local tokens drift, generated assets will expose the mismatch more loudly.

### F4 - Materialized Backend Snapshots

Move expensive multi-upstream reads behind materialized snapshots, stale-while-revalidate cache behavior, and singleflight coalescing. The infra worker and Redis cache already prove this approach; apply it to metrics/traffic/model surfaces before adding frontend cleverness.

- **Bet**: A smooth UI is impossible if the backend repeatedly fans out to Prometheus/K8s/GitLab on every screen refresh.
- **Risk**: Snapshot contracts need clear freshness metadata or operators may trust old data too much.

### F5 - Artifact-Assisted Comprehension

Use `py-diagram-gen` for architecture diagrams in docs and operator drilldowns, `py-sprite-kit` for compact token-aligned icon/sprite atlases where lucide symbols are not expressive enough, and `py-chiptune` only for optional short status sonification or demos. Generated artifacts should be build products with source prompts/configs committed beside them.

- **Bet**: FlexDeck's domain is complex enough that diagrams and domain-specific visual artifacts can reduce cognitive load.
- **Risk**: Artifact generation can become visual churn unless tied to concrete screens and validation.

### F6 - Progressive Live Data

Use polling for coarse snapshots, SSE/EventSource for append-only or watch-style streams, and push-mode snapshots for local agent presence. Make the connection mode visible through shared freshness semantics, not one-off banners. This fits existing K8s, Loki, HUD, Model CRD, and cache watch endpoints.

- **Bet**: Matching transport to data shape cuts network waste and improves trust in live views.
- **Risk**: Too many transport paths can create duplicated reconnection and error-state logic.

### F7 - Performance Budgets As Product Constraints

Treat frame time, topology build time, long tasks, request bursts, and cache hit/stale-hit ratios as release gates for the main operator surfaces. Topology already exposes detailed perf counters; generalize the habit to charts, tables, and backend snapshot handlers.

- **Bet**: Smoothness needs budgets that fail locally before users feel degradation.
- **Risk**: Budgets that are hard to run will rot; they must attach to existing `npm run test`, `npm run perf:topology`, `go test`, or lightweight smoke scripts.

## Phase 2 - Cross-Pollinations & Tensions

### Combinations

- **F1 + F4**: A "snapshot surface contract" where Go returns freshness metadata and Solid preserves last-good UI state produces fewer loading flashes and fewer redundant upstream calls.
- **F2 + F3 + F5**: A visualization kit can encode when to use DOM/SVG/Canvas/worker and how generated sprites/diagrams inherit tokens, giving future agents a tastefully narrow path.
- **F6 + F7**: Transport selection should be measured: polling interval jitter, SSE reconnect behavior, and request burst budgets become part of the user experience, not invisible plumbing.

### Tensions

- **F2 vs. F5**: Render engines should stay pragmatic while artifact tools invite richness. The axis is "does this asset carry operational information, or is it just decoration?"
- **F3 vs. product delight**: Unified tokens create coherence, but an overly rigid palette can make every surface feel identical. Use accent and motion to clarify state, not to brand every panel.

## Phase 3 - Convergence

### Recommended: F1 + F4 + F7

Standardize the snapshot surface contract first: backend materialized or cache-aside snapshots with freshness metadata; frontend last-good state, stable list identity, stale/partial/offline semantics, and measurable refresh behavior. This wins because it directly improves smoothness and operator trust while matching code that already exists in FlexDeck.

### Runner-up: F2 + F3 + F5

Build the token-driven visualization/artifact kit next. This becomes the beauty multiplier once the data contract is calm: generated SVGs, diagrams, sprite atlases, and optional chiptune cues can feel native because they inherit tokens and motion budgets. This should follow, not precede, the state/perf contract.

### Open question

Which surface should become the reference implementation for the contract: Infra snapshot, Metrics traffic report, Agent HUD, or FlexInfer Workbench telemetry?

## Handoff

- If chosen -> next step is: `plan-loom-core` for a narrow implementation plan, then `feature-dev`.
- Research brief: `.loom/research-flexdeck-solid-go-experience-2026-05-10.md`
- Engram/skill-builder encoding: `.loom/engram-and-skill-encoding-flexdeck-experience-2026-05-10.md`
