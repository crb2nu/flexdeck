---
description: Plan for Phase 3 "Sentient Control" features for FlexDeck.
---

# Phase 3: Sentient Control & Sci-Fi Aesthetics

This plan outlines the next generation of features to transform FlexDeck from a functional dashboard into an immersive, sci-fi inspired "Control Deck".

## Completed Features (Phase 2.5)

- [x] **High-Performance Topology Graph (Canvas)**: Switched from SVG to Canvas 2D for 60fps rendering of 500+ nodes. Added data traffic particle effects.
- [x] **Command Palette (⌘K)**: Quick launch navigation system with glassmorphic design and fade-in animations.
- [x] **"Neural Link" Agent Chat**: Replaced JSON test forms with a direct chat interface to AI agents, featuring "Generative UI" widget support.
- [x] **Digital Rain Placeholder**: "Matrix"-style canvas animation for uninitialized modules.

## Completed Features (Phase 3 — Infrastructure Integration)

### 3.1 FlexInfer CRD Integration ✅ (Pipeline #925 — deployed)

- [x] **Backend**: `internal/k8s/models_crd.go` — Dynamic K8s client queries `flexinfer.ai/v1alpha2` Model CRDs
- [x] **Backend**: `GET /api/models/crd` endpoint returns full CRD state
- [x] **Frontend types**: `FlexInferModel` + nested spec/status types in `types.ts`
- [x] **Frontend API**: `modelsApi.crd()` method
- [x] **Models page**: "Controller" tab with rich CRD cards showing phase lifecycle, GPU allocation, metrics, shared groups, KV-cache pressure, serverless config, LiteLLM integration, conditions

### 3.2 Langfuse Observability Integration ✅ (Pipeline #930 — in progress)

- [x] **Config**: `LangfuseConfig` with URL, public/secret key, disabled flag — defaults to `langfuse-web.ai.svc.cluster.local:3000`
- [x] **Backend**: `internal/api/handlers/langfuse.go` with 5 endpoints:
  - `GET /api/langfuse/health` — service reachability
  - `GET /api/langfuse/metrics` — daily usage metrics (tokens, costs, trace counts)
  - `GET /api/langfuse/traces` — recent traces with filters (name, user, time range)
  - `GET /api/langfuse/scores` — evaluation scores
  - `GET /api/langfuse/models` — per-model token/cost aggregation from observations
- [x] **Health endpoint**: Langfuse in feature map
- [x] **Frontend API**: `langfuse.health/metrics/traces/scores/models` methods

### 3.3 Prometheus Alerts API ✅ (Pipeline #930 — in progress)

- [x] **Frontend API**: `prom.alerts()` and `prom.rules()` wired to existing backend handlers

## In Progress / Next Up

### 3.4 Per-Model LiteLLM Metrics on CRD Cards

**Status**: Planned
**What**: Wire `litellm.modelMetrics(model)` into each CRD card on the Controller tab. Show real tok/s, request rate, and p50/p99 latency sparklines directly on the model card.
**Backend**: Already exists. No Go changes needed.
**Frontend**: Call `litellm.modelMetrics()` for each Ready model, display sparklines.

### 3.5 Prometheus Alerts Panel

**Status**: Planned
**What**: Add an alerts section to the Dashboard page. Show active firing/pending alerts from `/api/prom/alerts` with severity badges, alert name, labels, and duration.
**Frontend**: New `AlertsPanel` component in Dashboard.

### 3.6 Langfuse Observability Dashboard

**Status**: Planned
**What**: Build a dedicated observability page or Dashboard widget that visualizes Langfuse data:

- Daily usage chart (tokens/day, costs/day)
- Recent traces feed (name, latency, token counts, user)
- Per-model cost breakdown chart
- Evaluation scores overview
  **Frontend**: New page or Dashboard integration.

### 3.7 K8s Events SSE Feed

**Status**: Planned
**What**: Show a live event stream using the existing `/api/k8s/events/stream` SSE endpoint. Display pod starts, crashes, scale events, warnings in a scrolling feed.
**Frontend**: Enhanced `EventsFeed.tsx` in Dashboard with real-time SSE.

### 3.8 Node Resource Breakdown (GPU-aware)

**Status**: Planned
**What**: Visual per-node CPU/memory/GPU utilization using `/api/k8s/metrics/nodes`. Show each physical node with resource bars, GPU VRAM usage, and which models are scheduled where (cross-referencing CRD `status.gpu.node`).
**Frontend**: New Node panel or Dashboard integration.

## Proposed Features (Phase 3 — Sci-Fi UX)

### 3.A "Holo-Deck" 3D Cluster Visualization

- [x] **Goal**: Upgrade the 2D Topology Graph to a fully interactive 3D scene using Three.js.
- [x] **Visuals**: Implemented "Server Towers" with Neon Bloom, Custom Grid Shaders, and Particle Traffic along Bézier curves.
- [x] **Interactivity**: OrbitControls, Raycasting for Hover/Click, and "Holographic" aesthetic.

### 3.B Generative UI Expansion

**Goal**: Empower the "Neural Link" (Agent Chat) to render functional components on demand.

- **Widgets**: ChartWidget, LogWidget, ActionWidget.

### 3.C "Matrix" Log Visualizer

- [x] **Goal**: Visualize log streams.
- **Design**: Implemented "Flow" (Warp Speed) and "Matrix" (Digital Rain) modes in `LogStream.tsx`.

### 3.D Voice Command Integration ("Omni-Voice")

**Goal**: Hands-free control via "Hey FlexDeck" or microphone button.

### 3.E "Sentient" Status HUD

- **Header Upgrade**: Central "AI Core" visualizer reactive to cluster health.
- **Animations**: "Breathing" borders, holographic scan lines on hover.

## Implementation Priorities

1. **Langfuse Dashboard Widget** (3.6): High value — makes the Langfuse integration visible immediately.
2. **Alerts Panel** (3.5): Critical ops visibility — consumes existing backend.
3. **Per-Model Metrics** (3.4): Quick win — connects existing APIs.
4. **Node Resource Breakdown** (3.8): Ties CRD GPU data to physical infra.
