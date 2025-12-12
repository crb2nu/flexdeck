import { Component, createSignal, createEffect, onMount, onCleanup, Show } from 'solid-js';
import * as d3 from 'd3';
import type { TopologyNode, TopologyLink, K8sNode, K8sPod, K8sService } from '../../lib/types';

interface Props {
  nodes: K8sNode[];
  pods: K8sPod[];
  services: K8sService[];
  onNodeClick?: (node: TopologyNode) => void;
}

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  type: 'node' | 'pod' | 'service';
  label: string;
  status: 'ok' | 'warn' | 'error';
  data: K8sNode | K8sPod | K8sService;
}

interface D3Link extends d3.SimulationLinkDatum<D3Node> {
  type: 'hosts' | 'selects';
}

const TopologyGraph: Component<Props> = (props) => {
  let svgRef: SVGSVGElement | undefined;
  let containerRef: HTMLDivElement | undefined;
  let simulation: d3.Simulation<D3Node, D3Link> | null = null;

  const [selectedNode, setSelectedNode] = createSignal<D3Node | null>(null);
  const [dimensions, setDimensions] = createSignal({ width: 800, height: 600 });

  // Build graph data from K8s resources
  const buildGraph = (): { nodes: D3Node[]; links: D3Link[] } => {
    const graphNodes: D3Node[] = [];
    const graphLinks: D3Link[] = [];
    const nodeMap = new Map<string, D3Node>();

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

      const d3Node: D3Node = {
        id: `pod-${pod.metadata.namespace}-${pod.metadata.name}`,
        type: 'pod',
        label: pod.metadata.name,
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
      const d3Node: D3Node = {
        id: `svc-${svc.metadata.namespace}-${svc.metadata.name}`,
        type: 'service',
        label: svc.metadata.name,
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

    return { nodes: graphNodes, links: graphLinks };
  };

  const getNodeColor = (node: D3Node): string => {
    const statusColors = {
      ok: '#22c55e',
      warn: '#f97316',
      error: '#ef4444',
    };
    return statusColors[node.status];
  };

  const getNodeRadius = (node: D3Node): number => {
    switch (node.type) {
      case 'node': return 24;
      case 'service': return 16;
      case 'pod': return 10;
      default: return 10;
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
    const { nodes, links } = buildGraph();

    // Clear previous
    d3.select(svgRef).selectAll('*').remove();

    if (nodes.length === 0) return;

    const svg = d3.select(svgRef);

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Create main group for zoom/pan
    const g = svg.append('g');

    // Create arrow marker for links
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10,0 L 0,5')
      .attr('fill', '#444');

    // Create simulation
    simulation = d3.forceSimulation<D3Node>(nodes)
      .force('link', d3.forceLink<D3Node, D3Link>(links)
        .id((d) => d.id)
        .distance(80)
        .strength(0.5))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d) => getNodeRadius(d as D3Node) + 10));

    // Create links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', (d) => d.type === 'hosts' ? '#00d9ff33' : '#a855f733')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', (d) => d.type === 'selects' ? '4,4' : 'none');

    // Create node groups
    const nodeGroup = g.append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, D3Node>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer');

    // Add drag behavior with proper typing
    nodeGroup.call(d3.drag<SVGGElement, D3Node>()
      .on('start', dragStarted)
      .on('drag', dragged)
      .on('end', dragEnded) as any);

    // Add circles to nodes
    nodeGroup.append('circle')
      .attr('r', (d) => getNodeRadius(d))
      .attr('fill', (d) => `${getNodeColor(d)}22`)
      .attr('stroke', (d) => getNodeColor(d))
      .attr('stroke-width', 2);

    // Add labels
    nodeGroup.append('text')
      .text((d) => d.label.length > 12 ? d.label.slice(0, 12) + '…' : d.label)
      .attr('dy', (d) => getNodeRadius(d) + 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10px')
      .attr('fill', '#888');

    // Click handler
    nodeGroup.on('click', (event, d) => {
      event.stopPropagation();
      setSelectedNode(d);
      props.onNodeClick?.(d);
    });

    // Clear selection on background click
    svg.on('click', () => setSelectedNode(null));

    // Simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as D3Node).x!)
        .attr('y1', (d) => (d.source as D3Node).y!)
        .attr('x2', (d) => (d.target as D3Node).x!)
        .attr('y2', (d) => (d.target as D3Node).y!);

      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

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
    <div ref={containerRef} class="relative h-full w-full">
      <svg
        ref={svgRef}
        width={dimensions().width}
        height={dimensions().height}
        class="bg-surface/50"
      />

      {/* Legend */}
      <div class="absolute bottom-4 left-4 rounded-md bg-surface/80 p-3 text-xs backdrop-blur">
        <div class="mb-2 font-medium text-text-muted">Legend</div>
        <div class="flex flex-col gap-1.5">
          <div class="flex items-center gap-2">
            <span class="text-lg text-neon-cyan">⬡</span>
            <span class="text-text-dim">Node</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-lg text-neon-purple">◆</span>
            <span class="text-text-dim">Service</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-lg text-status-ok">●</span>
            <span class="text-text-dim">Pod</span>
          </div>
        </div>
      </div>

      {/* Selected node info */}
      <Show when={selectedNode()}>
        {(node) => (
          <div class="absolute right-4 top-4 max-w-xs rounded-md bg-surface/90 p-4 backdrop-blur">
            <div class="mb-2 flex items-center gap-2">
              <span class={`text-lg ${
                node().type === 'node' ? 'text-neon-cyan' :
                node().type === 'service' ? 'text-neon-purple' :
                'text-status-ok'
              }`}>
                {getNodeIcon(node())}
              </span>
              <span class="font-medium text-text-main">{node().label}</span>
            </div>
            <div class="space-y-1 text-xs">
              <div class="flex justify-between">
                <span class="text-text-dim">Type</span>
                <span class="capitalize text-text-muted">{node().type}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-text-dim">Status</span>
                <span class={`capitalize ${
                  node().status === 'ok' ? 'text-status-ok' :
                  node().status === 'warn' ? 'text-status-warn' :
                  'text-status-error'
                }`}>
                  {node().status}
                </span>
              </div>
              <Show when={node().type === 'pod'}>
                <div class="flex justify-between">
                  <span class="text-text-dim">Namespace</span>
                  <span class="text-text-muted">
                    {(node().data as K8sPod).metadata.namespace}
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
