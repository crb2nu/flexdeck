import { getNamespaceColor } from './layoutEngine';
import type { TopologyNode } from './types';

export interface TopologyNodeStyle {
  r: number;
  color: string;
  truncLabel: string;
}

export const TOPOLOGY_NODE_LABEL_MAX = 14;
export const TOPOLOGY_NODE_LABEL_SLICE = 12;

export function getTopologyNodeColor(node: TopologyNode, namespaceMap: Map<string, number>): string {
  if (node.type === 'node') {
    return node.status === 'ok' ? '#00c8ff' : '#ff3d71';
  }
  if (node.namespace) {
    return getNamespaceColor(node.namespace, namespaceMap);
  }
  const statusColors = { ok: '#22e076', warn: '#ff6b35', error: '#ff3d71' };
  return statusColors[node.status];
}

export function getTopologyNodeRadius(node: TopologyNode): number {
  switch (node.type) {
    case 'node':
      return 28;
    case 'service':
      return 18;
    case 'pod':
      return 8;
    default:
      return 8;
  }
}

export function getTopologyNodeIcon(node: TopologyNode): string {
  switch (node.type) {
    case 'node':
      return '⬡';
    case 'service':
      return '◆';
    case 'pod':
      return '●';
    default:
      return '●';
  }
}

export function truncateTopologyNodeLabel(label: string): string {
  return label.length > TOPOLOGY_NODE_LABEL_MAX
    ? `${label.slice(0, TOPOLOGY_NODE_LABEL_SLICE)}...`
    : label;
}

export function refreshTopologyNodeStyles(
  nodes: readonly TopologyNode[],
  cache: Map<string, TopologyNodeStyle>,
  namespaceMap: Map<string, number>,
): void {
  const staleIds = new Set(cache.keys());
  for (const node of nodes) {
    staleIds.delete(node.id);
    const r = getTopologyNodeRadius(node);
    const color = getTopologyNodeColor(node, namespaceMap);
    const existing = cache.get(node.id);
    if (existing && existing.r === r && existing.color === color) continue;
    cache.set(node.id, {
      r,
      color,
      truncLabel: truncateTopologyNodeLabel(node.label),
    });
  }
  for (const id of staleIds) cache.delete(id);
}
