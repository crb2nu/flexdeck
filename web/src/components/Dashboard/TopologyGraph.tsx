import { Component, createSignal, createEffect, onMount, onCleanup, Show, untrack } from 'solid-js';
import * as d3 from 'd3';
import type { K8sNode, K8sPod, K8sService } from '../../lib/types';
import { diffFiAccelMetrics, getFiAccelMetricsSnapshot, type FiAccelMetricsDelta } from '../../lib/fiAccel';
import {
  buildTopologyGraphData,
  createTopologySimulation,
  getNamespaceColor,
  type BuildInput,
  type BuildResult,
} from './topology/layoutEngine';
import type { TopologyNode as D3Node, TopologyLink as D3Link } from './topology/types';

// Debounce utility
const debounce = <T extends (...args: unknown[]) => void>(fn: T, ms: number): T => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  }) as T;
};

const isNodeReady = (node: K8sNode): boolean =>
  node.status.conditions.some((condition) => condition.type === 'Ready' && condition.status === 'True');

interface Props {
  nodes: K8sNode[];
  pods: K8sPod[];
  services: K8sService[];
  topologyVersion: number;
  styleVersion: number;
  onNodeClick?: (node: D3Node) => void;
}

// Particle pool for zero-allocation animation
const MAX_PARTICLES = 40;
const LARGE_GRAPH_NODE_THRESHOLD = 600;
const LARGE_GRAPH_LINK_THRESHOLD = 1200;
const DENSITY_OVERVIEW_NODE_THRESHOLD = 600;
const DENSITY_OVERVIEW_POD_THRESHOLD = 300;
const DENSITY_OVERVIEW_ZOOM_THRESHOLD = 1.25;
const DENSITY_OVERVIEW_TRANSITION_BAND = 0.22;
const PARTICLE_IDLE_MS = 1500;
const INTERACTION_IDLE_MS = 800;
const SPATIAL_GRID_ACTIVE_REBUILD_MS = 48;
const NODE_SPRITE_PADDING = 18;
const PAN_PREVIEW_COMMIT_MS = 96;
interface ParticleSlot {
  active: boolean;
  sourceIdx: number;
  targetIdx: number;
  progress: number;
  speed: number;
  colorIdx: 0 | 1; // 0 = cyan, 1 = purple
}

// Cached font strings to avoid per-frame string allocation
const FONT_NODE = '500 11px Inter, system-ui';
const FONT_OTHER = '400 9px Inter, system-ui';
const PERF_QUERY_PARAM = 'topologyPerf';
const PERF_STORAGE_KEY = 'flexdeck.topologyPerf';
const PERF_HUD_UPDATE_MS = 500;
const PERF_FRAME_WINDOW = 180;
const DENSITY_OVERVIEW_NEAR_FULL_BLEND = 0.98;
const SIMULATION_REFRESH_MS_RAW = 1000 / 45;
const SIMULATION_REFRESH_MS_DENSE = 1000 / 26;
const SIMULATION_REFRESH_MS_OVERVIEW = 1000 / 18;
const SIMULATION_REFRESH_MS_SETTLED = 1000 / 16;
const SIMULATION_VISIBILITY_REFRESH_MS_RAW = 1000 / 30;
const SIMULATION_VISIBILITY_REFRESH_MS_DENSE = 1000 / 18;
const SIMULATION_VISIBILITY_REFRESH_MS_OVERVIEW = 1000 / 12;
const FRAME_PRESSURE_SCORE_MAX = 12;

interface PerfCounters {
  effectRuns: number;
  topologyRebuilds: number;
  styleRefreshes: number;
  simulationInits: number;
  simulationSettles: number;
  simulationTotalSettleMs: number;
  drawStarts: number;
  drawStops: number;
  framesRendered: number;
  denseFrameSkips: number;
  maxFrameMs: number;
  legacyHashEntityVisitsAvoided: number;
  baseLayerDraws: number;
  overlayLayerDraws: number;
  visibilityRefreshes: number;
  visibilityRefreshTotalMs: number;
  workerTickMessages: number;
  simulationVisualRefreshes: number;
  simulationVisualDeferrals: number;
  framePressureScore: number;
}

interface PerfSnapshot {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  nodes: number;
  links: number;
  effectRuns: number;
  topologyRebuilds: number;
  styleRefreshes: number;
  simulationInits: number;
  simulationSettles: number;
  avgSimulationSettleMs: number;
  drawStarts: number;
  drawStops: number;
  framesRendered: number;
  denseFrameSkips: number;
  legacyHashEntityVisitsAvoided: number;
  baseLayerDraws: number;
  overlayLayerDraws: number;
  visibilityRefreshes: number;
  avgVisibilityRefreshMs: number;
  workerTickMessages: number;
  simulationVisualRefreshes: number;
  simulationVisualDeferrals: number;
  framePressureScore: number;
  fiAccelBuildMode: 'main' | 'worker';
  fiAccelInitState: string;
  fiAccelSelectorCalls: number;
  fiAccelSelectorFallbackCalls: number;
  fiAccelSelectorCandidates: number;
  fiAccelSelectorMs: number;
}

interface LiveTopologyStats {
  fps: number;
  avgFrameMs: number;
  nodes: number;
  links: number;
  lastBuildMs: number;
  lastSettleMs: number;
  fiAccelSelectorCalls: number;
  fiAccelSelectorCandidates: number;
  fiAccelSelectorMs: number;
}

interface BuildExecutionMetrics {
  mode: 'main' | 'worker';
  buildMs: number;
  fiAccel: FiAccelMetricsDelta;
}

interface BuildExecutionResult {
  graphData: BuildResult;
  buildMetrics: BuildExecutionMetrics;
}

interface NamespaceAggregateEntry {
  namespace: string;
  color: string;
  x: number;
  y: number;
  memberCount: number;
  podCount: number;
  serviceCount: number;
}

interface WorkerBuildRequest {
  type: 'build';
  requestId: number;
  input: BuildInput;
  width: number;
  height: number;
}

interface WorkerBuildSuccess {
  type: 'result';
  requestId: number;
  graphData: BuildResult;
  buildMetrics: BuildExecutionMetrics;
}

interface WorkerTickMessage {
  type: 'tick';
  requestId: number;
  alpha: number;
  settled: boolean;
  positions: ArrayBuffer;
}

interface WorkerBuildFailure {
  type: 'error';
  requestId: number;
  error: string;
}

interface WorkerDragRequest {
  type: 'drag';
  requestId: number;
  phase: 'start' | 'move' | 'end';
  nodeId: string;
  x?: number;
  y?: number;
}

interface WorkerResizeRequest {
  type: 'resize';
  requestId: number;
  width: number;
  height: number;
}

type WorkerBuildMessage = WorkerBuildSuccess | WorkerBuildFailure | WorkerTickMessage;

interface WorkerBuildPending {
  resolve: (result: BuildExecutionResult) => void;
  reject: (error: Error) => void;
}

const TopologyGraph: Component<Props> = (props) => {
  let baseCanvasRef: HTMLCanvasElement | undefined;
  let overlayCanvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let baseCanvasCtx: CanvasRenderingContext2D | null = null;
  let overlayCanvasCtx: CanvasRenderingContext2D | null = null;
  let simulation: d3.Simulation<D3Node, D3Link> | null = null;
  let rafId: number | null = null;
  let lastTopologyVersion = -1;
  let lastStyleVersion = -1;
  let topologyWorker: Worker | null = null;
  let topologyWorkerRequestId = 0;
  let pendingBuildRequestId = 0;
  let activeWorkerRequestId = 0;
  let panPreviewCommitTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let baseRasterTransform = { x: 0, y: 0, k: 1 };
  let activeSimulationMode: 'main' | 'worker' | null = null;
  let currentSimulationAlpha = 0;
  const workerBuildRequests = new Map<number, WorkerBuildPending>();
  let topologySyncTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // State
  const [selectedNode, setSelectedNode] = createSignal<D3Node | null>(null);
  const [hoverNode, setHoverNode] = createSignal<D3Node | null>(null);
  const [dimensions, setDimensions] = createSignal({ width: 800, height: 600 });
  const [nodeCount, setNodeCount] = createSignal(0);
  const [perfSnapshot, setPerfSnapshot] = createSignal<PerfSnapshot | null>(null);
  const [liveTopologyStats, setLiveTopologyStats] = createSignal<LiveTopologyStats>({
    fps: 0,
    avgFrameMs: 0,
    nodes: 0,
    links: 0,
    lastBuildMs: 0,
    lastSettleMs: 0,
    fiAccelSelectorCalls: 0,
    fiAccelSelectorCandidates: 0,
    fiAccelSelectorMs: 0,
  });
  const [topologySyncing, setTopologySyncing] = createSignal(false);
  const [densityOverviewActive, setDensityOverviewActive] = createSignal(false);
  const [densityOverviewHiddenPods, setDensityOverviewHiddenPods] = createSignal(0);
  const [densityOverviewHiddenServices, setDensityOverviewHiddenServices] = createSignal(0);

  // View transform state
  let transform = d3.zoomIdentity;

  // Data state
  let graphNodes: D3Node[] = [];
  let graphLinks: D3Link[] = [];
  let hostsLinks: D3Link[] = [];
  let selectsLinks: D3Link[] = [];
  let namespaceMap = new Map<string, number>();
  const nodeIndexMap = new Map<string, number>(); // O(1) lookup for particle spawning
  const graphNodeById = new Map<string, D3Node>();

  // Object pool for particles - zero allocations during animation
  const particlePool: ParticleSlot[] = Array.from({ length: MAX_PARTICLES }, () => ({
    active: false,
    sourceIdx: 0,
    targetIdx: 0,
    progress: 0,
    speed: 0,
    colorIdx: 0
  }));
  let activeParticleCount = 0;

  // Pre-allocated array for particle positions - avoids allocation every frame
  const particlePositionsPool: { x: number; y: number; colorIdx: 0 | 1 }[] =
    Array.from({ length: MAX_PARTICLES }, () => ({ x: 0, y: 0, colorIdx: 0 }));

  // Performance optimization state
  let cachedGradient: CanvasGradient | null = null;
  let cachedGradientDims = { width: 0, height: 0 };
  let isSimulationActive = false;
  let frameCount = 0;
  let isAnimating = false;
  let simulationSettledAt = 0; // Timestamp when simulation settled
  let lastFrameTime = 0;
  let lastInteractionAt = -Infinity;
  let simulationStartedAt = 0;
  let perfEnabled = false;
  let lastPerfHudUpdate = 0;
  let lastTopologyBuildMs = 0;
  let lastSimulationSettleMs = 0;
  let lastBuildMode: 'main' | 'worker' = 'main';
  let lastFiAccelBuildDelta: FiAccelMetricsDelta = {
    initState: 'loading',
    logAnalyzeCalls: 0,
    logAnalyzeFallbackCalls: 0,
    logAnalyzeLines: 0,
    logAnalyzeMs: 0,
    selectorFilterCalls: 0,
    selectorFilterFallbackCalls: 0,
    selectorFilterCandidates: 0,
    selectorFilterMs: 0,
  };
  let sourceNodeCount = 0;
  let sourcePodCount = 0;
  let sourceServiceCount = 0;
  let frameSampleCount = 0;
  let frameSampleCursor = 0;
  let baseLayerDirty = true;
  let overlayLayerDirty = true;
  let viewportCacheDirty = true;
  let pendingSimulationVisualUpdate = false;
  let pendingVisibilityRefresh = true;
  let pendingNamespaceAggregateRefresh = true;
  let lastSimulationVisualRefreshAt = -Infinity;
  let lastVisibilityRefreshAt = -Infinity;
  let framePressureScore = 0;
  let underFramePressure = false;
  const frameSamples = new Float32Array(PERF_FRAME_WINDOW);
  const perfCounters: PerfCounters = {
    effectRuns: 0,
    topologyRebuilds: 0,
    styleRefreshes: 0,
    simulationInits: 0,
    simulationSettles: 0,
    simulationTotalSettleMs: 0,
    drawStarts: 0,
    drawStops: 0,
    framesRendered: 0,
    denseFrameSkips: 0,
    maxFrameMs: 0,
    legacyHashEntityVisitsAvoided: 0,
    baseLayerDraws: 0,
    overlayLayerDraws: 0,
    visibilityRefreshes: 0,
    visibilityRefreshTotalMs: 0,
    workerTickMessages: 0,
    simulationVisualRefreshes: 0,
    simulationVisualDeferrals: 0,
    framePressureScore: 0,
  };

  // Node style cache - recomputed only when nodes change, not every frame
  // Includes pre-truncated labels to avoid string allocation every frame
  const nodeStylesCache = new Map<string, { r: number; color: string; truncLabel: string }>();
  const nodeSpriteCache = new Map<string, HTMLCanvasElement>();
  let nodeStylesCacheValid = false;

  // Frustum bounds cache - recomputed only when transform/dimensions change
  const cachedFrustum = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const lastFrustumTransform = { x: -Infinity, y: -Infinity, k: -Infinity };
  const lastFrustumDims = { width: -1, height: -1 };

  // Spatial grid index for O(1) hover detection (replaces O(N) iteration)
  const GRID_CELL_SIZE = 50; // Pixels per cell
  const GRID_KEY_MULTIPLIER = 100000; // Supports grid coords from -50000 to +50000
  const spatialGrid = new Map<number, number[]>();
  const activeSpatialGridKeys: number[] = [];
  let spatialGridValid = false;
  let spatialGridDirty = false;
  let lastSpatialGridBuildAt = -Infinity;
  const visibleNodeIndices: number[] = [];
  let visibleNodeFlags = new Uint8Array(0);
  let lastVisibleNodeCount = 0;
  // Pre-filtered visible link indices (populated in updateVisibleNodes)
  const visibleHostsLinkIndices: number[] = [];
  const visibleSelectsLinkIndices: number[] = [];
  let lastVisibleHostsLinkCount = 0;
  let lastVisibleSelectsLinkCount = 0;
  const namespaceAggregatePool: NamespaceAggregateEntry[] = [];
  const namespaceAggregateIndex = new Map<string, NamespaceAggregateEntry>();
  let lastNamespaceAggregateCount = 0;
  let renderedTopologyNodeCount = 0;
  let renderedTopologyLinkCount = 0;
  const bumpInteraction = () => {
    lastInteractionAt = performance.now();
  };
  const invalidateBaseLayer = (invalidateViewport = false) => {
    baseLayerDirty = true;
    if (invalidateViewport) {
      viewportCacheDirty = true;
      pendingVisibilityRefresh = true;
      pendingNamespaceAggregateRefresh = true;
    }
  };
  const invalidateOverlayLayer = () => {
    overlayLayerDirty = true;
  };
  const invalidateViewport = () => {
    viewportCacheDirty = true;
    pendingVisibilityRefresh = true;
    pendingNamespaceAggregateRefresh = true;
    baseLayerDirty = true;
    overlayLayerDirty = true;
  };
  const clearPanPreviewCommit = () => {
    if (panPreviewCommitTimeoutId) {
      clearTimeout(panPreviewCommitTimeoutId);
      panPreviewCommitTimeoutId = null;
    }
  };
  const clearTopologySyncTimeout = () => {
    if (topologySyncTimeoutId) {
      clearTimeout(topologySyncTimeoutId);
      topologySyncTimeoutId = null;
    }
  };
  const markTopologySyncing = () => {
    clearTopologySyncTimeout();
    setTopologySyncing(true);
  };
  const markTopologySynced = () => {
    clearTopologySyncTimeout();
    topologySyncTimeoutId = setTimeout(() => {
      topologySyncTimeoutId = null;
      setTopologySyncing(false);
    }, 220);
  };
  const clearBaseCanvasPreview = () => {
    if (!baseCanvasRef) return;
    baseCanvasRef.style.transform = '';
    baseCanvasRef.style.transformOrigin = '';
  };
  const hasActiveOverlayState = (): boolean =>
    activeParticleCount > 0 ||
    hoverNode() !== null ||
    selectedNode() !== null;
  const syncBaseRasterTransform = () => {
    baseRasterTransform = { x: transform.x, y: transform.y, k: transform.k };
    clearBaseCanvasPreview();
  };
  const applyBaseCanvasPreview = (nextTransform: d3.ZoomTransform) => {
    if (!baseCanvasRef) return;
    const baseScale = baseRasterTransform.k || 1;
    const scale = nextTransform.k / baseScale;
    const translateX = nextTransform.x - baseRasterTransform.x * scale;
    const translateY = nextTransform.y - baseRasterTransform.y * scale;
    baseCanvasRef.style.transformOrigin = '0 0';
    baseCanvasRef.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${translateX}, ${translateY})`;
  };
  const scheduleBaseLayerCommit = () => {
    clearPanPreviewCommit();
    panPreviewCommitTimeoutId = setTimeout(() => {
      panPreviewCommitTimeoutId = null;
      invalidateViewport();
      startAnimationLoop();
    }, PAN_PREVIEW_COMMIT_MS);
  };

  const readPerfToggle = (): boolean => {
    if (typeof window === 'undefined') return false;
    const search = new URLSearchParams(window.location.search);
    if (search.get(PERF_QUERY_PARAM) === '1') return true;
    return window.localStorage.getItem(PERF_STORAGE_KEY) === '1';
  };

  const recordFrameSample = (frameMs: number) => {
    perfCounters.framesRendered++;
    perfCounters.maxFrameMs = Math.max(perfCounters.maxFrameMs, frameMs);
    frameSamples[frameSampleCursor] = frameMs;
    frameSampleCursor = (frameSampleCursor + 1) % PERF_FRAME_WINDOW;
    frameSampleCount = Math.min(frameSampleCount + 1, PERF_FRAME_WINDOW);
  };

  const collectFrameStats = () => {
    const samples = Array.from(frameSamples.slice(0, frameSampleCount));
    let avgFrameMs = 0;
    if (samples.length > 0) {
      let total = 0;
      for (const sample of samples) total += sample;
      avgFrameMs = total / samples.length;
      samples.sort((a, b) => a - b);
    }
    const p95Index = samples.length > 0 ? Math.min(samples.length - 1, Math.floor(samples.length * 0.95)) : 0;
    const p95FrameMs = samples.length > 0 ? samples[p95Index] : 0;
    const fps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;
    return { avgFrameMs, fps, p95FrameMs };
  };

  const buildPerfSnapshot = (): PerfSnapshot => {
    const { avgFrameMs, fps, p95FrameMs } = collectFrameStats();
    const avgSimulationSettleMs = perfCounters.simulationSettles > 0
      ? perfCounters.simulationTotalSettleMs / perfCounters.simulationSettles
      : 0;
    const avgVisibilityRefreshMs = perfCounters.visibilityRefreshes > 0
      ? perfCounters.visibilityRefreshTotalMs / perfCounters.visibilityRefreshes
      : 0;

    return {
      fps,
      avgFrameMs,
      p95FrameMs,
      maxFrameMs: perfCounters.maxFrameMs,
      nodes: graphNodes.length,
      links: graphLinks.length,
      effectRuns: perfCounters.effectRuns,
      topologyRebuilds: perfCounters.topologyRebuilds,
      styleRefreshes: perfCounters.styleRefreshes,
      simulationInits: perfCounters.simulationInits,
      simulationSettles: perfCounters.simulationSettles,
      avgSimulationSettleMs,
      drawStarts: perfCounters.drawStarts,
      drawStops: perfCounters.drawStops,
      framesRendered: perfCounters.framesRendered,
      denseFrameSkips: perfCounters.denseFrameSkips,
      legacyHashEntityVisitsAvoided: perfCounters.legacyHashEntityVisitsAvoided,
      baseLayerDraws: perfCounters.baseLayerDraws,
      overlayLayerDraws: perfCounters.overlayLayerDraws,
      visibilityRefreshes: perfCounters.visibilityRefreshes,
      avgVisibilityRefreshMs,
      workerTickMessages: perfCounters.workerTickMessages,
      simulationVisualRefreshes: perfCounters.simulationVisualRefreshes,
      simulationVisualDeferrals: perfCounters.simulationVisualDeferrals,
      framePressureScore: perfCounters.framePressureScore,
      fiAccelBuildMode: lastBuildMode,
      fiAccelInitState: lastFiAccelBuildDelta.initState,
      fiAccelSelectorCalls: lastFiAccelBuildDelta.selectorFilterCalls,
      fiAccelSelectorFallbackCalls: lastFiAccelBuildDelta.selectorFilterFallbackCalls,
      fiAccelSelectorCandidates: lastFiAccelBuildDelta.selectorFilterCandidates,
      fiAccelSelectorMs: lastFiAccelBuildDelta.selectorFilterMs,
    };
  };

  const maybeUpdatePerfHud = (now: number) => {
    if (now - lastPerfHudUpdate < PERF_HUD_UPDATE_MS) return;
    lastPerfHudUpdate = now;
    const frameStats = collectFrameStats();
    const liveStats = {
      fps: frameStats.fps,
      avgFrameMs: frameStats.avgFrameMs,
      nodes: densityOverviewActive() ? renderedTopologyNodeCount : (renderedTopologyNodeCount || graphNodes.length),
      links: densityOverviewActive() ? renderedTopologyLinkCount : (renderedTopologyLinkCount || graphLinks.length),
      lastBuildMs: lastTopologyBuildMs,
      lastSettleMs: lastSimulationSettleMs,
      fiAccelSelectorCalls: lastFiAccelBuildDelta.selectorFilterCalls,
      fiAccelSelectorCandidates: lastFiAccelBuildDelta.selectorFilterCandidates,
      fiAccelSelectorMs: lastFiAccelBuildDelta.selectorFilterMs,
    };
    setLiveTopologyStats(liveStats);
    if (typeof window !== 'undefined') {
      (window as Window & { __FLEXDECK_TOPOLOGY_LIVE__?: LiveTopologyStats }).__FLEXDECK_TOPOLOGY_LIVE__ = liveStats;
    }
    if (!perfEnabled) return;
    const snapshot = buildPerfSnapshot();
    setPerfSnapshot(snapshot);
    if (typeof window !== 'undefined') {
      (window as Window & { __FLEXDECK_TOPOLOGY_PERF__?: PerfSnapshot }).__FLEXDECK_TOPOLOGY_PERF__ = snapshot;
    }
  };

  const resetParticles = () => {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const slot = particlePool[i];
      slot.active = false;
      slot.progress = 0;
    }
    activeParticleCount = 0;
  };

  // Use numeric key instead of string concatenation - avoids allocation
  const getSpatialKey = (x: number, y: number): number => {
    const cellX = Math.floor(x / GRID_CELL_SIZE);
    const cellY = Math.floor(y / GRID_CELL_SIZE);
    return cellX * GRID_KEY_MULTIPLIER + cellY;
  };

  const rebuildSpatialGrid = (now = performance.now()) => {
    for (let i = 0; i < activeSpatialGridKeys.length; i++) {
      const bucket = spatialGrid.get(activeSpatialGridKeys[i]);
      if (bucket) bucket.length = 0;
    }
    activeSpatialGridKeys.length = 0;

    const useVisibleNodes = lastVisibleNodeCount > 0 && lastVisibleNodeCount < graphNodes.length;
    if (useVisibleNodes) {
      for (let i = 0; i < lastVisibleNodeCount; i++) {
        const nodeIndex = visibleNodeIndices[i];
        const node = graphNodes[nodeIndex];
        if (!node || node.x === undefined || node.y === undefined) continue;
        const key = getSpatialKey(node.x, node.y);
        let bucket = spatialGrid.get(key);
        if (!bucket) {
          bucket = [];
          spatialGrid.set(key, bucket);
        }
        if (bucket.length === 0) activeSpatialGridKeys.push(key);
        bucket.push(nodeIndex);
      }
    } else {
      for (let nodeIndex = 0; nodeIndex < graphNodes.length; nodeIndex++) {
        const node = graphNodes[nodeIndex];
        if (node.x === undefined || node.y === undefined) continue;
        const key = getSpatialKey(node.x, node.y);
        let bucket = spatialGrid.get(key);
        if (!bucket) {
          bucket = [];
          spatialGrid.set(key, bucket);
        }
        if (bucket.length === 0) activeSpatialGridKeys.push(key);
        bucket.push(nodeIndex);
      }
    }
    spatialGridValid = true;
    spatialGridDirty = false;
    lastSpatialGridBuildAt = now;
  };

  const findNearestNodeInGrid = (x: number, y: number): D3Node | null => {
    let minDistSq = Infinity;
    let found: D3Node | null = null;

    // Check the cell and adjacent cells for nodes near the point.
    // This avoids temporary candidate array allocation on every mouse event.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = getSpatialKey(x + dx * GRID_CELL_SIZE, y + dy * GRID_CELL_SIZE);
        const cellNodeIndices = spatialGrid.get(key);
        if (!cellNodeIndices) continue;
        for (let i = 0; i < cellNodeIndices.length; i++) {
          const node = graphNodes[cellNodeIndices[i]];
          if (node.x === undefined || node.y === undefined) continue;
          const deltaX = x - node.x;
          const deltaY = y - node.y;
          const distSq = deltaX * deltaX + deltaY * deltaY;
          const cached = nodeStylesCache.get(node.id);
          const radius = (cached?.r ?? getNodeRadius(node)) + 4;
          const radiusSq = radius * radius;
          if (distSq < radiusSq && distSq < minDistSq) {
            minDistSq = distSq;
            found = node;
          }
        }
      }
    }
    return found;
  };

  const refreshNodeData = () => {
    if (graphNodes.length === 0) return;

    for (const nodeData of props.nodes) {
      const graphNode = graphNodeById.get(`node-${nodeData.metadata.name}`);
      if (graphNode) {
        graphNode.data = nodeData;
        graphNode.status = isNodeReady(nodeData) ? 'ok' : 'error';
      }
    }

    for (const podData of props.pods) {
      const namespace = podData.metadata.namespace ?? 'undefined';
      const graphNode = graphNodeById.get(`pod-${namespace}-${podData.metadata.name}`);
      if (graphNode) {
        graphNode.data = podData;
        graphNode.status = podData.status.phase === 'Running'
          ? 'ok'
          : podData.status.phase === 'Pending'
            ? 'warn'
            : 'error';
      }
    }

    for (const serviceData of props.services) {
      const namespace = serviceData.metadata.namespace ?? 'undefined';
      const graphNode = graphNodeById.get(`svc-${namespace}-${serviceData.metadata.name}`);
      if (graphNode) {
        graphNode.data = serviceData;
        graphNode.status = 'ok';
      }
    }

    nodeStylesCacheValid = false;
    invalidateBaseLayer();
    invalidateOverlayLayer();
    if (!isAnimating) startAnimationLoop();
  };

  const applyGraphData = (graphData: BuildResult) => {
    graphNodes = graphData.nodes;
    graphLinks = graphData.links;
    hostsLinks = graphData.hostsLinks;
    selectsLinks = graphData.selectsLinks;
    namespaceMap = graphData.namespaceMap;

    // Build O(1) index map for particle spawning
    graphNodeById.clear();
    nodeIndexMap.clear();
    graphNodes.forEach((node, idx) => {
      graphNodeById.set(node.id, node);
      nodeIndexMap.set(node.id, idx);
    });
    if (visibleNodeFlags.length !== graphNodes.length) {
      visibleNodeFlags = new Uint8Array(graphNodes.length);
    } else {
      visibleNodeFlags.fill(0);
    }
    for (let i = 0; i < graphLinks.length; i++) {
      const link = graphLinks[i];
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      link.sourceIdx = nodeIndexMap.get(sourceId);
      link.targetIdx = nodeIndexMap.get(targetId);
    }
    visibleNodeIndices.length = graphNodes.length;
    visibleHostsLinkIndices.length = hostsLinks.length;
    visibleSelectsLinkIndices.length = selectsLinks.length;

    // Invalidate style cache - will be rebuilt on next draw
    nodeStylesCacheValid = false;
    // Invalidate spatial grid - will be rebuilt on next hover check
    spatialGridValid = false;
    spatialGridDirty = true;
    invalidateViewport();

    setNodeCount(graphNodes.length);
  };

  const buildGraphDirect = (): BuildExecutionResult => {
    sourceNodeCount = props.nodes.length;
    sourcePodCount = props.pods.length;
    sourceServiceCount = props.services.length;
    const fiAccelBefore = getFiAccelMetricsSnapshot();
    const buildStartedAt = performance.now();
    const graphData = buildTopologyGraphData({
      nodes: props.nodes,
      pods: props.pods,
      services: props.services,
      prevNodes: graphNodes
    });

    return {
      graphData,
      buildMetrics: {
        mode: 'main',
        buildMs: performance.now() - buildStartedAt,
        fiAccel: diffFiAccelMetrics(fiAccelBefore, getFiAccelMetricsSnapshot()),
      },
    };
  };

  const rejectPendingWorkerBuilds = (error: Error) => {
    for (const pending of workerBuildRequests.values()) {
      pending.reject(error);
    }
    workerBuildRequests.clear();
  };

  const handleWorkerTick = (message: WorkerTickMessage) => {
    if (message.requestId !== activeWorkerRequestId) return;
    if (message.positions.byteLength !== graphNodes.length * 2 * Float32Array.BYTES_PER_ELEMENT) return;
    perfCounters.workerTickMessages++;

    const positions = new Float32Array(message.positions);
    for (let i = 0; i < graphNodes.length; i++) {
      const node = graphNodes[i];
      node.x = positions[i * 2];
      node.y = positions[i * 2 + 1];
    }

    currentSimulationAlpha = message.alpha;
    spatialGridDirty = true;
    pendingSimulationVisualUpdate = true;
    if (hasActiveOverlayState()) {
      overlayLayerDirty = true;
    }
    startAnimationLoop();

    if (!message.settled) {
      isSimulationActive = true;
      return;
    }

    if (!isSimulationActive) return;
    isSimulationActive = false;
    simulationSettledAt = performance.now();
    invalidateViewport();
    if (simulationStartedAt > 0) {
      lastSimulationSettleMs = simulationSettledAt - simulationStartedAt;
    }
    if (perfEnabled && simulationStartedAt > 0) {
      perfCounters.simulationSettles++;
      perfCounters.simulationTotalSettleMs += lastSimulationSettleMs;
      maybeUpdatePerfHud(simulationSettledAt);
    }
  };

  const handleTopologyWorkerMessage = (event: MessageEvent<WorkerBuildMessage>) => {
    const message = event.data;
    if (message.type === 'tick') {
      handleWorkerTick(message);
      return;
    }

    const pending = workerBuildRequests.get(message.requestId);
    if (!pending) return;
    workerBuildRequests.delete(message.requestId);

    if (message.type === 'error') {
      pending.reject(new Error(message.error));
      return;
    }

    pending.resolve({
      graphData: message.graphData,
      buildMetrics: message.buildMetrics,
    });
  };

  const handleTopologyWorkerError = (event: ErrorEvent) => {
    rejectPendingWorkerBuilds(event.error ?? new Error(event.message));
    topologyWorker?.terminate();
    topologyWorker = null;
    if (activeSimulationMode === 'worker') {
      activeSimulationMode = null;
      activeWorkerRequestId = 0;
      currentSimulationAlpha = 0;
      isSimulationActive = false;
    }
  };

  const ensureTopologyWorker = (): Worker | null => {
    if (topologyWorker || typeof Worker === 'undefined') return topologyWorker;
    try {
      topologyWorker = new Worker(new URL('./topology/topologyWorker.ts', import.meta.url), { type: 'module' });
      topologyWorker.addEventListener('message', handleTopologyWorkerMessage as EventListener);
      topologyWorker.addEventListener('error', handleTopologyWorkerError);
    } catch {
      topologyWorker = null;
    }
    return topologyWorker;
  };

  const buildGraphWithWorker = (requestId: number, width: number, height: number): Promise<BuildExecutionResult> => {
    sourceNodeCount = props.nodes.length;
    sourcePodCount = props.pods.length;
    sourceServiceCount = props.services.length;

    const worker = ensureTopologyWorker();
    if (!worker) {
      return Promise.resolve(buildGraphDirect());
    }

    return new Promise((resolve, reject) => {
      workerBuildRequests.set(requestId, { resolve, reject });
      const request: WorkerBuildRequest = {
        type: 'build',
        requestId,
        width,
        height,
        input: {
          nodes: props.nodes,
          pods: props.pods,
          services: props.services,
          prevNodes: graphNodes,
        },
      };
      worker.postMessage(request);
    });
  };

  const postWorkerDrag = (phase: WorkerDragRequest['phase'], node: D3Node, x?: number, y?: number) => {
    if (activeSimulationMode !== 'worker' || !topologyWorker || activeWorkerRequestId === 0) return;
    const request: WorkerDragRequest = {
      type: 'drag',
      requestId: activeWorkerRequestId,
      phase,
      nodeId: node.id,
      x,
      y,
    };
    topologyWorker.postMessage(request);
  };

  const postWorkerResize = (width: number, height: number) => {
    if (activeSimulationMode !== 'worker' || !topologyWorker || activeWorkerRequestId === 0) return;
    const request: WorkerResizeRequest = {
      type: 'resize',
      requestId: activeWorkerRequestId,
      width,
      height,
    };
    topologyWorker.postMessage(request);
  };

  const getNodeColor = (node: D3Node): string => {
    if (node.type === 'node') {
      return node.status === 'ok' ? '#00d9ff' : '#ef4444';
    }
    if (node.namespace) {
      return getNamespaceColor(node.namespace, namespaceMap);
    }
    const statusColors = { ok: '#22c55e', warn: '#f97316', error: '#ef4444' };
    return statusColors[node.status];
  };

  const getNodeRadius = (node: D3Node): number => {
    switch (node.type) {
      case 'node': return 28;
      case 'service': return 18;
      case 'pod': return 8;
      default: return 8;
    }
  };

  const getNodeIcon = (node: D3Node): string => {
    switch (node.type) {
      case 'node': return '⬡';
      case 'service': return '◆';
      case 'pod': return '●';
      default: return '●';
    }
  };

  const getNodeSprite = (type: D3Node['type'], radius: number, color: string, variant: 'full' | 'simple'): HTMLCanvasElement => {
    const key = `${type}:${radius}:${color}:${variant}`;
    const cachedSprite = nodeSpriteCache.get(key);
    if (cachedSprite) return cachedSprite;

    const size = Math.ceil((radius + NODE_SPRITE_PADDING) * 2);
    const sprite = document.createElement('canvas');
    sprite.width = size;
    sprite.height = size;
    const spriteCtx = sprite.getContext('2d');
    if (!spriteCtx) return sprite;

    const center = size / 2;
    const simpleVariant = variant === 'simple';

    spriteCtx.beginPath();
    spriteCtx.arc(center, center, radius, 0, Math.PI * 2);
    spriteCtx.fillStyle = '#0a1020';
    spriteCtx.fill();

    spriteCtx.fillStyle = color;
    spriteCtx.globalAlpha = type === 'node' ? 0.25 : 0.45;
    spriteCtx.fill();
    spriteCtx.globalAlpha = 1;

    spriteCtx.beginPath();
    spriteCtx.arc(center, center, radius, 0, Math.PI * 2);
    spriteCtx.strokeStyle = color;
    spriteCtx.lineWidth = type === 'node' ? 2 : 1.5;
    spriteCtx.stroke();

    if (!simpleVariant && type === 'node') {
      spriteCtx.beginPath();
      spriteCtx.arc(center, center, radius - 4, 0, Math.PI * 2);
      spriteCtx.strokeStyle = 'rgba(255,255,255,0.12)';
      spriteCtx.lineWidth = 1;
      spriteCtx.stroke();

      spriteCtx.beginPath();
      spriteCtx.arc(center, center, radius - 8, 0, Math.PI * 2);
      spriteCtx.strokeStyle = 'rgba(255,255,255,0.06)';
      spriteCtx.stroke();
    }

    if (type === 'pod') {
      if (!simpleVariant) {
        spriteCtx.beginPath();
        spriteCtx.arc(center, center, 3, 0, Math.PI * 2);
        spriteCtx.fillStyle = color;
        spriteCtx.globalAlpha = 0.4;
        spriteCtx.fill();
        spriteCtx.globalAlpha = 1;
      }

      spriteCtx.beginPath();
      spriteCtx.arc(center, center, 1.5, 0, Math.PI * 2);
      spriteCtx.fillStyle = color;
      spriteCtx.fill();
    }

    if (type === 'service' && !simpleVariant) {
      spriteCtx.beginPath();
      spriteCtx.arc(center, center, 4, 0, Math.PI * 2);
      spriteCtx.fillStyle = color;
      spriteCtx.globalAlpha = 0.3;
      spriteCtx.fill();
      spriteCtx.globalAlpha = 1;
    }

    nodeSpriteCache.set(key, sprite);
    return sprite;
  };

  // Throttled particle spawning using object pool - zero allocations
  const maybeSpawnParticle = (now: number, allowParticles: boolean) => {
    if (!allowParticles) return;
    // Only spawn every 8 frames and with 60% chance
    if (frameCount % 8 !== 0) return;

    // Stop spawning particles after simulation has been idle for a while
    // This allows the animation loop to eventually stop
    if (!isSimulationActive && simulationSettledAt > 0 &&
        now - simulationSettledAt > PARTICLE_IDLE_MS) {
      return;
    }

    if (graphLinks.length === 0 || activeParticleCount >= MAX_PARTICLES * 0.75 || Math.random() > 0.6) return;

    const linkIdx = Math.floor(Math.random() * graphLinks.length);
    const link = graphLinks[linkIdx];
    const source = link.source as D3Node;
    const target = link.target as D3Node;

    // Only spawn if nodes have positions
    if (source.x !== undefined && target.x !== undefined) {
      // Use O(1) index lookup instead of O(N) indexOf
      const sourceIdx = nodeIndexMap.get(source.id);
      const targetIdx = nodeIndexMap.get(target.id);
      if (sourceIdx === undefined || targetIdx === undefined) return;

      // Find an inactive slot in the pool
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (!particlePool[i].active) {
          const slot = particlePool[i];
          slot.active = true;
          slot.sourceIdx = sourceIdx;
          slot.targetIdx = targetIdx;
          slot.progress = 0;
          slot.speed = 0.012 + Math.random() * 0.018;
          slot.colorIdx = link.type === 'hosts' ? 0 : 1;
          activeParticleCount++;
          break;
        }
      }
    }
  };

  // Start animation loop if not already running
  const startAnimationLoop = () => {
    if (isAnimating) return;
    if (perfEnabled) perfCounters.drawStarts++;
    isAnimating = true;
    rafId = requestAnimationFrame(draw);
  };

  const ensureNodeStylesCache = () => {
    if (nodeStylesCacheValid) return;
    // Incremental update: only recompute entries for nodes whose style changed
    const staleIds = new Set(nodeStylesCache.keys());
    for (const node of graphNodes) {
      staleIds.delete(node.id);
      const r = getNodeRadius(node);
      const color = getNodeColor(node);
      const existing = nodeStylesCache.get(node.id);
      if (existing && existing.r === r && existing.color === color) continue;
      const truncLabel = node.label.length > 14 ? `${node.label.slice(0, 12)}...` : node.label;
      nodeStylesCache.set(node.id, { r, color, truncLabel });
    }
    // Remove entries for nodes no longer in the graph
    for (const id of staleIds) nodeStylesCache.delete(id);
    nodeStylesCacheValid = true;
  };

  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

  const smoothstep = (edge0: number, edge1: number, value: number): number => {
    if (edge0 === edge1) return value < edge0 ? 0 : 1;
    const t = clamp01((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  };

  const getDensityOverviewBlend = (zoomLevel: number): number => {
    const largeGraph =
      graphNodes.length >= DENSITY_OVERVIEW_NODE_THRESHOLD ||
      sourcePodCount >= DENSITY_OVERVIEW_POD_THRESHOLD;
    if (!largeGraph) return 0;
    const transitionStart = DENSITY_OVERVIEW_ZOOM_THRESHOLD - DENSITY_OVERVIEW_TRANSITION_BAND;
    const transitionEnd = DENSITY_OVERVIEW_ZOOM_THRESHOLD + DENSITY_OVERVIEW_TRANSITION_BAND;
    return 1 - smoothstep(transitionStart, transitionEnd, zoomLevel);
  };

  const shouldRenderNodeForCurrentDensity = (node: D3Node, densityOverviewBlend: number): boolean =>
    densityOverviewBlend < DENSITY_OVERVIEW_NEAR_FULL_BLEND || node.type === 'node';

  const getSimulationVisualRefreshMs = (
    isDense: boolean,
    densityOverviewBlend: number,
    isUserInteracting: boolean,
    nearSettled: boolean,
  ): number => {
    if (isUserInteracting) return isDense ? SIMULATION_REFRESH_MS_DENSE : SIMULATION_REFRESH_MS_RAW;
    if (densityOverviewBlend > 0.6) return nearSettled ? SIMULATION_REFRESH_MS_SETTLED : SIMULATION_REFRESH_MS_OVERVIEW;
    if (isDense) return nearSettled ? SIMULATION_REFRESH_MS_SETTLED : SIMULATION_REFRESH_MS_DENSE;
    return nearSettled ? SIMULATION_REFRESH_MS_SETTLED : SIMULATION_REFRESH_MS_RAW;
  };

  const getSimulationVisibilityRefreshMs = (
    isDense: boolean,
    densityOverviewBlend: number,
    isUserInteracting: boolean,
  ): number => {
    if (isUserInteracting && densityOverviewBlend < 0.3) return SIMULATION_VISIBILITY_REFRESH_MS_RAW;
    if (densityOverviewBlend > 0.6) return SIMULATION_VISIBILITY_REFRESH_MS_OVERVIEW;
    if (isDense) return SIMULATION_VISIBILITY_REFRESH_MS_DENSE;
    return SIMULATION_VISIBILITY_REFRESH_MS_RAW;
  };

  const updateFramePressure = (frameMs: number, isDense: boolean) => {
    const hotFrameMs = isDense ? 24 : 18;
    const warmFrameMs = isDense ? 18 : 13;
    if (frameMs >= hotFrameMs) {
      framePressureScore = Math.min(FRAME_PRESSURE_SCORE_MAX, framePressureScore + 2);
    } else if (frameMs >= warmFrameMs) {
      framePressureScore = Math.min(FRAME_PRESSURE_SCORE_MAX, framePressureScore + 1);
    } else {
      framePressureScore = Math.max(0, framePressureScore - 2);
    }
    underFramePressure = framePressureScore >= 4;
    perfCounters.framePressureScore = framePressureScore;
  };

  const syncDensityOverviewState = (blend: number) => {
    const active = blend > 0.18;
    const hiddenPods = active ? Math.round(sourcePodCount * blend) : 0;
    const hiddenServices = active ? Math.round(sourceServiceCount * blend) : 0;
    if (densityOverviewActive() !== active) setDensityOverviewActive(active);
    if (densityOverviewHiddenPods() !== hiddenPods) setDensityOverviewHiddenPods(hiddenPods);
    if (densityOverviewHiddenServices() !== hiddenServices) setDensityOverviewHiddenServices(hiddenServices);
  };

  const updateNamespaceAggregates = () => {
    lastNamespaceAggregateCount = 0;
    namespaceAggregateIndex.clear();

    const minX = cachedFrustum.minX;
    const maxX = cachedFrustum.maxX;
    const minY = cachedFrustum.minY;
    const maxY = cachedFrustum.maxY;

    for (let i = 0, len = graphNodes.length; i < len; i++) {
      const node = graphNodes[i];
      const nodeX = node.x;
      const nodeY = node.y;
      if (node.type === 'node' || !node.namespace || nodeX === undefined || nodeY === undefined) continue;
      if (nodeX < minX || nodeX > maxX || nodeY < minY || nodeY > maxY) continue;

      let aggregate = namespaceAggregateIndex.get(node.namespace);
      if (!aggregate) {
        aggregate = namespaceAggregatePool[lastNamespaceAggregateCount];
        if (!aggregate) {
          aggregate = {
            namespace: node.namespace,
            color: getNamespaceColor(node.namespace, namespaceMap),
            x: 0,
            y: 0,
            memberCount: 0,
            podCount: 0,
            serviceCount: 0,
          };
          namespaceAggregatePool.push(aggregate);
        }
        aggregate.namespace = node.namespace;
        aggregate.color = getNamespaceColor(node.namespace, namespaceMap);
        aggregate.x = 0;
        aggregate.y = 0;
        aggregate.memberCount = 0;
        aggregate.podCount = 0;
        aggregate.serviceCount = 0;
        namespaceAggregateIndex.set(node.namespace, aggregate);
        lastNamespaceAggregateCount++;
      }

      aggregate.x += nodeX;
      aggregate.y += nodeY;
      aggregate.memberCount++;
      if (node.type === 'pod') {
        aggregate.podCount++;
      } else {
        aggregate.serviceCount++;
      }
    }

    for (let i = 0; i < lastNamespaceAggregateCount; i++) {
      const aggregate = namespaceAggregatePool[i];
      if (aggregate.memberCount === 0) continue;
      aggregate.x /= aggregate.memberCount;
      aggregate.y /= aggregate.memberCount;
    }
    pendingNamespaceAggregateRefresh = false;
  };

  const updateVisibleNodes = (width: number, height: number, densityOverviewBlend: number, force = false) => {
    if (!force && !viewportCacheDirty) return;
    const startedAt = performance.now();

    if (transform.x !== lastFrustumTransform.x ||
        transform.y !== lastFrustumTransform.y ||
        transform.k !== lastFrustumTransform.k ||
        width !== lastFrustumDims.width ||
        height !== lastFrustumDims.height ||
        force) {
      const margin = 50 / transform.k;
      cachedFrustum.minX = -transform.x / transform.k - margin;
      cachedFrustum.maxX = (width - transform.x) / transform.k + margin;
      cachedFrustum.minY = -transform.y / transform.k - margin;
      cachedFrustum.maxY = (height - transform.y) / transform.k + margin;
      lastFrustumTransform.x = transform.x;
      lastFrustumTransform.y = transform.y;
      lastFrustumTransform.k = transform.k;
      lastFrustumDims.width = width;
      lastFrustumDims.height = height;
    }

    const minX = cachedFrustum.minX;
    const maxX = cachedFrustum.maxX;
    const minY = cachedFrustum.minY;
    const maxY = cachedFrustum.maxY;
    let visibleNodeCount = 0;

    for (let i = 0, len = graphNodes.length; i < len; i++) {
      const node = graphNodes[i];
      const isVisible = node.x !== undefined &&
        node.y !== undefined &&
        shouldRenderNodeForCurrentDensity(node, densityOverviewBlend) &&
        node.x >= minX &&
        node.x <= maxX &&
        node.y >= minY &&
        node.y <= maxY;
      visibleNodeFlags[i] = isVisible ? 1 : 0;
      if (isVisible) visibleNodeIndices[visibleNodeCount++] = i;
    }
    lastVisibleNodeCount = visibleNodeCount;

    // Pre-filter visible links: a link is visible if at least one endpoint is visible
    let visibleHostsCount = 0;
    for (let i = 0, len = hostsLinks.length; i < len; i++) {
      const link = hostsLinks[i];
      if (link.sourceIdx !== undefined && link.targetIdx !== undefined) {
        if (visibleNodeFlags[link.sourceIdx] === 0 && visibleNodeFlags[link.targetIdx] === 0) continue;
      }
      visibleHostsLinkIndices[visibleHostsCount++] = i;
    }
    lastVisibleHostsLinkCount = visibleHostsCount;

    let visibleSelectsCount = 0;
    for (let i = 0, len = selectsLinks.length; i < len; i++) {
      const link = selectsLinks[i];
      if (link.sourceIdx !== undefined && link.targetIdx !== undefined) {
        if (visibleNodeFlags[link.sourceIdx] === 0 && visibleNodeFlags[link.targetIdx] === 0) continue;
      }
      visibleSelectsLinkIndices[visibleSelectsCount++] = i;
    }
    lastVisibleSelectsLinkCount = visibleSelectsCount;

    viewportCacheDirty = false;
    pendingVisibilityRefresh = false;
    lastVisibilityRefreshAt = performance.now();
    perfCounters.visibilityRefreshes++;
    perfCounters.visibilityRefreshTotalMs += lastVisibilityRefreshAt - startedAt;
  };

  const drawBackground = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    isDense: boolean,
    isSimulationActiveNow: boolean,
    underPressure: boolean,
  ) => {
    ctx.clearRect(0, 0, width, height);

    if (!cachedGradient || cachedGradientDims.width !== width || cachedGradientDims.height !== height) {
      const cx = width / 2;
      const cy = height / 2;
      const maxRadius = Math.sqrt(cx * cx + cy * cy);
      cachedGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
      cachedGradient.addColorStop(0, '#0a1525');
      cachedGradient.addColorStop(0.5, '#080f1c');
      cachedGradient.addColorStop(0.8, '#060c18');
      cachedGradient.addColorStop(1, '#030810');
      cachedGradientDims = { width, height };
    }

    ctx.fillStyle = cachedGradient;
    ctx.fillRect(0, 0, width, height);

    if (!underPressure && !isDense && isSimulationActiveNow && frameCount % 2 === 0) {
      const scanY = (frameCount * 2) % height;
      ctx.fillStyle = 'rgba(0, 217, 255, 0.015)';
      ctx.fillRect(0, scanY, width, 2);
    }
  };

  const drawBaseLayer = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    zoomLevel: number,
    isDense: boolean,
    densityOverviewBlend: number,
    reduceDetail: boolean,
    reduceLinks: boolean,
    reduceNodeDetail: boolean,
    skipDecorativeNodeEffects: boolean,
    simplifiedNodeRendering: boolean,
    refreshVisibility: boolean,
    refreshNamespaceAggregates: boolean,
    underPressure: boolean,
  ) => {
    perfCounters.baseLayerDraws++;
    clearBaseCanvasPreview();
    drawBackground(ctx, width, height, isDense, isSimulationActive, underPressure);
    ensureNodeStylesCache();
    updateVisibleNodes(width, height, densityOverviewBlend, refreshVisibility);
    if (densityOverviewBlend > 0.001 && refreshNamespaceAggregates) {
      updateNamespaceAggregates();
    } else {
      if (densityOverviewBlend <= 0.001) {
        lastNamespaceAggregateCount = 0;
        pendingNamespaceAggregateRefresh = false;
      }
    }

    const rawOpacity = clamp01(1 - densityOverviewBlend);
    const overviewOpacity = clamp01(densityOverviewBlend);
    const shouldCullLinks = densityOverviewBlend > 0.7 || isDense || zoomLevel > 0.8;
    const labelZoomThreshold = isDense ? 1 : reduceDetail ? 0.7 : 0.4;
    const drawStructuralLabels = !underPressure && (overviewOpacity > 0.5 ? zoomLevel > 0.85 : (!isDense || zoomLevel > 1));
    const hasLargeVisibleSet = lastVisibleNodeCount > 240 || isDense;
    const renderRawLinks = rawOpacity > (underPressure || hasLargeVisibleSet ? 0.12 : 0.04);
    const renderRawNodes = rawOpacity > (underPressure || hasLargeVisibleSet ? 0.18 : 0.06);

    const rawLinkCount = shouldCullLinks
      ? lastVisibleHostsLinkCount + lastVisibleSelectsLinkCount
      : hostsLinks.length + selectsLinks.length;
    const overviewNodeCount = sourceNodeCount + lastNamespaceAggregateCount;
    renderedTopologyNodeCount = Math.round(lastVisibleNodeCount * rawOpacity + overviewNodeCount * overviewOpacity);
    renderedTopologyLinkCount = Math.round(rawLinkCount * rawOpacity);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#cccccc';
    let lastFont = '';

    if (rawOpacity > 0.001 && (renderRawLinks || renderRawNodes)) {
      ctx.save();
      ctx.globalAlpha = rawOpacity;

      if (renderRawLinks) {
        // Use pre-filtered visible link lists (computed in updateVisibleNodes)
        const hostsCount = shouldCullLinks ? lastVisibleHostsLinkCount : hostsLinks.length;
        if (hostsCount > 0) {
          ctx.beginPath();
          for (let i = 0; i < hostsCount; i++) {
            const link = shouldCullLinks ? hostsLinks[visibleHostsLinkIndices[i]] : hostsLinks[i];
            const source = link.source as D3Node;
            const target = link.target as D3Node;
            if (source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) continue;
            ctx.moveTo(source.x, source.y);
            ctx.lineTo(target.x, target.y);
          }
          if (!reduceLinks && !isDense) {
            ctx.strokeStyle = 'rgba(0, 217, 255, 0.06)';
            ctx.lineWidth = 5;
            ctx.setLineDash([]);
            ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(0, 217, 255, 0.28)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          ctx.stroke();
        }

        const selectsCount = shouldCullLinks ? lastVisibleSelectsLinkCount : selectsLinks.length;
        if (selectsCount > 0) {
          ctx.beginPath();
          for (let i = 0; i < selectsCount; i++) {
            const link = shouldCullLinks ? selectsLinks[visibleSelectsLinkIndices[i]] : selectsLinks[i];
            const source = link.source as D3Node;
            const target = link.target as D3Node;
            if (source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) continue;
            ctx.moveTo(source.x, source.y);
            ctx.lineTo(target.x, target.y);
          }
          if (!reduceLinks && !isDense) {
            ctx.strokeStyle = 'rgba(168, 85, 247, 0.06)';
            ctx.lineWidth = 4;
            ctx.setLineDash([]);
            ctx.stroke();
          }
          ctx.strokeStyle = 'rgba(168, 85, 247, 0.25)';
          ctx.lineWidth = 1;
          ctx.setLineDash(reduceLinks ? [] : [4, 4]);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      if (renderRawNodes) {
        for (let i = 0; i < lastVisibleNodeCount; i++) {
          const node = graphNodes[visibleNodeIndices[i]];
          const nodeX = node.x;
          const nodeY = node.y;
          if (nodeX === undefined || nodeY === undefined) continue;

          const cached = nodeStylesCache.get(node.id)!;
          const sprite = getNodeSprite(
            node.type,
            cached.r,
            cached.color,
            simplifiedNodeRendering ? 'simple' : 'full',
          );
          ctx.drawImage(sprite, nodeX - sprite.width / 2, nodeY - sprite.height / 2);
        }

        for (let i = 0; i < lastVisibleNodeCount; i++) {
          const node = graphNodes[visibleNodeIndices[i]];
          if (node.x === undefined || node.y === undefined) continue;
          if (!drawStructuralLabels || (node.type !== 'node' && node.type !== 'service')) continue;
          if (zoomLevel <= labelZoomThreshold) continue;

          const cached = nodeStylesCache.get(node.id)!;
          const font = node.type === 'node' ? FONT_NODE : FONT_OTHER;
          if (font !== lastFont) {
            ctx.font = font;
            lastFont = font;
          }
          ctx.fillText(cached.truncLabel, node.x, node.y + cached.r + 12);
        }
      }

      ctx.restore();
    }

    if (overviewOpacity > 0.001) {
      for (let i = 0; i < lastNamespaceAggregateCount; i++) {
        const aggregate = namespaceAggregatePool[i];
        const radius = Math.max(16, Math.min(34, 12 + Math.sqrt(aggregate.memberCount) * 2.2));
        const namespaceLabel = aggregate.namespace.length > 14
          ? `${aggregate.namespace.slice(0, 12)}...`
          : aggregate.namespace;
        const revealScale = 0.88 + overviewOpacity * 0.12;
        const displayRadius = radius * revealScale;

        ctx.beginPath();
        ctx.arc(aggregate.x, aggregate.y, displayRadius + 8, 0, 2 * Math.PI);
        ctx.fillStyle = aggregate.color;
        ctx.globalAlpha = 0.08 * overviewOpacity;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(aggregate.x, aggregate.y, displayRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#07101d';
        ctx.globalAlpha = 0.92 * overviewOpacity;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(aggregate.x, aggregate.y, displayRadius, 0, 2 * Math.PI);
        ctx.strokeStyle = aggregate.color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.75 * overviewOpacity;
        ctx.stroke();
        ctx.globalAlpha = overviewOpacity;

        const countFont = displayRadius >= 24 ? '600 12px Inter, system-ui' : '600 11px Inter, system-ui';
        if (countFont !== lastFont) {
          ctx.font = countFont;
          lastFont = countFont;
        }
        ctx.fillStyle = '#f5f7ff';
        ctx.fillText(String(aggregate.memberCount), aggregate.x, aggregate.y - 2);

        const detailFont = '400 9px Inter, system-ui';
        if (detailFont !== lastFont) {
          ctx.font = detailFont;
          lastFont = detailFont;
        }
        ctx.fillStyle = 'rgba(245,247,255,0.72)';
        ctx.fillText(`${aggregate.serviceCount}s · ${aggregate.podCount}p`, aggregate.x, aggregate.y + 10);

        if (zoomLevel > labelZoomThreshold) {
          ctx.fillStyle = '#d7def0';
          ctx.fillText(namespaceLabel, aggregate.x, aggregate.y + displayRadius + 11);
        }
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    syncBaseRasterTransform();
    baseLayerDirty = false;
  };

  const drawOverlayLayer = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    now: number,
    zoomLevel: number,
    isDense: boolean,
    densityOverviewBlend: number,
    reduceDetail: boolean,
    reduceLinks: boolean,
    reduceNodeDetail: boolean,
    skipDecorativeNodeEffects: boolean,
    allowParticles: boolean,
  ) => {
    perfCounters.overlayLayerDraws++;
    ctx.clearRect(0, 0, width, height);
    ensureNodeStylesCache();
    updateVisibleNodes(width, height, densityOverviewBlend);
    const rawOpacity = clamp01(1 - densityOverviewBlend);

    maybeSpawnParticle(now, allowParticles);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    let particleCount = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const slot = particlePool[i];
      if (!slot.active) continue;

      slot.progress += slot.speed;
      if (slot.progress >= 1) {
        slot.active = false;
        activeParticleCount--;
        continue;
      }

      const source = graphNodes[slot.sourceIdx];
      const target = graphNodes[slot.targetIdx];
      if (!source || !target) {
        slot.active = false;
        activeParticleCount--;
        continue;
      }

      const pos = particlePositionsPool[particleCount++];
      pos.x = (source.x ?? 0) + ((target.x ?? 0) - (source.x ?? 0)) * slot.progress;
      pos.y = (source.y ?? 0) + ((target.y ?? 0) - (source.y ?? 0)) * slot.progress;
      pos.colorIdx = slot.colorIdx;
    }

    if (particleCount > 0 && rawOpacity > 0.001) {
      ctx.save();
      ctx.globalAlpha = rawOpacity;
      const TAU = 2 * Math.PI;

      // Glow layer - cyan
      ctx.fillStyle = 'rgba(0,217,255,0.25)';
      ctx.beginPath();
      for (let i = 0; i < particleCount; i++) {
        const p = particlePositionsPool[i];
        if (p.colorIdx === 0) { ctx.moveTo(p.x + 4, p.y); ctx.arc(p.x, p.y, 4, 0, TAU); }
      }
      ctx.fill();

      // Glow layer - purple
      ctx.fillStyle = 'rgba(168,85,247,0.25)';
      ctx.beginPath();
      for (let i = 0; i < particleCount; i++) {
        const p = particlePositionsPool[i];
        if (p.colorIdx !== 0) { ctx.moveTo(p.x + 4, p.y); ctx.arc(p.x, p.y, 4, 0, TAU); }
      }
      ctx.fill();

      // Core layer - cyan
      ctx.fillStyle = '#00d9ff';
      ctx.beginPath();
      for (let i = 0; i < particleCount; i++) {
        const p = particlePositionsPool[i];
        if (p.colorIdx === 0) { ctx.moveTo(p.x + 1.5, p.y); ctx.arc(p.x, p.y, 1.5, 0, TAU); }
      }
      ctx.fill();

      // Core layer - purple
      ctx.fillStyle = '#a855f7';
      ctx.beginPath();
      for (let i = 0; i < particleCount; i++) {
        const p = particlePositionsPool[i];
        if (p.colorIdx !== 0) { ctx.moveTo(p.x + 1.5, p.y); ctx.arc(p.x, p.y, 1.5, 0, TAU); }
      }
      ctx.fill();

      ctx.restore();
    }

    const selectedId = selectedNode()?.id;
    const hoveredId = hoverNode()?.id;
    const labelZoomThreshold = isDense ? 1 : reduceDetail ? 0.7 : 0.4;
    const time = frameCount * 0.05;
    let lastFont = '';

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f5f7ff';
    ctx.globalAlpha = rawOpacity;

    for (let i = 0; i < lastVisibleNodeCount; i++) {
      const node = graphNodes[visibleNodeIndices[i]];
      const nodeX = node.x;
      const nodeY = node.y;
      if (nodeX === undefined || nodeY === undefined) continue;
      if (node.id !== selectedId && node.id !== hoveredId) continue;

      const cached = nodeStylesCache.get(node.id)!;
      const radius = cached.r;
      const color = cached.color;
      const isSelected = node.id === selectedId;
      const pulseScale = isSelected ? 1 + Math.sin(time * 2) * 0.15 : 1;
      const glowRadius = (isSelected ? 12 : 6) * pulseScale;

      ctx.beginPath();
      ctx.arc(nodeX, nodeY, radius + glowRadius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.08;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(nodeX, nodeY, radius + glowRadius * 0.6, 0, 2 * Math.PI);
      ctx.globalAlpha = 0.12;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(nodeX, nodeY, radius + glowRadius * 0.3, 0, 2 * Math.PI);
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      ctx.beginPath();
      ctx.arc(nodeX, nodeY, radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#0a1020';
      ctx.fill();

      ctx.fillStyle = color;
      ctx.globalAlpha = node.type === 'node' ? 0.25 : 0.45;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      ctx.beginPath();
      ctx.arc(nodeX, nodeY, radius, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : (node.type === 'node' ? 2 : 1.5);
      ctx.stroke();

      if (node.type === 'node' && !reduceNodeDetail && !skipDecorativeNodeEffects) {
        ctx.beginPath();
        ctx.arc(nodeX, nodeY, radius - 4, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(nodeX, nodeY, radius - 8, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.stroke();
      }

      if (node.type === 'pod') {
        if (!reduceNodeDetail && !skipDecorativeNodeEffects) {
          ctx.beginPath();
          ctx.arc(nodeX, nodeY, 3, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.4;
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }

        ctx.beginPath();
        ctx.arc(nodeX, nodeY, 1.5, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      }

      if (node.type === 'service' && !reduceNodeDetail && !skipDecorativeNodeEffects) {
        ctx.beginPath();
        ctx.arc(nodeX, nodeY, 4, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      if (zoomLevel > labelZoomThreshold) {
        const font = node.type === 'node' ? FONT_NODE : FONT_OTHER;
        if (font !== lastFont) {
          ctx.font = font;
          lastFont = font;
        }
        ctx.fillText(node.label, nodeX, nodeY + radius + 12);
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
    overlayLayerDirty = false;
  };

  const draw = () => {
    if (!baseCanvasCtx || !overlayCanvasCtx) return;
    const baseCtx = baseCanvasCtx;
    const overlayCtx = overlayCanvasCtx;

    const frameStart = performance.now();
    const now = frameStart;
    const isUserInteracting = now - lastInteractionAt < INTERACTION_IDLE_MS;
    const isDense = graphNodes.length > LARGE_GRAPH_NODE_THRESHOLD ||
      graphLinks.length > LARGE_GRAPH_LINK_THRESHOLD;
    const simulationAlpha = isSimulationActive
      ? (activeSimulationMode === 'worker' ? currentSimulationAlpha : (simulation?.alpha() ?? 0))
      : 0;
    const nearSettled = isSimulationActive && simulationAlpha > 0 && simulationAlpha < 0.035 && !isUserInteracting;
    let minFrameMs = 0;
    if (isDense) {
      if (isSimulationActive) {
        minFrameMs = nearSettled ? 1000 / 24 : 1000 / 30;
      } else if (isUserInteracting) {
        minFrameMs = 1000 / 30;
      }
    } else if (nearSettled) {
      minFrameMs = 1000 / 45;
    }
    if (isAnimating && minFrameMs > 0 && now - lastFrameTime < minFrameMs) {
      if (perfEnabled) {
        perfCounters.denseFrameSkips++;
        maybeUpdatePerfHud(now);
      }
      rafId = requestAnimationFrame(draw);
      return;
    }
    lastFrameTime = now;
    frameCount++;

    const { width, height } = dimensions();
    const zoomLevel = transform.k;
    const densityOverviewBlend = getDensityOverviewBlend(zoomLevel);
    const forceBudgetMode = underFramePressure && !isUserInteracting;
    const reduceDetail = (isDense && zoomLevel < 0.85) || (forceBudgetMode && zoomLevel < 1.2);
    const reduceLinks = reduceDetail || zoomLevel < 0.5 || forceBudgetMode;
    const reduceNodeDetail = reduceDetail || zoomLevel < 0.6 || forceBudgetMode;
    const skipDecorativeNodeEffects = (isDense && !isUserInteracting) || forceBudgetMode;
    const simplifiedNodeRendering = reduceNodeDetail || skipDecorativeNodeEffects || isSimulationActive;
    const allowParticles = isSimulationActive && !reduceLinks && !isDense && densityOverviewBlend < 0.15 && !forceBudgetMode;
    syncDensityOverviewState(densityOverviewBlend);

    if (isSimulationActive) {
      spatialGridDirty = true;
      if (activeSimulationMode === 'main') {
        pendingSimulationVisualUpdate = true;
      }
      if (hasActiveOverlayState()) {
        overlayLayerDirty = true;
      }
    }

    if (isSimulationActive && pendingSimulationVisualUpdate) {
      const visualRefreshMs = getSimulationVisualRefreshMs(
        isDense,
        densityOverviewBlend,
        isUserInteracting,
        nearSettled,
      );
      const visibilityRefreshMs = getSimulationVisibilityRefreshMs(
        isDense,
        densityOverviewBlend,
        isUserInteracting,
      );
      if (now - lastSimulationVisualRefreshAt >= visualRefreshMs) {
        const visibilityRefreshDue =
          pendingVisibilityRefresh ||
          now - lastVisibilityRefreshAt >= visibilityRefreshMs;
        baseLayerDirty = true;
        if (visibilityRefreshDue) {
          viewportCacheDirty = true;
          pendingVisibilityRefresh = true;
          pendingNamespaceAggregateRefresh = true;
        }
        pendingSimulationVisualUpdate = false;
        lastSimulationVisualRefreshAt = now;
        perfCounters.simulationVisualRefreshes++;
      } else {
        perfCounters.simulationVisualDeferrals++;
      }
    }

    const shouldDrawBase = baseLayerDirty || viewportCacheDirty;
    const shouldDrawOverlay = overlayLayerDirty || hasActiveOverlayState() || allowParticles;

    if (shouldDrawBase) {
      drawBaseLayer(
        baseCtx,
        width,
        height,
        zoomLevel,
        isDense,
        densityOverviewBlend,
        reduceDetail,
        reduceLinks,
        reduceNodeDetail,
        skipDecorativeNodeEffects,
        simplifiedNodeRendering,
        viewportCacheDirty || pendingVisibilityRefresh,
        pendingNamespaceAggregateRefresh || viewportCacheDirty,
        forceBudgetMode,
      );
    }

    if (shouldDrawOverlay) {
      drawOverlayLayer(
        overlayCtx,
        width,
        height,
        now,
        zoomLevel,
        isDense,
        densityOverviewBlend,
        reduceDetail,
        reduceLinks,
        reduceNodeDetail,
        skipDecorativeNodeEffects,
        allowParticles,
      );
    }

    const frameDuration = performance.now() - frameStart;
    recordFrameSample(frameDuration);
    updateFramePressure(frameDuration, isDense);
    maybeUpdatePerfHud(now);

    const shouldContinue = isSimulationActive ||
      activeParticleCount > 0 ||
      baseLayerDirty ||
      overlayLayerDirty ||
      viewportCacheDirty;
    if (shouldContinue) {
      rafId = requestAnimationFrame(draw);
      return;
    }

    if (perfEnabled) perfCounters.drawStops++;
    isAnimating = false;
    rafId = null;
  };

  // Click & Hover detection - uses spatial grid for O(1) average lookup
  const getEventCanvas = (): HTMLCanvasElement | undefined => overlayCanvasRef ?? baseCanvasRef;

  const getCanvasPoint = (event: MouseEvent | PointerEvent): { x: number; y: number } | null => {
      const canvas = getEventCanvas();
      if (!canvas) return null;
      if (Number.isFinite(event.offsetX) && Number.isFinite(event.offsetY)) {
        return { x: event.offsetX, y: event.offsetY };
      }
      const rect = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
  };

  const getKeyUnderMouse = (event: MouseEvent | PointerEvent): D3Node | null => {
      if (!getEventCanvas()) return null;
      const point = getCanvasPoint(event);
      if (!point) return null;
      const now = performance.now();
      const x = (point.x - transform.x) / transform.k;
      const y = (point.y - transform.y) / transform.k;

      // Allow a slightly stale grid during active simulation to avoid full O(N)
      // rebuilds on every hover event while nodes are moving.
      if (!spatialGridValid || (spatialGridDirty && now - lastSpatialGridBuildAt >= SPATIAL_GRID_ACTIVE_REBUILD_MS)) {
          rebuildSpatialGrid(now);
      }

      return findNearestNodeInGrid(x, y);
  };

  const handleCanvasClick = (event: MouseEvent) => {
      bumpInteraction();
      const node = getKeyUnderMouse(event);
      if (node) {
          setSelectedNode(node);
          props.onNodeClick?.(node);
      } else {
          setSelectedNode(null);
      }
      invalidateOverlayLayer();
      // Trigger redraw for selection visual feedback
      if (!isAnimating) {
        startAnimationLoop();
      }
  };

  // Throttle mouse move to max 60fps (every ~16ms)
  let lastMouseMoveTime = 0;
  const handleMouseMove = (event: MouseEvent) => {
      const now = performance.now();
      const isLarge = graphNodes.length > LARGE_GRAPH_NODE_THRESHOLD;
      const moveThrottleMs = isLarge ? (isSimulationActive ? 48 : 24) : (isSimulationActive ? 32 : 16);
      if (now - lastMouseMoveTime < moveThrottleMs) return; // Skip if called too soon
      lastMouseMoveTime = now;

      const node = getKeyUnderMouse(event);
      const currentHover = hoverNode();
      if (node !== currentHover) {
          bumpInteraction();
          setHoverNode(node);
          if (overlayCanvasRef) overlayCanvasRef.style.cursor = node ? 'pointer' : 'default';
          invalidateOverlayLayer();
          // Trigger redraw for hover visual feedback (single frame, not continuous)
          if (!isAnimating) {
            startAnimationLoop();
          }
      }
  };

  const initializeSimulation = async () => {
    if (!overlayCanvasRef) return;
    markTopologySyncing();

    // Stop any existing simulation before rebuilding
    if (simulation) {
      simulation.stop();
      simulation = null;
    }
    activeSimulationMode = null;
    activeWorkerRequestId = 0;
    currentSimulationAlpha = 0;

    resetParticles();
    clearPanPreviewCommit();
    clearBaseCanvasPreview();
    const { width, height } = dimensions();
    const requestId = ++topologyWorkerRequestId;
    pendingBuildRequestId = requestId;

    let buildResult: BuildExecutionResult;
    let workerBuildSucceeded = false;
    try {
      buildResult = await buildGraphWithWorker(requestId, width, height);
      workerBuildSucceeded = ensureTopologyWorker() !== null;
    } catch {
      if (requestId !== pendingBuildRequestId) return;
      buildResult = buildGraphDirect();
    }
    if (requestId !== pendingBuildRequestId) return;
    applyGraphData(buildResult.graphData);
    lastTopologyBuildMs = buildResult.buildMetrics.buildMs;
    lastBuildMode = buildResult.buildMetrics.mode;
    lastFiAccelBuildDelta = buildResult.buildMetrics.fiAccel;

    // Early exit if no data - just render empty background
    if (graphNodes.length === 0) {
      isSimulationActive = false;
      activeSimulationMode = null;
      activeWorkerRequestId = 0;
      invalidateViewport();
      draw();
      maybeUpdatePerfHud(performance.now());
      markTopologySynced();
      return;
    }

    if (workerBuildSucceeded) {
      activeSimulationMode = 'worker';
      activeWorkerRequestId = requestId;
      simulationStartedAt = performance.now();
      if (perfEnabled) {
        perfCounters.simulationInits++;
        maybeUpdatePerfHud(simulationStartedAt);
      }
      isSimulationActive = true;
      simulationSettledAt = 0;
      currentSimulationAlpha = 0.2;
      invalidateViewport();
      startAnimationLoop();
      maybeUpdatePerfHud(simulationStartedAt);
      markTopologySynced();
      return;
    }

    const created = createTopologySimulation({
      nodes: graphNodes,
      links: graphLinks,
      width,
      height,
      getNodeRadius,
      onEnd: () => {
        isSimulationActive = false;
        simulationSettledAt = performance.now();
        invalidateViewport();
        startAnimationLoop();
        if (simulationStartedAt > 0) {
          lastSimulationSettleMs = simulationSettledAt - simulationStartedAt;
        }
        if (perfEnabled && simulationStartedAt > 0) {
          perfCounters.simulationSettles++;
          perfCounters.simulationTotalSettleMs += lastSimulationSettleMs;
          maybeUpdatePerfHud(simulationSettledAt);
        }
      }
    });
    activeSimulationMode = 'main';
    simulation = created.simulation;
    simulationStartedAt = performance.now();
    if (perfEnabled) {
      perfCounters.simulationInits++;
      maybeUpdatePerfHud(simulationStartedAt);
    }

    // NOW start animation loop after warmup
    isSimulationActive = true;
    simulationSettledAt = 0; // Reset idle timeout when simulation starts
    invalidateViewport();
    startAnimationLoop();
    maybeUpdatePerfHud(simulationStartedAt);
    markTopologySynced();

    // Zoom behavior
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (e) => {
        transform = e.transform;
        bumpInteraction();
        if (isSimulationActive) {
          invalidateViewport();
        } else {
          applyBaseCanvasPreview(e.transform);
          invalidateOverlayLayer();
          scheduleBaseLayerCommit();
        }
        // Restart animation if not running (for pan/zoom after settling)
        startAnimationLoop();
      });
        
    d3.select(overlayCanvasRef)
        .call(zoom)
        .on("dblclick.zoom", null);

    // Initial positioning if not defined
    if (graphNodes.length > 0 && !graphNodes[0].x) {
        // Apply initial Zoom Fit
        const baseZoom = Math.max(0.3, Math.min(0.8, 50 / (graphNodes.length || 1)));
        d3.select(overlayCanvasRef).call(zoom.transform,
            d3.zoomIdentity.translate(width/2, height/2).scale(baseZoom).translate(-width/2, -height/2));
    }
    
    // Drag behavior
    const drag = d3.drag<HTMLCanvasElement, unknown>()
      .subject((e) => {
        const node = getKeyUnderMouse(e.sourceEvent);
        return node ? node : null;
      })
      .on('start', (e) => {
        if (activeSimulationMode === 'worker') {
          isSimulationActive = true;
          currentSimulationAlpha = Math.max(currentSimulationAlpha, 0.3);
          invalidateViewport();
          startAnimationLoop();
        } else if (!e.active) {
          simulation?.alphaTarget(0.3).restart();
          isSimulationActive = true;
          invalidateViewport();
          startAnimationLoop();
        }
        bumpInteraction();
        const n = e.subject as D3Node;
        n.x = e.x;
        n.y = e.y;
        n.fx = e.x;
        n.fy = e.y;
        postWorkerDrag('start', n, e.x, e.y);
      })
      .on('drag', (e) => {
        bumpInteraction();
        const n = e.subject as D3Node;
        n.x = e.x;
        n.y = e.y;
        n.fx = e.x;
        n.fy = e.y;
        postWorkerDrag('move', n, e.x, e.y);
        invalidateViewport();
      })
      .on('end', (e) => {
        const n = e.subject as D3Node;
        if (activeSimulationMode === 'worker') {
          currentSimulationAlpha = Math.max(currentSimulationAlpha, 0.14);
          postWorkerDrag('end', n);
        } else if (!e.active) {
          simulation?.alphaTarget(0);
        }
        n.fx = null;
        n.fy = null;
        invalidateViewport();
      });

    d3.select(overlayCanvasRef).call(drag);
  };

  const handleResize = () => {
    if (containerRef) {
      const rect = containerRef.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
      // Invalidate gradient cache on resize
      clearPanPreviewCommit();
      clearBaseCanvasPreview();
      cachedGradient = null;
      invalidateViewport();
      if (activeSimulationMode === 'worker' && rect.width > 0) {
        isSimulationActive = true;
        currentSimulationAlpha = Math.max(currentSimulationAlpha, 0.15);
        postWorkerResize(rect.width, rect.height);
        startAnimationLoop();
      } else if (simulation && rect.width > 0) {
        // Only update center force - keep it simple
        simulation.force('center', d3.forceCenter(rect.width / 2, rect.height / 2).strength(0.1));
        simulation.alpha(0.15).restart(); // Gentler restart on resize
        isSimulationActive = true;
        startAnimationLoop();
      }
    }
  };

  const debouncedResize = debounce(handleResize, 150);

  onMount(() => {
    baseCanvasCtx = baseCanvasRef?.getContext('2d') ?? null;
    overlayCanvasCtx = overlayCanvasRef?.getContext('2d') ?? null;
    perfEnabled = readPerfToggle();
    if (perfEnabled) {
      maybeUpdatePerfHud(performance.now());
      console.info('[TopologyGraph] Perf HUD enabled. Add ?topologyPerf=1 or localStorage flexdeck.topologyPerf=1');
    }
    handleResize();
    window.addEventListener('resize', debouncedResize);
    // Don't start animation loop here - it will start when data arrives via initializeSimulation
    // Do an initial draw to show the background
    draw();
  });

  onCleanup(() => {
    window.removeEventListener('resize', debouncedResize);
    clearPanPreviewCommit();
    clearTopologySyncTimeout();
    clearBaseCanvasPreview();
    if (rafId !== null) cancelAnimationFrame(rafId);
    simulation?.stop();
    rejectPendingWorkerBuilds(new Error('Topology graph cleanup'));
    topologyWorker?.terminate();
    topologyWorker = null;
  });

  // Debounce simulation initialization to prevent rapid re-init during initial data load
  let initTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let styleRefreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const INIT_DEBOUNCE_MS = 150;
  const STYLE_REFRESH_DEBOUNCE_MS = 50;

  createEffect(() => {
    const topologyVersion = props.topologyVersion;
    const styleVersion = props.styleVersion;
    const topologyChanged = topologyVersion !== lastTopologyVersion;
    const styleChanged = styleVersion !== lastStyleVersion;
    if (perfEnabled) {
      perfCounters.effectRuns++;
      perfCounters.legacyHashEntityVisitsAvoided += sourceNodeCount * 2 + sourcePodCount * 2 + sourceServiceCount;
    }

    if (!topologyChanged && !styleChanged) return;

    lastTopologyVersion = topologyVersion;
    lastStyleVersion = styleVersion;

    if (topologyChanged) {
      if (perfEnabled) perfCounters.topologyRebuilds++;
      markTopologySyncing();
      // Clear any pending init
      if (initTimeoutId) {
        clearTimeout(initTimeoutId);
      }

      // Debounce initialization to batch rapid updates
      initTimeoutId = setTimeout(() => {
        initTimeoutId = null;
        untrack(() => initializeSimulation());
      }, INIT_DEBOUNCE_MS);
      return;
    }

    // Style-only updates (statuses, readiness) should not re-run simulation
    if (perfEnabled) perfCounters.styleRefreshes++;
    if (styleRefreshTimeoutId) clearTimeout(styleRefreshTimeoutId);
    styleRefreshTimeoutId = setTimeout(() => {
      styleRefreshTimeoutId = null;
      untrack(() => refreshNodeData());
      maybeUpdatePerfHud(performance.now());
    }, STYLE_REFRESH_DEBOUNCE_MS);
  });

  // Clean up init/style timeouts on unmount
  onCleanup(() => {
    if (initTimeoutId) clearTimeout(initTimeoutId);
    if (styleRefreshTimeoutId) clearTimeout(styleRefreshTimeoutId);
  });

  return (
    <div ref={containerRef} class="relative h-full w-full overflow-hidden bg-[#050a14]">
        <div class="pointer-events-none absolute inset-0 overflow-hidden">
            <div
                class="absolute -left-20 top-10 h-56 w-56 rounded-full bg-neon-cyan/10 blur-3xl"
                style={{ animation: 'topologyAuroraDrift 18s ease-in-out infinite' }}
            />
            <div
                class="absolute -right-24 bottom-6 h-64 w-64 rounded-full bg-neon-purple/10 blur-3xl"
                style={{ animation: 'topologyAuroraFloat 24s ease-in-out infinite' }}
            />
            <div class="absolute inset-0 opacity-[0.06]" style={{ background: 'radial-gradient(circle at 20% 20%, rgba(0,217,255,0.18), transparent 32%), radial-gradient(circle at 80% 76%, rgba(168,85,247,0.16), transparent 30%)' }} />
        </div>
        <canvas
            ref={baseCanvasRef}
            width={dimensions().width}
            height={dimensions().height}
            class="absolute inset-0 block pointer-events-none transition-opacity duration-200"
        />
        <canvas
            ref={overlayCanvasRef}
            width={dimensions().width}
            height={dimensions().height}
            class="absolute inset-0 block touch-none transition-opacity duration-150"
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
        />
        
        {/* Stats Overlay */}
        <div class="absolute left-4 top-4 flex items-center gap-3 rounded-md bg-surface/60 px-3 py-1.5 text-xs backdrop-blur pointer-events-none border border-white/5">
            <span class="text-text-dim">Nodes:</span>
            <span class="font-mono text-neon-cyan">{liveTopologyStats().nodes || nodeCount()}</span>
            <span class="text-text-dim ml-2 hidden sm:inline">Renderer:</span>
            <span class="font-mono text-neon-purple hidden sm:inline">Canvas/GPU</span>
            <Show when={topologySyncing()}>
              <span class="ml-1 inline-flex items-center gap-1 rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-neon-cyan shadow-[0_0_18px_rgba(0,217,255,0.12)]">
                <span class="h-1.5 w-1.5 rounded-full bg-neon-cyan animate-pulse" />
                Syncing
              </span>
            </Show>
            <Show when={densityOverviewActive()}>
              <span class="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-amber-200 shadow-[0_0_18px_rgba(251,191,36,0.12)]">
                <span class="h-1.5 w-1.5 rounded-full bg-amber-300" />
                Overview · {densityOverviewHiddenServices()} services + {densityOverviewHiddenPods()} pods grouped
              </span>
            </Show>
            <span class="ml-1 hidden items-center gap-2 rounded-full border border-white/10 bg-black/35 px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-text-dim shadow-[0_0_16px_rgba(0,0,0,0.2)] lg:inline-flex">
              <span>{liveTopologyStats().nodes}n/{liveTopologyStats().links}l</span>
              <span>{liveTopologyStats().fps.toFixed(0)}fps</span>
              <span>frame {liveTopologyStats().avgFrameMs.toFixed(1)}ms</span>
              <span>build {liveTopologyStats().lastBuildMs.toFixed(0)}ms</span>
              <span>settle {liveTopologyStats().lastSettleMs.toFixed(0)}ms</span>
              <Show when={liveTopologyStats().fiAccelSelectorCalls > 0}>
                <span>accel {liveTopologyStats().fiAccelSelectorCalls}x/{liveTopologyStats().fiAccelSelectorCandidates} · {liveTopologyStats().fiAccelSelectorMs.toFixed(2)}ms</span>
              </Show>
            </span>
        </div>

        <Show when={perfSnapshot()}>
          {(snapshot) => (
            <div class="absolute right-4 bottom-4 rounded-md border border-amber-300/40 bg-black/70 p-3 text-[10px] font-mono text-amber-100 backdrop-blur pointer-events-none">
              <div class="mb-1 text-amber-300 uppercase tracking-wider">Perf HUD</div>
              <div>fps {snapshot().fps.toFixed(1)} | avg {snapshot().avgFrameMs.toFixed(2)}ms | p95 {snapshot().p95FrameMs.toFixed(2)}ms</div>
              <div>max {snapshot().maxFrameMs.toFixed(2)}ms | nodes {snapshot().nodes} | links {snapshot().links}</div>
              <div>effects {snapshot().effectRuns} | rebuilds {snapshot().topologyRebuilds} | style {snapshot().styleRefreshes}</div>
              <div>sim init {snapshot().simulationInits} | settle {snapshot().simulationSettles} | avg settle {snapshot().avgSimulationSettleMs.toFixed(1)}ms</div>
              <div>draw start/stop {snapshot().drawStarts}/{snapshot().drawStops} | skipped {snapshot().denseFrameSkips}</div>
              <div>base/overlay draws {snapshot().baseLayerDraws}/{snapshot().overlayLayerDraws} | visible {snapshot().visibilityRefreshes}x @ {snapshot().avgVisibilityRefreshMs.toFixed(2)}ms</div>
              <div>worker ticks {snapshot().workerTickMessages} | visual refresh {snapshot().simulationVisualRefreshes} | deferred {snapshot().simulationVisualDeferrals}</div>
              <div>pressure score {snapshot().framePressureScore} | budget mode {snapshot().framePressureScore >= 4 ? 'on' : 'off'}</div>
              <div>legacy hash entity visits avoided {snapshot().legacyHashEntityVisitsAvoided.toLocaleString()}</div>
              <div>fi-accel {snapshot().fiAccelInitState} | last {snapshot().fiAccelBuildMode} build | selector {snapshot().fiAccelSelectorCalls}x/{snapshot().fiAccelSelectorCandidates} candidates | fallback {snapshot().fiAccelSelectorFallbackCalls} | {snapshot().fiAccelSelectorMs.toFixed(3)}ms</div>
            </div>
          )}
        </Show>

        {/* Legend */}
        <div class="absolute bottom-4 left-4 rounded-lg bg-surface/70 p-3 text-xs backdrop-blur-md border border-white/5 pointer-events-none">
            <div class="mb-2 font-medium text-text-muted uppercase tracking-wider text-[10px]">Legend</div>
            <div class="flex flex-col gap-2">
                <div class="flex items-center gap-2">
                    <div class="flex h-5 w-5 items-center justify-center rounded-full border-2 border-neon-cyan bg-neon-cyan/20">
                        <span class="text-[8px] text-neon-cyan">⬡</span>
                    </div>
                    <span class="text-text-dim">Node</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="flex h-4 w-4 items-center justify-center rounded-full border border-neon-purple bg-neon-purple/20">
                        <span class="text-[8px] text-neon-purple">◆</span>
                    </div>
                    <span class="text-text-dim">Service</span>
                </div>
                <div class="flex items-center gap-2">
                    <div class="flex h-3 w-3 items-center justify-center rounded-full border border-status-ok bg-status-ok/20" />
                    <span class="text-text-dim">Pod</span>
                </div>
                <div class="mt-1 border-t border-white/5 pt-2">
                     <span class="text-[10px] text-text-dim flex items-center gap-1">
                        <span class="inline-block w-2 h-2 rounded-full bg-neon-cyan animate-pulse" />
                        Traffic
                     </span>
                </div>
            </div>
        </div>

        {/* Selected Node Info */}
        <Show when={selectedNode()}>
            {(node) => (
                <div class="absolute right-4 top-4 max-w-xs rounded-lg bg-surface/80 p-4 backdrop-blur-md border border-white/10 shadow-xl z-10 transition-all duration-200">
                    <div class="mb-3 flex items-center gap-3">
                        <div class={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                            node().type === 'node' ? 'border-neon-cyan bg-neon-cyan/20' :
                            node().type === 'service' ? 'border-neon-purple bg-neon-purple/20' :
                            'border-status-ok bg-status-ok/20'
                        }`}>
                            <span class={`text-sm ${
                                node().type === 'node' ? 'text-neon-cyan' :
                                node().type === 'service' ? 'text-neon-purple' :
                                'text-status-ok'
                            }`}>
                                {getNodeIcon(node())}
                            </span>
                        </div>
                        <div>
                            <div class="font-medium text-text-main">{node().label}</div>
                            <div class="text-[10px] uppercase tracking-wider text-text-dim">{node().type}</div>
                        </div>
                    </div>
                    <div class="space-y-2 text-xs">
                        <div class="flex justify-between rounded bg-white/5 px-2 py-1">
                            <span class="text-text-dim">Status</span>
                            <span class={`capitalize font-medium ${
                                node().status === 'ok' ? 'text-status-ok' :
                                node().status === 'warn' ? 'text-status-warn' :
                                'text-status-error'
                            }`}>
                                {node().status === 'ok' ? 'Ready' : node().status}
                            </span>
                        </div>
                        <Show when={node().namespace}>
                            <div class="flex justify-between rounded bg-white/5 px-2 py-1">
                                <span class="text-text-dim">Namespace</span>
                                <span class="font-mono text-text-muted">{node().namespace}</span>
                            </div>
                        </Show>
                    </div>
                </div>
            )}
        </Show>

        <style>{`
          @keyframes topologyAuroraDrift {
            0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.24; }
            50% { transform: translate3d(38px, -18px, 0) scale(1.08); opacity: 0.38; }
          }
          @keyframes topologyAuroraFloat {
            0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.2; }
            50% { transform: translate3d(-34px, 22px, 0) scale(1.12); opacity: 0.34; }
          }
        `}</style>
    </div>
  );
};

export default TopologyGraph;
