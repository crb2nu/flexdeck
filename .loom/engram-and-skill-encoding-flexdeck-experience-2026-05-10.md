# Engram And Skill Encoding: FlexDeck Experience Patterns

**Date**: 2026-05-10
**Purpose**: Capture the repeatable parts of the FlexDeck SolidJS/Go experience research so future agents can reuse the patterns.

## Loom Skill Builder Encoding

Dry-run scaffold command executed:

```bash
python /Users/cblevins/.codex/skills/loom-skill-builder/scripts/skill_scaffold.py --root /Users/cblevins/workspace/services/loom-core --name flexdeck-experience-patterns --description "Use when improving SolidJS frontend and Go backend dashboard experiences with unified design tokens, generated SVG/diagram/audio artifacts, and performance guardrails." --categories frontend,performance,workflow
```

Result: the canonical registry would be `/Users/cblevins/workspace/services/loom-core/mcp/context/skills-registry.yaml`, with source directories under `/Users/cblevins/workspace/services/loom-core/mcp/skills/flexdeck-experience-patterns/`.

I did not apply the scaffold from the FlexDeck repo because that would be a cross-repo generated-skill change. Recommended source skill body:

```markdown
---
name: flexdeck-experience-patterns
description: "Use when improving SolidJS frontend and Go backend dashboard experiences with unified design tokens, generated SVG/diagram/audio artifacts, and performance guardrails."
---

# FlexDeck Experience Patterns

Use this for FlexDeck UI/backend work that touches operator dashboards, live data, visualizations, generated artifacts, or shared design tokens.

## Workflow

1. Classify the surface: form/table, snapshot panel, stream/watch panel, small SVG diagram, high-density Canvas graph, or generated artifact.
2. Choose the data contract: cache-aside, materialized snapshot, SSE/watch, or push snapshot. Include freshness metadata.
3. Preserve frontend calm: last-good data, refreshing vs loading, stale/partial/offline semantics, stable list identity, and batched state updates.
4. Choose the render engine by scale: Solid DOM, SVG, Canvas, Canvas + worker. Use Three only when 3D carries product meaning.
5. Bind all colors, radii, shadows, and generated assets to visual-kit/FlexDeck tokens.
6. Add proof: unit tests for controller/state contracts, visual/screenshot checks for layout, perf checks for high-density graphs, and Go tests for cache/snapshot handlers.

## Artifact Rules

- Use `py-diagram-gen` for architecture and flow diagrams that explain real operator workflows.
- Use `py-sprite-kit` for token-aligned icons, status effects, or sprite atlases where standard icons are insufficient.
- Use `py-chiptune` only for optional status sonification, demos, or accessibility experiments.
- Commit artifact source prompts/configs beside generated outputs.
```

## Agent Engram Encodings

The direct `agent_engram_add` tool was not available in this session, so these are encoded as agent-memory items with `category="engram"` and `uri:*` tags via `loom tools call agent_context__agent_memory_add`.

### Engram 1

- **URI**: `engram://solid-dashboard-snapshot-surface/typescript`
- **Tier**: 2
- **Problem**: Polling dashboards flicker, lose hover/focus state, and hide useful stale data during background refreshes.
- **Solution**: Standardize a Solid controller state shape with last-good data, loading vs refreshing, stale/partial/offline semantics, stable keyed list identity, batched setter updates, and explicit freshness thresholds.
- **Proof**: `command: npm run test -- --run src/lib/polling.test.ts src/lib/freshness.test.ts src/stores/dashboardSummary.test.ts` plus file references `web/src/lib/polling.ts:46`, `web/src/lib/stableList.ts:7`, `web/src/stores/dashboardSummary.ts:1`.

### Engram 2

- **URI**: `engram://go-stale-singleflight-cache/go`
- **Tier**: 2
- **Problem**: Expensive dashboard API handlers can stampede upstream K8s/Prometheus/GitLab dependencies and make UI refreshes uneven.
- **Solution**: Use Redis cache-aside with TTL jitter, stale fallback, background refresh, and `singleflight.Group` coalescing; expose freshness metadata when returning snapshots.
- **Proof**: `command: go test ./internal/cache ./internal/infra ./internal/api/handlers` plus file references `internal/cache/cache.go:112`, `internal/cache/cache.go:121`, `internal/cache/cache.go:128`, `internal/infra/worker.go:61`.

### Engram 3

- **URI**: `engram://dashboard-visualization-engine-ladder/typescript`
- **Tier**: 3
- **Problem**: Dashboard visualizations regress when small SVG/D3 patterns are reused for high-density live graphs.
- **Solution**: Pick the render engine by scale and interaction: Solid DOM for forms/tables, SVG for small semantic diagrams, Canvas for dense animated graphs, and workers/OffscreenCanvas for force layout or draw loops that risk long tasks. Carry perf counters and budgets with the component.
- **Proof**: `command: npm run test -- --run src/components/Dashboard/index.test.tsx && npm run perf:topology`; `benchmark: npm run perf:topology`; file references `web/src/components/Dashboard/TopologyGraph.tsx:36`, `web/src/components/Dashboard/TopologyGraph.tsx:75`, `web/src/components/Agents/AgentFlowGraph.tsx:57`.

### Engram 4

- **URI**: `engram://token-driven-generated-artifacts/flexdeck`
- **Tier**: 2
- **Problem**: Generated diagrams, SVGs, sprites, and audio cues can drift from product UI and become decorative noise.
- **Solution**: Use visual-kit/FlexDeck tokens as the artifact palette, commit source prompt/config next to outputs, and tie each artifact to a specific operator comprehension job. Prefer diagrams and SVG assets; keep chiptune optional and user-controlled.
- **Proof**: `command: npm run typecheck && npm run test -- --run src/styles/global.test.js`; file references `web/src/styles/variables.css:1`, `/Users/cblevins/workspace/libs/visual-kit/README.md`, `/Users/cblevins/workspace/libs/py-diagram-gen/README.md`, `/Users/cblevins/workspace/libs/py-sprite-kit/README.md`, `/Users/cblevins/workspace/libs/py-chiptune/README.md`.
