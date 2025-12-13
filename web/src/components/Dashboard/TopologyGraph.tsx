import { Component, createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import * as d3 from 'd3';
import type { K8sNode, K8sPod, K8sService } from '../../lib/types';

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
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  type: 'hosts' | 'selects';
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
  let svgRef: SVGSVGElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let simulation: d3.Simulation<D3Node, D3Link> | null = null;

  const [selectedNode, setSelectedNode] = createSignal<D3Node | null>(null);
  const [dimensions, setDimensions] = createSignal({ width: 800, height: 600 });
  const [nodeCount, setNodeCount] = createSignal(0);

  // Build graph data from K8s resources
  const buildGraph = (): { nodes: D3Node[]; links: D3Link[]; namespaceMap: Map<string, number> } => {
    const graphNodes: D3Node[] = [];
    const graphLinks: D3Link[] = [];
    const nodeMap = new Map<string, D3Node>();
    const namespaceMap = new Map<string, number>();

    // Add K8s nodes
    for (const node of props.nodes) {
      const isReady = node.status.conditions.some(
        (c) => c.type === 'Ready' && c.status === 'True'
      );
      const d3Node: D3Node = {
        id: `node-${node.metadata.name}`,
        type: 'node',
        label: node.metadata.name,
        status: isReady ? 'ok' : 'error',
        data: node,
      };
      graphNodes.push(d3Node);
      nodeMap.set(d3Node.id, d3Node);
    }

    // Add pods
    for (const pod of props.pods) {
      const status: 'ok' | 'warn' | 'error' =
        pod.status.phase === 'Running' ? 'ok' :
        pod.status.phase === 'Pending' ? 'warn' : 'error';

      const ns = pod.metadata.namespace || 'default';
      getNamespaceColor(ns, namespaceMap); // Register namespace

      const d3Node: D3Node = {
        id: `pod-${pod.metadata.namespace}-${pod.metadata.name}`,
        type: 'pod',
        label: pod.metadata.name,
        namespace: ns,
        status,
        data: pod,
      };
      graphNodes.push(d3Node);
      nodeMap.set(d3Node.id, d3Node);

      // Link pod to its node
      if (pod.spec.nodeName) {
        const nodeId = `node-${pod.spec.nodeName}`;
        if (nodeMap.has(nodeId)) {
          graphLinks.push({
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
      getNamespaceColor(ns, namespaceMap);

      const d3Node: D3Node = {
        id: `svc-${svc.metadata.namespace}-${svc.metadata.name}`,
        type: 'service',
        label: svc.metadata.name,
        namespace: ns,
        status: 'ok',
        data: svc,
      };
      graphNodes.push(d3Node);
      nodeMap.set(d3Node.id, d3Node);

      // Link service to matching pods
      if (svc.spec.selector) {
        for (const pod of props.pods) {
          if (pod.metadata.namespace === svc.metadata.namespace) {
            const matches = Object.entries(svc.spec.selector).every(
              ([k, v]) => pod.metadata.labels?.[k] === v
            );
            if (matches) {
              graphLinks.push({
                source: d3Node.id,
                target: `pod-${pod.metadata.namespace}-${pod.metadata.name}`,
                type: 'selects',
              });
            }
          }
        }
      }
    }

    return { nodes: graphNodes, links: graphLinks, namespaceMap };
  };

  const getNodeColor = (node: D3Node, namespaceMap: Map<string, number>): string => {
    if (node.type === 'node') {
      return node.status === 'ok' ? '#00d9ff' : '#ef4444';
    }
    // For pods and services, use namespace color
    if (node.namespace) {
      return getNamespaceColor(node.namespace, namespaceMap);
    }
    const statusColors = {
      ok: '#22c55e',
      warn: '#f97316',
      error: '#ef4444',
    };
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

  const initializeSimulation = () => {
    if (!svgRef) return;

    const { width, height } = dimensions();
    const { nodes, links, namespaceMap } = buildGraph();

    // Clear previous
    d3.select(svgRef).selectAll('*').remove();

    if (nodes.length === 0) return;

    setNodeCount(nodes.length);

    const svg = d3.select(svgRef);

    // Calculate initial zoom based on node count
    const baseZoom = Math.max(0.3, Math.min(0.8, 50 / nodes.length));

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Create defs for gradients and filters
    const defs = svg.append('defs');

    // Add glow filter
    const glowFilter = defs.append('filter')
      .attr('id', 'glow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');

    glowFilter.append('feGaussianBlur')
      .attr('stdDeviation', '3')
      .attr('result', 'coloredBlur');

    const glowMerge = glowFilter.append('feMerge');
    glowMerge.append('feMergeNode').attr('in', 'coloredBlur');
    glowMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Add stronger glow for selected nodes
    const selectedGlow = defs.append('filter')
      .attr('id', 'selected-glow')
      .attr('x', '-100%')
      .attr('y', '-100%')
      .attr('width', '300%')
      .attr('height', '300%');

    selectedGlow.append('feGaussianBlur')
      .attr('stdDeviation', '6')
      .attr('result', 'coloredBlur');

    const selectedMerge = selectedGlow.append('feMerge');
    selectedMerge.append('feMergeNode').attr('in', 'coloredBlur');
    selectedMerge.append('feMergeNode').attr('in', 'coloredBlur');
    selectedMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Grid pattern
    const gridPattern = defs.append('pattern')
      .attr('id', 'grid')
      .attr('width', 40)
      .attr('height', 40)
      .attr('patternUnits', 'userSpaceOnUse');

    gridPattern.append('path')
      .attr('d', 'M 40 0 L 0 0 0 40')
      .attr('fill', 'none')
      .attr('stroke', 'rgba(255,255,255,0.03)')
      .attr('stroke-width', 1);

    // Create main group for zoom/pan
    const g = svg.append('g');

    // Add grid background
    g.append('rect')
      .attr('width', width * 4)
      .attr('height', height * 4)
      .attr('x', -width * 1.5)
      .attr('y', -height * 1.5)
      .attr('fill', 'url(#grid)');

    // Calculate adaptive force parameters
    const linkDistance = Math.max(60, Math.min(120, 2000 / Math.sqrt(nodes.length)));
    const chargeStrength = Math.max(-500, Math.min(-150, -3000 / Math.sqrt(nodes.length)));

    // Create simulation with better spread
    simulation = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(links)
        .id((d) => d.id)
        .distance(linkDistance)
        .strength(0.3))
      .force('charge', d3.forceManyBody().strength(chargeStrength))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d) => getNodeRadius(d as D3Node) + 15))
      .force('x', d3.forceX(width / 2).strength(0.03))
      .force('y', d3.forceY(height / 2).strength(0.03));

    // Create link gradients
    links.forEach((link, i) => {
      const gradient = defs.append('linearGradient')
        .attr('id', `link-gradient-${i}`)
        .attr('gradientUnits', 'userSpaceOnUse');

      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', link.type === 'hosts' ? '#00d9ff' : '#a855f7')
        .attr('stop-opacity', 0.6);

      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', link.type === 'hosts' ? '#00d9ff' : '#a855f7')
        .attr('stop-opacity', 0.1);
    });

    // Create links with animation
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', (_, i) => `url(#link-gradient-${i})`)
      .attr('stroke-width', (d) => d.type === 'hosts' ? 1.5 : 1)
      .attr('stroke-dasharray', (d) => d.type === 'selects' ? '6,4' : 'none')
      .style('animation', (d) => d.type === 'selects' ? 'flow 1s linear infinite' : 'none');

    // Create node groups
    const nodeGroup = g.append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, D3Node>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .style('filter', 'url(#glow)');

    // Add drag behavior
    nodeGroup.call(d3.drag<SVGGElement, D3Node>()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded) as any);

    // Add outer glow ring for nodes
    nodeGroup.filter((d) => d.type === 'node')
      .append('circle')
      .attr('r', (d) => getNodeRadius(d) + 6)
      .attr('fill', 'none')
      .attr('stroke', (d) => getNodeColor(d, namespaceMap))
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.3)
      .style('animation', 'pulse-ring 2s ease-in-out infinite');

    // Add main circles with gradient fill
    nodeGroup.append('circle')
      .attr('r', (d) => getNodeRadius(d))
      .attr('fill', (d) => {
        const color = getNodeColor(d, namespaceMap);
        return d.type === 'node' ? `${color}33` : `${color}44`;
      })
      .attr('stroke', (d) => getNodeColor(d, namespaceMap))
      .attr('stroke-width', (d) => d.type === 'node' ? 2.5 : 1.5);

    // Add inner highlight for depth
    nodeGroup.filter((d) => d.type === 'node')
      .append('circle')
      .attr('r', (d) => getNodeRadius(d) - 4)
      .attr('fill', 'none')
      .attr('stroke', 'rgba(255,255,255,0.15)')
      .attr('stroke-width', 1);

    // Add pulsing effect for running pods
    nodeGroup.filter((d) => d.type === 'pod' && d.status === 'ok')
      .append('circle')
      .attr('class', 'pulse-circle')
      .attr('r', (d) => getNodeRadius(d))
      .attr('fill', 'none')
      .attr('stroke', (d) => getNodeColor(d, namespaceMap))
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.5)
      .style('animation', 'pulse-expand 2s ease-out infinite');

    // Add labels with background
    const labelGroup = nodeGroup.append('g')
      .attr('class', 'label-group')
      .attr('transform', (d) => `translate(0, ${getNodeRadius(d) + 12})`);

    labelGroup.append('text')
      .text((d) => d.label.length > 14 ? d.label.slice(0, 14) + '…' : d.label)
      .attr('text-anchor', 'middle')
      .attr('font-size', (d) => d.type === 'node' ? '11px' : '9px')
      .attr('font-weight', (d) => d.type === 'node' ? '500' : '400')
      .attr('fill', '#999')
      .attr('dy', '0.3em');

    // Click handler
    nodeGroup.on('click', (event, d) => {
      event.stopPropagation();
      setSelectedNode(d);

      // Highlight selected node
      nodeGroup.style('filter', (n) => n.id === d.id ? 'url(#selected-glow)' : 'url(#glow)');
      nodeGroup.select('circle').attr('stroke-width', (n) => n.id === d.id ? 3 : (n.type === 'node' ? 2.5 : 1.5));

      props.onNodeClick?.(d);
    });

    // Clear selection on background click
    svg.on('click', () => {
      setSelectedNode(null);
      nodeGroup.style('filter', 'url(#glow)');
      nodeGroup.select('circle').attr('stroke-width', (d) => d.type === 'node' ? 2.5 : 1.5);
    });

    // Simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as D3Node).x!)
        .attr('y1', (d) => (d.source as D3Node).y!)
        .attr('x2', (d) => (d.target as D3Node).x!)
        .attr('y2', (d) => (d.target as D3Node).y!);

      // Update gradients for links
      links.forEach((l, i) => {
        const source = l.source as D3Node;
        const target = l.target as D3Node;
        d3.select(`#link-gradient-${i}`)
          .attr('x1', source.x!)
          .attr('y1', source.y!)
          .attr('x2', target.x!)
          .attr('y2', target.y!);
      });

      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    // Apply initial zoom to fit content
    setTimeout(() => {
      svg.transition()
        .duration(750)
        .call(zoom.transform, d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(baseZoom)
          .translate(-width / 2, -height / 2));
    }, 100);

    function dragStarted(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      if (!event.active) simulation?.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragEnded(event: d3.D3DragEvent<SVGGElement, D3Node, D3Node>, d: D3Node) {
      if (!event.active) simulation?.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
  };

  // Handle resize
  const handleResize = () => {
    if (containerRef) {
      const rect = containerRef.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    }
  };

  onMount(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
  });

  onCleanup(() => {
    window.removeEventListener('resize', handleResize);
    simulation?.stop();
  });

  // Re-initialize when data changes
  createEffect(() => {
    // Track dependencies
    props.nodes;
    props.pods;
    props.services;
    dimensions();

    // Delay to ensure DOM is ready
    setTimeout(initializeSimulation, 0);
  });

  return (
    <div ref={containerRef} class="relative h-full w-full overflow-hidden">
      {/* CSS for animations */}
      <style>{`
        @keyframes pulse-expand {
          0% { r: ${8}; opacity: 0.6; }
          100% { r: ${20}; opacity: 0; }
        }
        @keyframes pulse-ring {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.6; }
        }
        @keyframes flow {
          from { stroke-dashoffset: 10; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      <svg
        ref={svgRef}
        width={dimensions().width}
        height={dimensions().height}
        class="bg-gradient-to-br from-[#050a14] via-[#0a1020] to-[#0d1528]"
      />

      {/* Stats overlay */}
      <div class="absolute left-4 top-4 flex items-center gap-3 rounded-md bg-surface/60 px-3 py-1.5 text-xs backdrop-blur">
        <span class="text-text-dim">Nodes:</span>
        <span class="font-mono text-neon-cyan">{nodeCount()}</span>
      </div>

      {/* Legend */}
      <div class="absolute bottom-4 left-4 rounded-lg bg-surface/70 p-3 text-xs backdrop-blur-md border border-white/5">
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
            <div class="flex items-center gap-2">
              <div class="h-px w-4 bg-gradient-to-r from-neon-cyan to-transparent" />
              <span class="text-text-dim">Hosts</span>
            </div>
            <div class="flex items-center gap-2 mt-1">
              <div class="h-px w-4 border-t border-dashed border-neon-purple" />
              <span class="text-text-dim">Selects</span>
            </div>
          </div>
        </div>
      </div>

      {/* Selected node info */}
      <Show when={selectedNode()}>
        {(node) => (
          <div class="absolute right-4 top-4 max-w-xs rounded-lg bg-surface/80 p-4 backdrop-blur-md border border-white/10 shadow-xl">
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
              <Show when={node().type === 'pod'}>
                <div class="flex justify-between rounded bg-white/5 px-2 py-1">
                  <span class="text-text-dim">Phase</span>
                  <span class="text-text-muted">
                    {(node().data as K8sPod).status.phase}
                  </span>
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
