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

const TopologyGraph: Component<Props> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let simulation: d3.Simulation<D3Node, D3Link> | null = null;
  let rafId: number | null = null;
  let lastDataKey = '';

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
  let namespaceMap = new Map<string, number>();

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
  const PARTICLE_COLORS = ['#00d9ff', '#a855f7'] as const;

  // Performance optimization state
  let cachedGradient: CanvasGradient | null = null;
  let cachedGradientDims = { width: 0, height: 0 };
  let isSimulationActive = false;
  let frameCount = 0;
  let isAnimating = false;

  // Compute a lightweight hash for data change detection (exclude dimensions to avoid resize re-init)
  const getDataKey = (): string => {
    // Use counts + sample IDs for O(1) approximate change detection instead of O(n log n) full sort
    const nodeCount = props.nodes.length;
    const podCount = props.pods.length;
    const svcCount = props.services.length;

    // Sample first/last items for change detection without sorting entire arrays
    const nodeSample = nodeCount > 0 ? `${props.nodes[0]?.metadata.name}:${props.nodes[nodeCount-1]?.metadata.name}` : '';
    const podSample = podCount > 0 ? `${props.pods[0]?.metadata.name}:${props.pods[podCount-1]?.status.phase}` : '';
    const svcSample = svcCount > 0 ? `${props.services[0]?.metadata.name}` : '';

    return `${nodeCount}|${podCount}|${svcCount}|${nodeSample}|${podSample}|${svcSample}`;
  };

  const buildGraph = () => {
    // Build map of previous nodes to preserve physics state (x, y, vx, vy)
    const prevNodeMap = new Map(graphNodes.map(n => [n.id, n]));
    
    const links: D3Link[] = [];
    const nodes: D3Node[] = [];
    const nodeMap = new Map<string, D3Node>();
    const nsMap = new Map<string, number>();
    
    // Helper to merge state
    const createOrUpdateNode = (id: string, type: 'node' | 'pod' | 'service', label: string, data: any, status: 'ok' | 'warn' | 'error', namespace?: string) => {
        let node: D3Node = {
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
          links.push({
            source: d3Node.id,
            target: nodeId,
            type: 'hosts',
          });
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
            links.push({
              source: d3Node.id,
              target: `pod-${pod.metadata.namespace}-${pod.metadata.name}`,
              type: 'selects',
            });
          }
        }
      }
    }

    graphNodes = nodes;
    graphLinks = links;
    namespaceMap = nsMap;
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
  const maybeSpawnParticle = () => {
    // Only spawn every 8 frames and with 60% chance
    if (frameCount % 8 !== 0) return;
    if (graphLinks.length === 0 || activeParticleCount >= MAX_PARTICLES * 0.75 || Math.random() > 0.6) return;

    const linkIdx = Math.floor(Math.random() * graphLinks.length);
    const link = graphLinks[linkIdx];
    const source = link.source as D3Node;
    const target = link.target as D3Node;

    // Only spawn if nodes have positions
    if (source.x !== undefined && target.x !== undefined) {
      // Find an inactive slot in the pool
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (!particlePool[i].active) {
          const slot = particlePool[i];
          slot.active = true;
          slot.sourceIdx = graphNodes.indexOf(source);
          slot.targetIdx = graphNodes.indexOf(target);
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

    frameCount++;
    const { width, height } = dimensions();

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
    if (frameCount % 2 === 0) {
      const scanY = (frameCount * 2) % height;
      ctx.fillStyle = 'rgba(0, 217, 255, 0.015)';
      ctx.fillRect(0, scanY, width, 2);
    }

    ctx.save();
    // Apply Zoom/Pan
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // Draw Links with enhanced styling - Batched
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const hostsLinks: D3Link[] = [];
    const selectsLinks: D3Link[] = [];

    for (const link of graphLinks) {
      if (link.type === 'selects') selectsLinks.push(link);
      else hostsLinks.push(link);
    }

    // Batch Draw 'hosts' links (solid, cyan)
    if (hostsLinks.length > 0) {
      // Glow
      ctx.beginPath();
      for (const link of hostsLinks) {
        const s = link.source as D3Node; const t = link.target as D3Node;
        if (s.x !== undefined && s.y !== undefined && t.x !== undefined && t.y !== undefined) {
          ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
        }
      }
      ctx.strokeStyle = 'rgba(0, 217, 255, 0.06)';
      ctx.lineWidth = 5;
      ctx.setLineDash([]);
      ctx.stroke();

      // Main
      ctx.beginPath();
      for (const link of hostsLinks) {
        const s = link.source as D3Node; const t = link.target as D3Node;
        if (s.x !== undefined && s.y !== undefined && t.x !== undefined && t.y !== undefined) {
          ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
        }
      }
      ctx.strokeStyle = 'rgba(0, 217, 255, 0.28)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Batch Draw 'selects' links (dashed, purple)
    if (selectsLinks.length > 0) {
      // Glow
      ctx.beginPath();
      for (const link of selectsLinks) {
        const s = link.source as D3Node; const t = link.target as D3Node;
        if (s.x !== undefined && s.y !== undefined && t.x !== undefined && t.y !== undefined) {
            ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
        }
      }
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.06)';
      ctx.lineWidth = 4;
      ctx.setLineDash([]);
      ctx.stroke();

      // Main
      ctx.beginPath();
      for (const link of selectsLinks) {
        const s = link.source as D3Node; const t = link.target as D3Node;
        if (s.x !== undefined && s.y !== undefined && t.x !== undefined && t.y !== undefined) {
            ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y);
        }
      }
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.25)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
    }
    ctx.setLineDash([]); // Reset

    // Maybe spawn a particle (throttled)
    maybeSpawnParticle();

    // Draw Particles using object pool - no array mutations, no allocations
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

      const x = sx + (tx - sx) * slot.progress;
      const y = sy + (ty - sy) * slot.progress;
      const color = PARTICLE_COLORS[slot.colorIdx];

      // Draw particle trail (3 trailing dots with decreasing opacity)
      const trailLength = 0.08;
      for (let t = 2; t >= 0; t--) {
        const trailProgress = Math.max(0, slot.progress - t * trailLength * 0.5);
        const trailX = sx + (tx - sx) * trailProgress;
        const trailY = sy + (ty - sy) * trailProgress;
        const trailOpacity = (3 - t) * 0.08;
        const trailSize = 1.5 - t * 0.3;

        ctx.beginPath();
        ctx.arc(trailX, trailY, trailSize, 0, 2 * Math.PI);
        ctx.fillStyle = slot.colorIdx === 0
          ? `rgba(0,217,255,${trailOpacity})`
          : `rgba(168,85,247,${trailOpacity})`;
        ctx.fill();
      }

      // Draw particle with multi-layer glow (no shadowBlur for performance)
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = slot.colorIdx === 0 ? 'rgba(0,217,255,0.15)' : 'rgba(168,85,247,0.15)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = slot.colorIdx === 0 ? 'rgba(0,217,255,0.35)' : 'rgba(168,85,247,0.35)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Cache signal values once per frame instead of per-node
    const selectedId = selectedNode()?.id;
    const hoveredId = hoverNode()?.id;

    // Draw Nodes with enhanced glow effects
    const time = frameCount * 0.05; // For subtle animation
    
    // Frustum culling bounds
    const margin = 50 / transform.k; // Adjust margin based on zoom
    const visibleMinX = -transform.x / transform.k - margin;
    const visibleMaxX = (width - transform.x) / transform.k + margin;
    const visibleMinY = -transform.y / transform.k - margin;
    const visibleMaxY = (height - transform.y) / transform.k + margin;

    graphNodes.forEach(node => {
      if (node.x === undefined || node.y === undefined) return;
      
      // Frustum culling
      if (node.x < visibleMinX || node.x > visibleMaxX || node.y < visibleMinY || node.y > visibleMaxY) return;

      const r = getNodeRadius(node);
      const color = getNodeColor(node);
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
      if (node.type === 'node') {
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
        ctx.beginPath();
        ctx.arc(node.x, node.y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.4;
        ctx.fill();
        ctx.globalAlpha = 1.0;

        // Core dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, 1.5, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      }

      // Service diamond indicator
      if (node.type === 'service') {
        ctx.beginPath();
        ctx.arc(node.x, node.y, 4, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }
    });

    // Draw Labels (Separate loop to be on top) - reuse cached selectedId/hoveredId
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    graphNodes.forEach(node => {
        if (node.x === undefined || node.y === undefined) return;
        const shouldDrawLabel = node.type === 'node' || node.type === 'service' ||
                                selectedId === node.id || hoveredId === node.id;

        if (shouldDrawLabel && transform.k > 0.4) {
            const r = getNodeRadius(node);
            ctx.font = node.type === 'node' ? '500 11px Inter, system-ui' : '400 9px Inter, system-ui';
            ctx.fillStyle = '#cccccc';
            ctx.fillText(
                node.label.length > 14 && !hoveredId ? node.label.slice(0, 12)+'...' : node.label,
                node.x,
                node.y + r + 12
            );
        }
    });

    ctx.restore();

    // Continue animation only if simulation is active or particles exist
    // This prevents infinite 60fps loop when nothing is changing
    const shouldContinue = isSimulationActive || activeParticleCount > 0;
    if (shouldContinue) {
      rafId = requestAnimationFrame(draw);
    } else {
      isAnimating = false;
      rafId = null;
    }
  };

  // Click & Hover detection - optimized to avoid sqrt
  const getKeyUnderMouse = (event: MouseEvent): D3Node | null => {
      if (!canvasRef) return null;
      const rect = canvasRef.getBoundingClientRect();
      const x = (event.clientX - rect.left - transform.x) / transform.k;
      const y = (event.clientY - rect.top - transform.y) / transform.k;

      let minDistSq = Infinity;
      let found: D3Node | null = null;

      // Iterate in reverse to prefer nodes drawn on top
      for (let i = graphNodes.length - 1; i >= 0; i--) {
          const n = graphNodes[i];
          if (n.x === undefined || n.y === undefined) continue;
          const dx = x - n.x;
          const dy = y - n.y;
          const distSq = dx * dx + dy * dy; // Avoid sqrt - compare squared distances
          const r = getNodeRadius(n) + 4; // 4px padding for easier selection
          const rSq = r * r;

          if (distSq < rSq && distSq < minDistSq) {
              minDistSq = distSq;
              found = n;
          }
      }
      return found;
  };

  const handleCanvasClick = (event: MouseEvent) => {
      const node = getKeyUnderMouse(event);
      if (node) {
          setSelectedNode(node);
          props.onNodeClick?.(node);
      } else {
          setSelectedNode(null);
      }
      // Trigger redraw for selection visual feedback
      if (!isAnimating) {
        requestAnimationFrame(draw);
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
          setHoverNode(node);
          if (canvasRef) canvasRef.style.cursor = node ? 'pointer' : 'default';
          // Trigger redraw for hover visual feedback (single frame, not continuous)
          if (!isAnimating) {
            requestAnimationFrame(draw);
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

    // Pre-position nodes in a circle to avoid initial explosion
    const cx = width / 2;
    const cy = height / 2;
    const initialRadius = Math.min(width, height) * 0.3;
    graphNodes.forEach((node, i) => {
      const angle = (i / graphNodes.length) * Math.PI * 2;
      node.x = cx + Math.cos(angle) * initialRadius * (0.5 + Math.random() * 0.5);
      node.y = cy + Math.sin(angle) * initialRadius * (0.5 + Math.random() * 0.5);
    });

    // Create simulation with gentle initial alpha
    simulation = d3.forceSimulation<D3Node>(graphNodes)
      .alpha(0.4) // Start with lower alpha for gentler initial movement
      .alphaDecay(0.02) // Slower decay for smoother settling
      .alphaMin(0.001) // Stop earlier
      .velocityDecay(0.4) // Higher damping for smoother animation
      .force('link', d3.forceLink<D3Node, D3Link>(graphLinks)
        .id(d => d.id)
        .distance(linkDistance)
        .strength(0.2)) // Gentler link force
      .force('charge', d3.forceManyBody().strength(chargeStrength).distanceMax(300))
      .force('center', d3.forceCenter(cx, cy).strength(0.05))
      .force('collision', d3.forceCollide().radius((d) => getNodeRadius(d as D3Node) + 12).strength(0.7))
      .force('x', d3.forceX(cx).strength(0.03))
      .force('y', d3.forceY(cy).strength(0.03))
      .on('end', () => {
        isSimulationActive = false;
      });

    // Run minimal warmup ticks synchronously to prevent initial explosion
    // Using more ticks for better stability on load
    const warmupTicks = Math.min(100, Math.max(40, nodeCount * 2)); 
    simulation.stop();
    for (let i = 0; i < warmupTicks; i++) {
        simulation.tick();
    }
    simulation.alpha(0.5).restart(); // Start with moderate energy

    // NOW start animation loop after warmup
    isSimulationActive = true;
    startAnimationLoop();

    // Zoom behavior
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (e) => {
        transform = e.transform;
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
        const n = e.subject as D3Node;
        n.fx = n.x;
        n.fy = n.y;
      })
      .on('drag', (e) => {
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
        simulation.force('center', d3.forceCenter(rect.width / 2, rect.height / 2));
        simulation.force('x', d3.forceX(rect.width / 2).strength(0.04));
        simulation.force('y', d3.forceY(rect.height / 2).strength(0.04));
        simulation.alpha(0.3).restart();
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

  createEffect(() => {
    // Track props for reactivity
    props.nodes; props.pods; props.services;
    const key = getDataKey();

    if (key !== lastDataKey) {
      lastDataKey = key;

      // Clear any pending init
      if (initTimeoutId) {
        clearTimeout(initTimeoutId);
      }

      // Debounce initialization by 50ms to batch rapid updates
      initTimeoutId = setTimeout(() => {
        initTimeoutId = null;
        initializeSimulation();
      }, 50);
    }
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
                        <span class="inline-block w-2 h-2 rounded-full bg-neon-cyan animate-pulse"></span>
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
