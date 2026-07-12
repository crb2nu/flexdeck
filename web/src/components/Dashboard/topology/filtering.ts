import type { K8sNode, K8sPod, K8sService } from '../../../lib/types';
import {
  nodeMatchesFilter,
  podMatchesFilter,
  serviceMatchesFilter,
  type HoloDeckFilter,
} from '../HoloDeck/derivedState';
import type { TopologyNode } from './types';

export const hasActiveTopologyFilter = (filter?: HoloDeckFilter): boolean =>
  Boolean(
    filter &&
      (filter.namespace ||
        (filter.status?.length ?? 0) > 0 ||
        filter.nodeName ||
        filter.searchTerm),
  );

/**
 * Ids of graph nodes matching the dashboard topology filter, reusing the same
 * matchers the 3D HoloDeck applies so both views agree on what "matches" means.
 * Returns null when no filter is active (draw everything at full opacity).
 */
export function computeTopologyFilterMatches(
  graphNodes: readonly TopologyNode[],
  pods: K8sPod[],
  filter?: HoloDeckFilter,
): Set<string> | null {
  if (!hasActiveTopologyFilter(filter)) return null;
  const matches = new Set<string>();
  for (const node of graphNodes) {
    const matched =
      node.type === 'node'
        ? nodeMatchesFilter(node.data as K8sNode, pods, filter)
        : node.type === 'service'
          ? serviceMatchesFilter(node.data as K8sService, filter)
          : podMatchesFilter(node.data as K8sPod, filter);
    if (matched) matches.add(node.id);
  }
  return matches;
}
