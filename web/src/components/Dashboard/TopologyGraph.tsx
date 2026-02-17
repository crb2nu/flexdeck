import { Component, createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import * as d3 from 'd3';
import type { K8sNode, K8sPod, K8sService } from '../../lib/types';
import { isNodeReady } from '../../stores/k8s';

// Debounce utility
const debounce = <T extends (...args: unknown[]) => void>(fn: T, ms: number): T => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  }) as T;
};

interface Props {
  nodes: K8sNode[];
  pods: K8sPod[];
  services: K8sService[];
  onNodeClick?: (node: D3Node) => void;
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  type: 'node' | 'pod' | 'service';
  label: string;
  namespace?: string;
  status: 'ok' | 'warn' | 'error';
  data: K8sNode | K8sPod | K8sService;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  source: string | D3Node;
  target: string | D3Node;
  type: 'hosts' | 'selects';
}

// Particle pool for zero-allocation animation
const MAX_PARTICLES = 40;
const LARGE_GRAPH_NODE_THRESHOLD = 600;
const LARGE_GRAPH_LINK_THRESHOLD = 1200;
const REDUCED_FPS = 30;
const PARTICLE_IDLE_MS = 5000;
const INTERACTION_IDLE_MS = 800;
interface ParticleSlot {
  active: boolean;
  sourceIdx: number;
  targetIdx: number;
  progress: number;
  speed: number;
  colorIdx: 0 | 1; // 0 = cyan, 1 = purple
}

// Namespace color palette
const namespaceColors = [
  '#00d9ff', '#a855f7', '#22c55e', '#f97316', '#ec4899',
  '#3b82f6', '#eab308', '#06b6d4', '#8b5cf6', '#10b981'
];

const getNamespaceColor = (namespace: string, namespaceMap: Map<string, number>): string => {
  if (!namespaceMap.has(namespace)) {
    namespaceMap.set(namespace, namespaceMap.size);
  }
  return namespaceColors[namespaceMap.get(namespace)! % namespaceColors.length];
};

// Cached font strings to avoid per-frame string allocation
const FONT_NODE = '500 11px Inter, system-ui';
const FONT_OTHER = '400 9px Inter, system-ui';

const TopologyGraph: Component<Props> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let simulation: d3.Simulation<D3Node, D3Link> | null = null;
  let rafId: number | null = null;
  let lastTopologyKey = -1;
  let lastStyleKey = -1;

  // State
  const [selectedNode, setSelectedNode] = createSignal<D3Node | null>(null);
  const [hoverNode, setHoverNode] = createSignal<D3Node | null>(null);
  const [dimensions, setDimensions] = createSignal({ width: 800, height: 600 });
  const [nodeCount, setNodeCount] = createSignal(0);

  // View transform state
  let transform = d3.zoomIdentity;

  // Data state
  let graphNodes: D3Node[] = [];
  let graphLinks: D3Link[] = [];
  let hostsLinks: D3Link[] = [];
  let selectsLinks: D3Link[] = [];
  let namespaceMap = new Map<string, number>();
  const nodeIndexMap = new Map<string, number>(); // O(1) lookup for particle spawning

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

  // Node style cache - recomputed only when nodes change, not every frame
  // Includes pre-truncated labels to avoid string allocation every frame
  const nodeStylesCache = new Map<string, { r: number; color: string; truncLabel: string }>();
  let nodeStylesCacheValid = false;

  // Frustum bounds cache - recomputed only when transform/dimensions change
  const cachedFrustum = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let lastFrustumTransform = { x: -Infinity, y: -Infinity, k: -Infinity };
  let lastFrustumDims = { width: -1, height: -1 };

  // Spatial grid index for O(1) hover detection (replaces O(N) iteration)
  const GRID_CELL_SIZE = 50; // Pixels per cell
  const GRID_KEY_MULTIPLIER = 100000; // Supports grid coords from -50000 to +50000
  const spatialGrid = new Map<number, D3Node[]>();
  let spatialGridValid = false;
  const bumpInteraction = () => {
    lastInteractionAt = performance.now();
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

  const rebuildSpatialGrid = () => {
    spatialGrid.clear();
    for (const node of graphNodes) {
      if (node.x === undefined || node.y === undefined) continue;
      const key = getSpatialKey(node.x, node.y);
      if (!spatialGrid.has(key)) spatialGrid.set(key, []);
      spatialGrid.get(key)!.push(node);
    }
    spatialGridValid = true;
  };

  const getNodesNear = (x: number, y: number): D3Node[] => {
    // Check the cell and adjacent cells for nodes near the point
    const candidates: D3Node[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = getSpatialKey(x + dx * GRID_CELL_SIZE, y + dy * GRID_CELL_SIZE);
        const cellNodes = spatialGrid.get(key);
        if (cellNodes) candidates.push(...cellNodes);
      }
    }
    return candidates;
  };

  const hashString = (value: string): number => {
    let hash = 5381;
    for (let i = 0; i < value.length; i++) {
      hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
    }
    return hash >>> 0;
  };

  const getTopologyKey = (): number => {
    let hash = 0;
    hash = (hash + props.nodes.length * 3 + props.pods.length * 5 + props.services.length * 7) >>> 0;

    for (const node of props.nodes) {
      hash = (hash + hashString(`n:${node.metadata.name}`)) >>> 0;
    }

    for (const pod of props.pods) {
      const ns = pod.metadata.namespace ?? 'undefined';
      const nodeName = pod.spec.nodeName ?? '';
      hash = (hash + hashString(`p:${ns}/${pod.metadata.name}@${nodeName}`)) >>> 0;
    }

    for (const svc of props.services) {
      const ns = svc.metadata.namespace ?? 'undefined';
      const selectorEntries = Object.entries(svc.spec.selector || {}).sort(([a], [b]) => a.localeCompare(b));
      const selectorKey = selectorEntries.map(([k, v]) => `${k}=${v}`).join(';');
      hash = (hash + hashString(`s:${ns}/${svc.metadata.name}|${svc.spec.type || ''}|${selectorKey}`)) >>> 0;
    }

    return hash >>> 0;
  };

  const getStyleKey = (): number => {
    let hash = 0;
    for (const node of props.nodes) {
      const ready = isNodeReady(node as any) ? '1' : '0';
      hash = (hash + hashString(`n:${node.metadata.name}:${ready}`)) >>> 0;
    }
    for (const pod of props.pods) {
      const ns = pod.metadata.namespace ?? 'undefined';
      const phase = pod.status?.phase || '';
      hash = (hash + hashString(`p:${ns}/${pod.metadata.name}:${phase}`)) >>> 0;
    }
    return hash >>> 0;
  };

  const refreshNodeData = () => {
    if (graphNodes.length === 0) return;

    const nodeMap = new Map(props.nodes.map(node => [`node-${node.metadata.name}`, node]));
    const podMap = new Map(props.pods.map(pod => [`pod-${pod.metadata.namespace ?? 'undefined'}-${pod.metadata.name}`, pod]));
    const svcMap = new Map(props.services.map(svc => [`svc-${svc.metadata.namespace ?? 'undefined'}-${svc.metadata.name}`, svc]));

    for (const node of graphNodes) {
      if (node.type === 'node') {
        const data = nodeMap.get(node.id);
        if (data) {
          node.data = data;
          node.status = isNodeReady(data as any) ? 'ok' : 'error';
        }
      } else if (node.type === 'pod') {
        const data = podMap.get(node.id);
        if (data) {
          node.data = data;
          node.status = data.status.phase === 'Running' ? 'ok' :
            data.status.phase === 'Pending' ? 'warn' : 'error';
        }
      } else if (node.type === 'service') {
        const data = svcMap.get(node.id);
        if (data) {
          node.data = data;
          node.status = 'ok';
        }
      }
    }

    nodeStylesCacheValid = false;
    if (!isAnimating) startAnimationLoop();
  };

  const buildGraph = () => {
    // Build map of previous nodes to preserve physics state (x, y, vx, vy)
    const prevNodeMap = new Map(graphNodes.map(n => [n.id, n]));
    
    const links: D3Link[] = [];
    const hosts: D3Link[] = [];
    const selects: D3Link[] = [];
    const nodes: D3Node[] = [];
    const nodeMap = new Map<string, D3Node>();
    const nsMap = new Map<string, number>();
    
    // Helper to merge state
    const createOrUpdateNode = (id: string, type: 'node' | 'pod' | 'service', label: string, data: any, status: 'ok' | 'warn' | 'error', namespace?: string) => {
        const node: D3Node = {
            id, type, label, data, status, namespace
        };
        
        // Preserve physics state if node existed
        const prev = prevNodeMap.get(id);
        if (prev) {
            node.x = prev.x;
            node.y = prev.y;
            node.vx = prev.vx;
            node.vy = prev.vy;
            node.fx = prev.fx;
            node.fy = prev.fy;
        }
        return node;
    };

    // Add nodes
    for (const k8sNode of props.nodes) {
      const isReady = isNodeReady(k8sNode as any);
      const d3Node = createOrUpdateNode(
          `node-${k8sNode.metadata.name}`,
          'node',
          k8sNode.metadata.name,
          k8sNode,
          isReady ? 'ok' : 'error'
      );
      nodes.push(d3Node);
      nodeMap.set(d3Node.id, d3Node);
    }

    // Index pods by namespace for faster service linking
    const podsByNamespace = new Map<string, K8sPod[]>();
    for (const pod of props.pods) {
      const ns = pod.metadata.namespace || 'default';
      if (!podsByNamespace.has(ns)) podsByNamespace.set(ns, []);
      podsByNamespace.get(ns)!.push(pod);
    }

    // Add pods
    for (const pod of props.pods) {
      const status: 'ok' | 'warn' | 'error' =
        pod.status.phase === 'Running' ? 'ok' :
        pod.status.phase === 'Pending' ? 'warn' : 'error';

      const ns = pod.metadata.namespace || 'default';
      getNamespaceColor(ns, nsMap);

      const d3Node = createOrUpdateNode(
          `pod-${pod.metadata.namespace}-${pod.metadata.name}`,
          'pod',
          pod.metadata.name,
          pod,
          status,
          ns
      );
      nodes.push(d3Node);
      nodeMap.set(d3Node.id, d3Node);

      if (pod.spec.nodeName) {
        const nodeId = `node-${pod.spec.nodeName}`;
        if (nodeMap.has(nodeId)) {
          const link: D3Link = {
            source: d3Node.id,
            target: nodeId,
            type: 'hosts',
          };
          links.push(link);
          hosts.push(link);
        }
      }
    }

    // Add services
    for (const svc of props.services) {
      const ns = svc.metadata.namespace || 'default';
      getNamespaceColor(ns, nsMap);

      const d3Node = createOrUpdateNode(
          `svc-${svc.metadata.namespace}-${svc.metadata.name}`,
          'service',
          svc.metadata.name,
          svc,
          'ok',
          ns
      );
      nodes.push(d3Node);
      nodeMap.set(d3Node.id, d3Node);

      if (svc.spec.selector) {
        const namespacePods = podsByNamespace.get(ns) || [];
        const selectorEntries = Object.entries(svc.spec.selector);

        for (const pod of namespacePods) {
          const matches = selectorEntries.every(
            ([k, v]) => pod.metadata.labels?.[k] === v
          );
          if (matches) {
            const link: D3Link = {
              source: d3Node.id,
              target: `pod-${pod.metadata.namespace}-${pod.metadata.name}`,
              type: 'selects',
            };
            links.push(link);
            selects.push(link);
          }
        }
      }
    }

    graphNodes = nodes;
    graphLinks = links;
    hostsLinks = hosts;
    selectsLinks = selects;
    namespaceMap = nsMap;

    // Build O(1) index map for particle spawning
    nodeIndexMap.clear();
    nodes.forEach((node, idx) => nodeIndexMap.set(node.id, idx));

    // Invalidate style cache - will be rebuilt on next draw
    nodeStylesCacheValid = false;
    // Invalidate spatial grid - will be rebuilt on next hover check
    spatialGridValid = false;

    setNodeCount(nodes.length);
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
    isAnimating = true;
    rafId = requestAnimationFrame(draw);
  };

  /**
   * Main Draw Cycle - optimized for performance
   */
  const draw = () => {
    if (!canvasRef) return;
    const ctx = canvasRef.getContext('2d');
    if (!ctx) return;

    const now = performance.now();
    const isUserInteracting = now - lastInteractionAt < INTERACTION_IDLE_MS;
    const isDense = graphNodes.length > LARGE_GRAPH_NODE_THRESHOLD ||
      graphLinks.length > LARGE_GRAPH_LINK_THRESHOLD;
    const minFrameMs = isDense ? 1000 / REDUCED_FPS : 0;
    if (isAnimating && minFrameMs > 0 && now - lastFrameTime < minFrameMs) {
      rafId = requestAnimationFrame(draw);
      return;
    }
    lastFrameTime = now;

    frameCount++;
    const { width, height } = dimensions();
    const zoomLevel = transform.k;
    const reduceDetail = isDense && zoomLevel < 0.85;
    const reduceLinks = reduceDetail || zoomLevel < 0.5;
    const reduceNodeDetail = reduceDetail || zoomLevel < 0.6;
    const allowParticles = !reduceLinks && (isSimulationActive || isUserInteracting);

    // Invalidate spatial grid when simulation is active (nodes are moving)
    if (isSimulationActive) {
      spatialGridValid = false;
    }

    // Clear & Background - use cached gradient
    ctx.clearRect(0, 0, width, height);

    // Cache gradient - only recreate when dimensions change
    if (!cachedGradient || cachedGradientDims.width !== width || cachedGradientDims.height !== height) {
      // Use radial gradient for vignette effect
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

    // Subtle animated scanline effect (every 60 frames)
    if (!reduceLinks && frameCount % 2 === 0) {
      const scanY = (frameCount * 2) % height;
      ctx.fillStyle = 'rgba(0, 217, 255, 0.015)';
      ctx.fillRect(0, scanY, width, 2);
    }

    ctx.save();
    // Apply Zoom/Pan
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // Frustum culling bounds - cache and only recalculate when transform changes
    if (transform.x !== lastFrustumTransform.x ||
        transform.y !== lastFrustumTransform.y ||
        transform.k !== lastFrustumTransform.k ||
        width !== lastFrustumDims.width ||
        height !== lastFrustumDims.height) {
      const margin = 50 / transform.k;
      cachedFrustum.minX = -transform.x / transform.k - margin;
      cachedFrustum.maxX = (width - transform.x) / transform.k + margin;
      cachedFrustum.minY = -transform.y / transform.k - margin;
      cachedFrustum.maxY = (height - transform.y) / transform.k + margin;
      lastFrustumTransform = { x: transform.x, y: transform.y, k: transform.k };
      lastFrustumDims = { width, height };
    }

    const minX = cachedFrustum.minX;
    const maxX = cachedFrustum.maxX;
    const minY = cachedFrustum.minY;
    const maxY = cachedFrustum.maxY;
    const shouldCullLinks = zoomLevel > 0.8;

    // Draw Links with enhanced styling - Batched
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Batch Draw 'hosts' links (solid, cyan)
    if (hostsLinks.length > 0) {
      ctx.beginPath();
      for (const link of hostsLinks) {
        const s = link.source as D3Node; const t = link.target as D3Node;
        if (s.x !== undefined && s.y !== undefined && t.x !== undefined && t.y !== undefined) {
          if (shouldCullLinks) {
            const sIn = s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY;
            const tIn = t.x >= minX && t.x <= maxX && t.y >= minY && t.y <= maxY;
            if (!sIn && !tIn) continue;
          }
          ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
        }
      }
      if (!reduceLinks) {
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

    // Batch Draw 'selects' links (dashed, purple)
    if (selectsLinks.length > 0) {
      ctx.beginPath();
      for (const link of selectsLinks) {
        const s = link.source as D3Node; const t = link.target as D3Node;
        if (s.x !== undefined && s.y !== undefined && t.x !== undefined && t.y !== undefined) {
          if (shouldCullLinks) {
            const sIn = s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY;
            const tIn = t.x >= minX && t.x <= maxX && t.y >= minY && t.y <= maxY;
            if (!sIn && !tIn) continue;
          }
            ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
        }
      }
      if (!reduceLinks) {
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
    ctx.setLineDash([]); // Reset

    // Maybe spawn a particle (throttled)
    maybeSpawnParticle(now, allowParticles);

    // Draw Particles - BATCHED by color for fewer draw calls
    // Use pre-allocated pool to avoid per-frame allocation
    let particleCount = 0;

    // Update particles and collect positions into pool
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

      const sx = source.x ?? 0;
      const sy = source.y ?? 0;
      const tx = target.x ?? 0;
      const ty = target.y ?? 0;

      // Reuse pool slot instead of allocating
      const pos = particlePositionsPool[particleCount++];
      pos.x = sx + (tx - sx) * slot.progress;
      pos.y = sy + (ty - sy) * slot.progress;
      pos.colorIdx = slot.colorIdx;
    }

    // Batch draw particles by color - significantly fewer ctx state changes
    if (particleCount > 0) {
      // Outer glow layer - cyan particles
      ctx.beginPath();
      for (let i = 0; i < particleCount; i++) {
        const p = particlePositionsPool[i];
        if (p.colorIdx === 0) {
          ctx.moveTo(p.x + 4, p.y);
          ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
        }
      }
      ctx.fillStyle = 'rgba(0,217,255,0.25)';
      ctx.fill();

      // Outer glow layer - purple particles
      ctx.beginPath();
      for (let i = 0; i < particleCount; i++) {
        const p = particlePositionsPool[i];
        if (p.colorIdx === 1) {
          ctx.moveTo(p.x + 4, p.y);
          ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
        }
      }
      ctx.fillStyle = 'rgba(168,85,247,0.25)';
      ctx.fill();

      // Core layer - cyan particles
      ctx.beginPath();
      for (let i = 0; i < particleCount; i++) {
        const p = particlePositionsPool[i];
        if (p.colorIdx === 0) {
          ctx.moveTo(p.x + 1.5, p.y);
          ctx.arc(p.x, p.y, 1.5, 0, 2 * Math.PI);
        }
      }
      ctx.fillStyle = '#00d9ff';
      ctx.fill();

      // Core layer - purple particles
      ctx.beginPath();
      for (let i = 0; i < particleCount; i++) {
        const p = particlePositionsPool[i];
        if (p.colorIdx === 1) {
          ctx.moveTo(p.x + 1.5, p.y);
          ctx.arc(p.x, p.y, 1.5, 0, 2 * Math.PI);
        }
      }
      ctx.fillStyle = '#a855f7';
      ctx.fill();
    }

    // Cache signal values once per frame instead of per-node
    const selectedId = selectedNode()?.id;
    const hoveredId = hoverNode()?.id;

    // Rebuild node style cache if invalidated (only when nodes change, not every frame)
    if (!nodeStylesCacheValid) {
      nodeStylesCache.clear();
      for (const node of graphNodes) {
        // Pre-truncate labels to avoid string allocation in draw loop
        const truncLabel = node.label.length > 14 ? node.label.slice(0, 12) + '...' : node.label;
        nodeStylesCache.set(node.id, {
          r: getNodeRadius(node),
          color: getNodeColor(node),
          truncLabel
        });
      }
      nodeStylesCacheValid = true;
    }

    // Draw Nodes with enhanced glow effects
    const time = frameCount * 0.05; // For subtle animation

    // Draw nodes - use indexed for loop to avoid closure allocation
    for (let i = 0, len = graphNodes.length; i < len; i++) {
      const node = graphNodes[i];
      if (node.x === undefined || node.y === undefined) continue;

      // Frustum culling using cached bounds
      if (node.x < minX || node.x > maxX || node.y < minY || node.y > maxY) continue;

      // Use cached styles instead of recalculating
      const cached = nodeStylesCache.get(node.id)!;
      const r = cached.r;
      const color = cached.color;
      const isSelected = selectedId === node.id;
      const isHovered = hoveredId === node.id;

      // Multi-layer glow for selected/hovered nodes
      if (isSelected || isHovered) {
        // Outer pulse glow (animates for selected)
        const pulseScale = isSelected ? 1 + Math.sin(time * 2) * 0.15 : 1;
        const glowRadius = (isSelected ? 12 : 6) * pulseScale;

        // Outer soft glow
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + glowRadius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.08;
        ctx.fill();

        // Middle glow
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + glowRadius * 0.6, 0, 2 * Math.PI);
        ctx.globalAlpha = 0.12;
        ctx.fill();

        // Inner glow
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + glowRadius * 0.3, 0, 2 * Math.PI);
        ctx.globalAlpha = 0.18;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      // Main Circle Background with subtle gradient effect
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = '#0a1020';
      ctx.fill();

      // Filled tint with enhanced opacity for visual depth
      ctx.fillStyle = color;
      ctx.globalAlpha = node.type === 'node' ? 0.25 : 0.45;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Stroke with enhanced styling
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : (node.type === 'node' ? 2 : 1.5);
      ctx.stroke();

      // Inner Highlight Ring for nodes (enhanced)
      if (node.type === 'node' && !reduceNodeDetail) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r - 4, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Secondary inner ring for depth
        ctx.beginPath();
        ctx.arc(node.x, node.y, r - 8, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.stroke();
      }

      // Enhanced center dot for pods with glow
      if (node.type === 'pod') {
        // Outer glow dot
        if (!reduceNodeDetail) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 3, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.4;
          ctx.fill();
          ctx.globalAlpha = 1.0;
        }

        // Core dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, 1.5, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      }

      // Service diamond indicator
      if (node.type === 'service' && !reduceNodeDetail) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    }

    // Draw Labels (Separate loop to be on top) - reuse cached selectedId/hoveredId
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#cccccc';

    // Track last font to minimize ctx.font changes
    let lastFont = '';

    // Draw labels - use indexed for loop to avoid closure allocation
    const labelZoomThreshold = reduceDetail ? 0.7 : 0.4;
    for (let i = 0, len = graphNodes.length; i < len; i++) {
        const node = graphNodes[i];
        if (node.x === undefined || node.y === undefined) continue;
        const shouldDrawLabel = node.type === 'node' || node.type === 'service' ||
                                selectedId === node.id || hoveredId === node.id;

        if (shouldDrawLabel && zoomLevel > labelZoomThreshold) {
            const cached = nodeStylesCache.get(node.id)!;
            const font = node.type === 'node' ? FONT_NODE : FONT_OTHER;
            if (font !== lastFont) {
                ctx.font = font;
                lastFont = font;
            }
            // Use cached truncated label, or full label when hovered
            ctx.fillText(
                hoveredId === node.id ? node.label : cached.truncLabel,
                node.x,
                node.y + cached.r + 12
            );
        }
    }

    ctx.restore();

    // Continue animation only if simulation is active or particles exist
    // This prevents infinite 60fps loop when nothing is changing
    const shouldContinue = isSimulationActive || activeParticleCount > 0 || isUserInteracting;
    if (shouldContinue) {
      rafId = requestAnimationFrame(draw);
    } else {
      isAnimating = false;
      rafId = null;
    }
  };

  // Click & Hover detection - uses spatial grid for O(1) average lookup
  const getKeyUnderMouse = (event: MouseEvent): D3Node | null => {
      if (!canvasRef) return null;
      const rect = canvasRef.getBoundingClientRect();
      const x = (event.clientX - rect.left - transform.x) / transform.k;
      const y = (event.clientY - rect.top - transform.y) / transform.k;

      // Rebuild spatial grid if invalidated (nodes moved/changed)
      if (!spatialGridValid) {
          rebuildSpatialGrid();
      }

      let minDistSq = Infinity;
      let found: D3Node | null = null;

      // Use spatial grid for O(1) lookup instead of O(N) iteration
      const candidates = getNodesNear(x, y);
      for (const n of candidates) {
          if (n.x === undefined || n.y === undefined) continue;
          const dx = x - n.x;
          const dy = y - n.y;
          const distSq = dx * dx + dy * dy; // Avoid sqrt - compare squared distances
          const cached = nodeStylesCache.get(n.id);
          const r = (cached?.r ?? getNodeRadius(n)) + 4; // 4px padding for easier selection
          const rSq = r * r;

          if (distSq < rSq && distSq < minDistSq) {
              minDistSq = distSq;
              found = n;
          }
      }
      return found;
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
      // Trigger redraw for selection visual feedback
      if (!isAnimating) {
        startAnimationLoop();
      }
  };

  // Throttle mouse move to max 60fps (every ~16ms)
  let lastMouseMoveTime = 0;
  const handleMouseMove = (event: MouseEvent) => {
      const now = performance.now();
      if (now - lastMouseMoveTime < 16) return; // Skip if called too soon
      lastMouseMoveTime = now;

      const node = getKeyUnderMouse(event);
      const currentHover = hoverNode();
      if (node !== currentHover) {
          bumpInteraction();
          setHoverNode(node);
          if (canvasRef) canvasRef.style.cursor = node ? 'pointer' : 'default';
          // Trigger redraw for hover visual feedback (single frame, not continuous)
          if (!isAnimating) {
            startAnimationLoop();
          }
      }
  };

  const initializeSimulation = () => {
    if (!canvasRef) return;

    // Stop any existing simulation before rebuilding
    if (simulation) {
      simulation.stop();
      simulation = null;
    }

    resetParticles();
    buildGraph();

    // Early exit if no data - just render empty background
    if (graphNodes.length === 0) {
      isSimulationActive = false;
      draw();
      return;
    }

    const { width, height } = dimensions();

    // Adaptive forces based on node count - gentler for smoother animation
    const nodeCount = graphNodes.length || 1;
    const linkDistance = Math.max(80, Math.min(140, 2500 / Math.sqrt(nodeCount)));
    const chargeStrength = Math.max(-400, Math.min(-120, -2500 / Math.sqrt(nodeCount)));

    // Pre-position new nodes in a circle to avoid initial explosion
    const cx = width / 2;
    const cy = height / 2;
    const initialRadius = Math.min(width, height) * 0.3;
    graphNodes.forEach((node, i) => {
      if (node.x !== undefined && node.y !== undefined) return;
      const angle = (i / graphNodes.length) * Math.PI * 2;
      node.x = cx + Math.cos(angle) * initialRadius * (0.5 + Math.random() * 0.5);
      node.y = cy + Math.sin(angle) * initialRadius * (0.5 + Math.random() * 0.5);
    });

    // Create simulation with reduced force complexity
    // Removed redundant x/y forces (center handles this)
    simulation = d3.forceSimulation<D3Node>(graphNodes)
      .alpha(0.3) // Lower initial alpha for gentler start
      .alphaDecay(0.03) // Faster decay to settle quicker
      .alphaMin(0.001)
      .velocityDecay(0.5) // Higher damping for stability
      .force('link', d3.forceLink<D3Node, D3Link>(graphLinks)
        .id(d => d.id)
        .distance(linkDistance)
        .strength(0.3))
      .force('charge', d3.forceManyBody().strength(chargeStrength).distanceMax(250))
      .force('center', d3.forceCenter(cx, cy).strength(0.1))
      // Collision is expensive - only enable for smaller graphs
      .force('collision', graphNodes.length < 200
        ? d3.forceCollide().radius((d) => getNodeRadius(d as D3Node) + 8).strength(0.5)
        : null)
      .on('end', () => {
        isSimulationActive = false;
        simulationSettledAt = performance.now();
      });

    // Run warmup ticks synchronously to stabilize layout before first render
    // This prevents the chaotic initial explosion
    simulation.stop();
    const warmupTicks = Math.min(100, Math.max(30, graphNodes.length));
    for (let i = 0; i < warmupTicks; i++) {
      simulation.tick();
    }

    // Continue with reduced alpha after warmup
    simulation.alpha(0.2).restart();

    // NOW start animation loop after warmup
    isSimulationActive = true;
    simulationSettledAt = 0; // Reset idle timeout when simulation starts
    startAnimationLoop();

    // Zoom behavior
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (e) => {
        transform = e.transform;
        bumpInteraction();
        // Restart animation if not running (for pan/zoom after settling)
        startAnimationLoop();
      });
        
    d3.select(canvasRef)
        .call(zoom)
        .on("dblclick.zoom", null);

    // Initial positioning if not defined
    if (graphNodes.length > 0 && !graphNodes[0].x) {
        // Apply initial Zoom Fit
        const baseZoom = Math.max(0.3, Math.min(0.8, 50 / (graphNodes.length || 1)));
        d3.select(canvasRef).call(zoom.transform, 
            d3.zoomIdentity.translate(width/2, height/2).scale(baseZoom).translate(-width/2, -height/2));
    }
    
    // Drag behavior
    const drag = d3.drag<HTMLCanvasElement, unknown>()
      .subject((e) => {
        const node = getKeyUnderMouse(e.sourceEvent);
        return node ? node : null;
      })
      .on('start', (e) => {
        if (!e.active) {
          simulation?.alphaTarget(0.3).restart();
          isSimulationActive = true;
          startAnimationLoop();
        }
        bumpInteraction();
        const n = e.subject as D3Node;
        n.fx = n.x;
        n.fy = n.y;
      })
      .on('drag', (e) => {
        bumpInteraction();
        const n = e.subject as D3Node;
        n.fx = e.x;
        n.fy = e.y;
      })
      .on('end', (e) => {
        if (!e.active) simulation?.alphaTarget(0);
        const n = e.subject as D3Node;
        n.fx = null;
        n.fy = null;
      });

    d3.select(canvasRef).call(drag);
  };

  const handleResize = () => {
    if (containerRef) {
      const rect = containerRef.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
      // Invalidate gradient cache on resize
      cachedGradient = null;
      if (simulation && rect.width > 0) {
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
    handleResize();
    window.addEventListener('resize', debouncedResize);
    // Don't start animation loop here - it will start when data arrives via initializeSimulation
    // Do an initial draw to show the background
    draw();
  });

  onCleanup(() => {
    window.removeEventListener('resize', debouncedResize);
    if (rafId !== null) cancelAnimationFrame(rafId);
    simulation?.stop();
  });

  // Debounce simulation initialization to prevent rapid re-init during initial data load
  let initTimeoutId: ReturnType<typeof setTimeout> | null = null;
  const INIT_DEBOUNCE_MS = 150;

  createEffect(() => {
    // Track props for reactivity
    props.nodes; props.pods; props.services;
    const topologyKey = getTopologyKey();
    const styleKey = getStyleKey();
    const topologyChanged = topologyKey !== lastTopologyKey;
    const styleChanged = styleKey !== lastStyleKey;

    if (!topologyChanged && !styleChanged) return;

    lastTopologyKey = topologyKey;
    lastStyleKey = styleKey;

    if (topologyChanged) {
      // Clear any pending init
      if (initTimeoutId) {
        clearTimeout(initTimeoutId);
      }

      // Debounce initialization to batch rapid updates
      initTimeoutId = setTimeout(() => {
        initTimeoutId = null;
        initializeSimulation();
      }, INIT_DEBOUNCE_MS);
      return;
    }

    // Style-only updates (statuses, readiness) should not re-run simulation
    refreshNodeData();
  });

  // Clean up init timeout on unmount
  onCleanup(() => {
    if (initTimeoutId) clearTimeout(initTimeoutId);
  });

  return (
    <div ref={containerRef} class="relative h-full w-full overflow-hidden bg-[#050a14]">
        <canvas
            ref={canvasRef}
            width={dimensions().width}
            height={dimensions().height}
            class="block touch-none"
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
        />
        
        {/* Stats Overlay */}
        <div class="absolute left-4 top-4 flex items-center gap-3 rounded-md bg-surface/60 px-3 py-1.5 text-xs backdrop-blur pointer-events-none border border-white/5">
            <span class="text-text-dim">Nodes:</span>
            <span class="font-mono text-neon-cyan">{nodeCount()}</span>
            <span class="text-text-dim ml-2 hidden sm:inline">Renderer:</span>
            <span class="font-mono text-neon-purple hidden sm:inline">Canvas/GPU</span>
        </div>

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
    </div>
  );
};

export default TopologyGraph;
