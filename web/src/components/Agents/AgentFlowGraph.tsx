import { Component, createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import * as d3 from 'd3';
import type { AgentNode, AgentEdge, AgentType, AgentStatus } from '../../lib/types';

interface Props {
  nodes: AgentNode[];
  edges: AgentEdge[];
  onAgentClick?: (agent: AgentNode) => void;
}

interface D3AgentNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  tags: string[];
  metadata?: Record<string, any>;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface D3AgentLink extends d3.SimulationLinkDatum<D3AgentNode> {
  source: string | D3AgentNode;
  target: string | D3AgentNode;
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  healthy: '#22c55e',
  unhealthy: '#ef4444',
  unknown: '#6b7280',
};

const TYPE_ICONS: Record<string, string> = {
  langgraph: 'LG',
  custom: 'C',
  'cli-agent': 'CLI',
};

const AgentFlowGraph: Component<Props> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let svgRef: SVGSVGElement | undefined;
  let simulation: d3.Simulation<D3AgentNode, D3AgentLink> | null = null;

  const [dimensions, setDimensions] = createSignal({ width: 800, height: 600 });
  const [hoverNode, setHoverNode] = createSignal<D3AgentNode | null>(null);
  const [tooltipPos, setTooltipPos] = createSignal({ x: 0, y: 0 });

  const getNodeRadius = (node: D3AgentNode): number => {
    const isBuiltIn = node.id === 'agent-builder' || node.tags?.includes('built-in');
    return isBuiltIn ? 32 : 26;
  };

  const getStatusColor = (status: AgentStatus): string => STATUS_COLORS[status] || '#6b7280';

  const initGraph = () => {
    if (!svgRef || props.nodes.length === 0) return;

    // Clean up previous simulation
    if (simulation) {
      simulation.stop();
      simulation = null;
    }

    const { width, height } = dimensions();

    // Build d3 nodes
    const nodes: D3AgentNode[] = props.nodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
      status: n.status,
      tags: n.tags || [],
      metadata: n.metadata,
    }));

    // Build d3 links (only for edges where both source and target exist)
    const nodeIds = new Set(nodes.map(n => n.id));
    const links: D3AgentLink[] = props.edges
      .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map(e => ({ source: e.source, target: e.target }));

    const svg = d3.select(svgRef);
    svg.selectAll('*').remove();

    // Defs for arrow markers and animated dash
    const defs = svg.append('defs');

    // Arrow marker for healthy links
    defs.append('marker')
      .attr('id', 'arrow-healthy')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 35)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#22c55e')
      .attr('opacity', 0.6);

    // Arrow marker for unhealthy/unknown links
    defs.append('marker')
      .attr('id', 'arrow-dim')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 35)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#6b7280')
      .attr('opacity', 0.4);

    // Glow filter
    const filter = defs.append('filter')
      .attr('id', 'glow')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%');
    filter.append('feGaussianBlur')
      .attr('stdDeviation', '3')
      .attr('result', 'blur');
    const feMerge = filter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'blur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Root group for zoom/pan
    const g = svg.append('g');

    // Links
    const linkGroup = g.append('g').attr('class', 'links');
    const linkElements = linkGroup.selectAll<SVGPathElement, D3AgentLink>('path')
      .data(links)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', d => {
        const sourceNode = nodes.find(n => n.id === (typeof d.source === 'string' ? d.source : d.source.id));
        return sourceNode?.status === 'healthy' ? 'rgba(0, 217, 255, 0.4)' : 'rgba(107, 114, 128, 0.3)';
      })
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', d => {
        const sourceNode = nodes.find(n => n.id === (typeof d.source === 'string' ? d.source : d.source.id));
        return sourceNode?.status === 'healthy' ? '8 4' : '4 4';
      })
      .attr('marker-end', d => {
        const sourceNode = nodes.find(n => n.id === (typeof d.source === 'string' ? d.source : d.source.id));
        return sourceNode?.status === 'healthy' ? 'url(#arrow-healthy)' : 'url(#arrow-dim)';
      });

    // Animate dashes for healthy links
    linkElements.filter(d => {
      const sourceNode = nodes.find(n => n.id === (typeof d.source === 'string' ? d.source : d.source.id));
      return sourceNode?.status === 'healthy';
    })
    .attr('stroke-dashoffset', 0)
    .each(function () {
      const el = this as SVGPathElement;
      const animate = () => {
        d3.select(el)
          .attr('stroke-dashoffset', 0)
          .transition()
          .duration(1500)
          .ease(d3.easeLinear)
          .attr('stroke-dashoffset', -24)
          .on('end', animate);
      };
      animate();
    });

    // Node groups
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const nodeElements = nodeGroup.selectAll<SVGGElement, D3AgentNode>('g')
      .data(nodes, d => d.id)
      .join('g')
      .attr('cursor', 'pointer')
      .call(d3.drag<SVGGElement, D3AgentNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation?.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation?.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    // Outer glow circle
    nodeElements.append('circle')
      .attr('r', d => getNodeRadius(d) + 6)
      .attr('fill', d => getStatusColor(d.status))
      .attr('opacity', 0.08)
      .attr('filter', 'url(#glow)');

    // Main circle background
    nodeElements.append('circle')
      .attr('r', d => getNodeRadius(d))
      .attr('fill', '#0a1020')
      .attr('stroke', d => d.type === 'cli-agent' ? '#a855f7' : getStatusColor(d.status))
      .attr('stroke-width', d => {
        const isBuiltIn = d.id === 'agent-builder' || d.tags?.includes('built-in');
        return isBuiltIn ? 2.5 : 1.5;
      })
      .attr('stroke-dasharray', d => d.type === 'cli-agent' ? '6 3' : 'none');

    // Inner tint
    nodeElements.append('circle')
      .attr('r', d => getNodeRadius(d))
      .attr('fill', d => getStatusColor(d.status))
      .attr('opacity', 0.15);

    // Type label inside node
    nodeElements.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', d => getStatusColor(d.status))
      .attr('font-size', '10px')
      .attr('font-weight', '600')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .text(d => {
        if (d.id === 'agent-builder' || d.tags?.includes('built-in')) return 'BI';
        return TYPE_ICONS[d.type] || 'A';
      });

    // Name label below node
    nodeElements.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', d => getNodeRadius(d) + 14)
      .attr('fill', '#94a3b8')
      .attr('font-size', '10px')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .text(d => d.name.length > 16 ? d.name.slice(0, 14) + '...' : d.name);

    // Click handler
    nodeElements.on('click', (_event, d) => {
      props.onAgentClick?.(d);
    });

    // Hover handlers
    nodeElements
      .on('mouseenter', (event, d) => {
        setHoverNode(d);
        const rect = svgRef!.getBoundingClientRect();
        setTooltipPos({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - 10,
        });
        // Highlight node
        d3.select(event.currentTarget as SVGGElement)
          .select('circle:nth-child(2)')
          .transition().duration(150)
          .attr('stroke-width', 3);
      })
      .on('mouseleave', (event) => {
        setHoverNode(null);
        d3.select(event.currentTarget as SVGGElement)
          .select('circle:nth-child(2)')
          .transition().duration(150)
          .attr('stroke-width', (d: any) => {
            const isBuiltIn = d.id === 'agent-builder' || d.tags?.includes('built-in');
            return isBuiltIn ? 2.5 : 1.5;
          });
      });

    // Force simulation
    simulation = d3.forceSimulation<D3AgentNode>(nodes)
      .alpha(0.5)
      .alphaDecay(0.02)
      .velocityDecay(0.4)
      .force('link', d3.forceLink<D3AgentNode, D3AgentLink>(links)
        .id(d => d.id)
        .distance(120)
        .strength(0.4))
      .force('charge', d3.forceManyBody().strength(-300).distanceMax(300))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.1))
      .force('collision', d3.forceCollide<D3AgentNode>().radius(d => getNodeRadius(d) + 16).strength(0.7))
      .on('tick', () => {
        // Update link paths (curved)
        linkElements.attr('d', d => {
          const s = d.source as D3AgentNode;
          const t = d.target as D3AgentNode;
          if (s.x === undefined || t.x === undefined) return '';
          const dx = t.x! - s.x!;
          const dy = t.y! - s.y!;
          const dr = Math.sqrt(dx * dx + dy * dy) * 0.8;
          return `M${s.x},${s.y}A${dr},${dr} 0 0,1 ${t.x},${t.y}`;
        });

        // Update node positions
        nodeElements.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });

    // Warmup ticks
    simulation.stop();
    for (let i = 0; i < 60; i++) simulation.tick();
    simulation.alpha(0.3).restart();

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString());
      });

    svg.call(zoom);
    svg.on('dblclick.zoom', null);
  };

  const handleResize = () => {
    if (!containerRef) return;
    const rect = containerRef.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setDimensions({ width: rect.width, height: rect.height });
    }
  };

  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    handleResize();
    resizeObserver = new ResizeObserver(handleResize);
    if (containerRef) resizeObserver.observe(containerRef);
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    simulation?.stop();
  });

  // Re-init when data or dimensions change
  createEffect(() => {
    // Track dependencies
    props.nodes;
    props.edges;
    dimensions();
    initGraph();
  });

  return (
    <div ref={containerRef} class="relative h-full w-full overflow-hidden bg-[#050a14] rounded-lg border border-white/5">
      <svg
        ref={svgRef}
        width={dimensions().width}
        height={dimensions().height}
        class="block"
      />

      {/* Stats overlay */}
      <div class="absolute left-4 top-4 flex items-center gap-3 rounded-md bg-[#0a1020]/90 px-3 py-1.5 text-xs pointer-events-none border border-white/5">
        <span class="text-text-dim">Agents:</span>
        <span class="font-mono text-neon-cyan">{props.nodes.length}</span>
        <span class="text-text-dim ml-2">Edges:</span>
        <span class="font-mono text-neon-purple">{props.edges.length}</span>
      </div>

      {/* Legend */}
      <div class="absolute bottom-4 left-4 rounded-lg bg-[#0a1020]/90 p-3 text-xs border border-white/5 pointer-events-none">
        <div class="mb-2 font-medium text-text-muted uppercase tracking-wider text-[10px]">Legend</div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2">
            <div class="h-3 w-3 rounded-full border-2 border-status-ok bg-status-ok/20" />
            <span class="text-text-dim">Healthy</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="h-3 w-3 rounded-full border-2 border-status-error bg-status-error/20" />
            <span class="text-text-dim">Unhealthy</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="h-3 w-3 rounded-full border-2 border-text-dim/50 bg-text-dim/10" />
            <span class="text-text-dim">Unknown</span>
          </div>
          <div class="flex items-center gap-2">
            <div class="h-3 w-3 rounded-full border-2 border-dashed border-purple-400 bg-purple-400/10" />
            <span class="text-text-dim">CLI Agent</span>
          </div>
          <div class="mt-1 border-t border-white/5 pt-2">
            <span class="text-[10px] text-text-dim">Click node to chat</span>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      <Show when={hoverNode()}>
        {(node) => (
          <div
            class="absolute z-50 rounded-lg bg-[#0a1020]/95 p-3 text-xs border border-white/10 shadow-xl pointer-events-none"
            style={{
              left: `${Math.min(tooltipPos().x, dimensions().width - 200)}px`,
              top: `${Math.max(tooltipPos().y - 80, 8)}px`,
              'max-width': '220px',
            }}
          >
            <div class="mb-1 font-medium text-text-main">{node().name}</div>
            <div class="space-y-1">
              <div class="flex justify-between gap-4">
                <span class="text-text-dim">Type</span>
                <span class="text-text-muted capitalize">{node().type}</span>
              </div>
              <div class="flex justify-between gap-4">
                <span class="text-text-dim">Status</span>
                <span class={`capitalize font-medium ${
                  node().status === 'healthy' ? 'text-status-ok' :
                  node().status === 'unhealthy' ? 'text-status-error' :
                  'text-text-dim'
                }`}>
                  {node().status}
                </span>
              </div>
              <Show when={node().metadata?.description}>
                <div class="mt-1 border-t border-white/5 pt-1 text-text-dim">
                  {(node().metadata?.description as string)?.slice(0, 80)}
                </div>
              </Show>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

export default AgentFlowGraph;
