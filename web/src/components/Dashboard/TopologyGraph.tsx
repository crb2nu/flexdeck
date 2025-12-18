import { Component, createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import * as d3 from 'd3';
import type { K8sNode, K8sPod, K8sService } from '../../lib/types';

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

interface Particle {
  source: D3Node;
  target: D3Node;
  progress: number;
  speed: number;
  color: string;
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
  let particles: Particle[] = [];

  // Performance optimization state
  let cachedGradient: CanvasGradient | null = null;
  let cachedGradientDims = { width: 0, height: 0 };
  let isSimulationActive = false;
  let frameCount = 0;
  let isAnimating = false;

  const getDataKey = (): string => {
    const nodeIds = props.nodes.map(n => n.metadata.name).sort().join(',');
    const podIds = props.pods.map(p => `${p.metadata.namespace}/${p.metadata.name}:${p.status.phase}`).sort().join(',');
    const svcIds = props.services.map(s => `${s.metadata.namespace}/${s.metadata.name}`).sort().join(',');
    const dims = dimensions();
    return `${nodeIds}|${podIds}|${svcIds}|${dims.width}x${dims.height}`;
  };

  const buildGraph = () => {
    const nodes: D3Node[] = [];
    const links: D3Link[] = [];
    const nodeMap = new Map<string, D3Node>();
    const nsMap = new Map<string, number>();

    // Add K8s nodes
    for (const node of props.nodes) {
      const isReady = node.status.conditions.some(c => c.type === 'Ready' && c.status === 'True');
      const d3Node: D3Node = {
        id: `node-${node.metadata.name}`,
        type: 'node',
        label: node.metadata.name,
        status: isReady ? 'ok' : 'error',
        data: node,
      };
      nodes.push(d3Node);
      nodeMap.set(d3Node.id, d3Node);
    }

    // Add pods
    for (const pod of props.pods) {
      const status: 'ok' | 'warn' | 'error' =
        pod.status.phase === 'Running' ? 'ok' :
        pod.status.phase === 'Pending' ? 'warn' : 'error';

      const ns = pod.metadata.namespace || 'default';
      getNamespaceColor(ns, nsMap);

      const d3Node: D3Node = {
        id: `pod-${pod.metadata.namespace}-${pod.metadata.name}`,
        type: 'pod',
        label: pod.metadata.name,
        namespace: ns,
        status,
        data: pod,
      };
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

      const d3Node: D3Node = {
        id: `svc-${svc.metadata.namespace}-${svc.metadata.name}`,
        type: 'service',
        label: svc.metadata.name,
        namespace: ns,
        status: 'ok',
        data: svc,
      };
      nodes.push(d3Node);
      nodeMap.set(d3Node.id, d3Node);

      if (svc.spec.selector) {
        for (const pod of props.pods) {
          if (pod.metadata.namespace === svc.metadata.namespace) {
            const matches = Object.entries(svc.spec.selector).every(
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

  // Throttled particle spawning - only runs every 10 frames
  const maybeSpawnParticle = () => {
    // Only spawn every 10 frames and with 50% chance
    if (frameCount % 10 !== 0) return;
    if (graphLinks.length === 0 || particles.length >= 30 || Math.random() > 0.5) return;

    const link = graphLinks[Math.floor(Math.random() * graphLinks.length)];
    // Only spawn if nodes have positions
    if ((link.source as D3Node).x && (link.target as D3Node).x) {
      particles.push({
        source: link.source as D3Node,
        target: link.target as D3Node,
        progress: 0,
        speed: 0.015 + Math.random() * 0.015,
        color: link.type === 'hosts' ? '#00d9ff' : '#a855f7'
      });
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
      cachedGradient = ctx.createLinearGradient(0, 0, width, height);
      cachedGradient.addColorStop(0, '#050a14');
      cachedGradient.addColorStop(0.5, '#0a1020');
      cachedGradient.addColorStop(1, '#0d1528');
      cachedGradientDims = { width, height };
    }
    ctx.fillStyle = cachedGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    // Apply Zoom/Pan
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // Draw Links
    ctx.lineCap = 'round';
    for (const link of graphLinks) {
      const source = link.source as D3Node;
      const target = link.target as D3Node;
      if (source.x === undefined || source.y === undefined || target.x === undefined || target.y === undefined) continue;

      const isSelects = link.type === 'selects';
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);

      // Style
      if (isSelects) {
        ctx.strokeStyle = 'rgba(168, 85, 247, 0.2)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = 'rgba(0, 217, 255, 0.2)';
        ctx.setLineDash([]);
        ctx.lineWidth = 1.5;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]); // Reset

    // Maybe spawn a particle (throttled)
    maybeSpawnParticle();

    // Draw Particles - no shadow blur for performance
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.progress += p.speed;
      if (p.progress >= 1) {
        particles.splice(i, 1);
        continue;
      }

      const sx = p.source.x ?? 0;
      const sy = p.source.y ?? 0;
      const tx = p.target.x ?? 0;
      const ty = p.target.y ?? 0;

      const x = sx * (1 - p.progress) + tx * p.progress;
      const y = sy * (1 - p.progress) + ty * p.progress;

      // Draw particle with simple glow (two circles instead of shadowBlur)
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fillStyle = p.color + '40'; // 25% opacity outer glow
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, 2, 0, 2 * Math.PI);
      ctx.fillStyle = p.color;
      ctx.fill();
    }

    // Draw Nodes
    graphNodes.forEach(node => {
      if (node.x === undefined || node.y === undefined) return;
      const r = getNodeRadius(node);
      const color = getNodeColor(node);
      const isSelected = selectedNode()?.id === node.id;
      const isHovered = hoverNode()?.id === node.id;

      // Glow 
      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + (isSelected ? 8 : 4), 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.2;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      // Main Circle Background
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = '#0a1020'; 
      ctx.fill();
      
      // Filled tint
      ctx.fillStyle = color;
      ctx.globalAlpha = node.type === 'node' ? 0.2 : 0.4;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Stroke
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : (node.type === 'node' ? 2 : 1.5);
      ctx.stroke();

      // Inner Highlight Ring
      if (node.type === 'node') {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r - 4, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      
      // Icon or Center Dot
      if (node.type === 'pod') {
         ctx.beginPath();
         ctx.arc(node.x, node.y, 2, 0, 2 * Math.PI);
         ctx.fillStyle = color;
         ctx.fill();
      }
    });

    // Draw Labels (Separate loop to be on top)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    graphNodes.forEach(node => {
        if (node.x === undefined || node.y === undefined) return;
        const shouldDrawLabel = node.type === 'node' || node.type === 'service' || 
                                selectedNode()?.id === node.id || hoverNode()?.id === node.id;
        
        if (shouldDrawLabel && transform.k > 0.4) {
            const r = getNodeRadius(node);
            ctx.font = node.type === 'node' ? '500 11px Inter, system-ui' : '400 9px Inter, system-ui';
            ctx.fillStyle = '#cccccc';
            ctx.fillText(
                node.label.length > 14 && !hoverNode() ? node.label.slice(0, 12)+'...' : node.label, 
                node.x, 
                node.y + r + 12
            );
        }
    });

    ctx.restore();

    // Continue animation only if simulation is active or particles exist
    // This prevents infinite 60fps loop when nothing is changing
    const shouldContinue = isSimulationActive || particles.length > 0;
    if (shouldContinue) {
      rafId = requestAnimationFrame(draw);
    } else {
      isAnimating = false;
      // Do one final render after stopping
      rafId = null;
    }
  };

  // Click & Hover detection
  const getKeyUnderMouse = (event: MouseEvent): D3Node | null => {
      if (!canvasRef) return null;
      const rect = canvasRef.getBoundingClientRect();
      const x = (event.clientX - rect.left - transform.x) / transform.k;
      const y = (event.clientY - rect.top - transform.y) / transform.k;
      
      let minDist = Infinity;
      let found: D3Node | null = null;
      
      for (let i = graphNodes.length - 1; i >= 0; i--) {
          const n = graphNodes[i];
          if (!n.x || !n.y) continue;
          const dx = x - n.x;
          const dy = y - n.y;
          const dist = Math.sqrt(dx*dx + dy*dy);
          const r = getNodeRadius(n);
          // 4px padding for easier selection
          if (dist < (r + 4) && dist < minDist) {
              minDist = dist;
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
  };

  const handleMouseMove = (event: MouseEvent) => {
      const node = getKeyUnderMouse(event);
      if (node !== hoverNode()) {
          setHoverNode(node);
          if (canvasRef) canvasRef.style.cursor = node ? 'pointer' : 'default';
      }
  };

  const initializeSimulation = () => {
    if (!canvasRef) return;
    buildGraph();

    if (simulation) simulation.stop();

    const { width, height } = dimensions();

    // Adaptive forces based on node count
    const nodeCount = graphNodes.length || 1;
    const linkDistance = Math.max(60, Math.min(120, 2000 / Math.sqrt(nodeCount)));
    const chargeStrength = Math.max(-500, Math.min(-150, -3000 / Math.sqrt(nodeCount)));

    // Mark simulation as active
    isSimulationActive = true;
    startAnimationLoop();

    simulation = d3.forceSimulation<D3Node>(graphNodes)
      .force('link', d3.forceLink<D3Node, D3Link>(graphLinks)
        .id(d => d.id)
        .distance(linkDistance)
        .strength(0.3))
      .force('charge', d3.forceManyBody().strength(chargeStrength))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d) => getNodeRadius(d as D3Node) + 15))
      .force('x', d3.forceX(width / 2).strength(0.04))
      .force('y', d3.forceY(height / 2).strength(0.04))
      .on('end', () => {
        // Simulation has settled - stop continuous rendering
        isSimulationActive = false;
      });
    
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

  createEffect(() => {
    props.nodes; props.pods; props.services;
    const key = getDataKey();
    if (key !== lastDataKey) {
        lastDataKey = key;
        initializeSimulation();
    }
  });

  return (
    <div ref={containerRef} class="relative h-full w-full overflow-hidden bg-[#050a14]">
        <canvas 
            ref={canvasRef}
            width={dimensions().width}
            height={dimensions().height}
            class="block touch-none"
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
