import type { K8sNode, K8sPod, K8sService } from '../../../lib/types';
import type { ClusterHealthData } from './config';

export interface HoloDeckFilter {
  namespace?: string;
  status?: string[];
  nodeName?: string;
  searchTerm?: string;
}

export const podMatchesFilter = (pod: K8sPod, filter?: HoloDeckFilter): boolean => {
  if (!filter) return true;
  if (filter.namespace && pod.metadata.namespace !== filter.namespace) return false;
  if (filter.status && filter.status.length > 0 && !filter.status.includes(pod.status.phase)) return false;
  if (filter.nodeName && pod.spec.nodeName !== filter.nodeName) return false;
  if (filter.searchTerm) {
    const term = filter.searchTerm.toLowerCase();
    const nameMatch = pod.metadata.name.toLowerCase().includes(term);
    const nsMatch = pod.metadata.namespace?.toLowerCase().includes(term);
    if (!nameMatch && !nsMatch) return false;
  }
  return true;
};

export const nodeMatchesFilter = (node: K8sNode, pods: K8sPod[], filter?: HoloDeckFilter): boolean => {
  if (!filter) return true;
  if (filter.nodeName && node.metadata.name !== filter.nodeName) return false;

  if (filter.namespace) {
    const hasMatchingPod = pods.some(p =>
      p.spec.nodeName === node.metadata.name && p.metadata.namespace === filter.namespace
    );
    if (!hasMatchingPod) return false;
  }

  if (filter.searchTerm) {
    const term = filter.searchTerm.toLowerCase();
    const nameMatch = node.metadata.name.toLowerCase().includes(term);
    const hasPodMatch = pods.some(p =>
      p.spec.nodeName === node.metadata.name &&
      (p.metadata.name.toLowerCase().includes(term) || p.metadata.namespace?.toLowerCase().includes(term))
    );
    if (!nameMatch && !hasPodMatch) return false;
  }

  return true;
};

export const serviceMatchesFilter = (service: K8sService, filter?: HoloDeckFilter): boolean => {
  if (!filter) return true;
  if (filter.namespace && service.metadata.namespace !== filter.namespace) return false;
  if (filter.nodeName) return false;
  if (filter.status && filter.status.length > 0) return false;

  if (filter.searchTerm) {
    const term = filter.searchTerm.toLowerCase();
    const nameMatch = service.metadata.name.toLowerCase().includes(term);
    const nsMatch = service.metadata.namespace?.toLowerCase().includes(term);
    if (!nameMatch && !nsMatch) return false;
  }

  return true;
};

export const computeClusterHealth = (nodes: K8sNode[], pods: K8sPod[]): ClusterHealthData => {
  const nodesTotal = nodes.length;
  const nodesReady = nodes.filter(n =>
    n.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True')
  ).length;

  const podsTotal = pods.length;
  const podsRunning = pods.filter(p => p.status?.phase === 'Running').length;

  const nodeHealth = nodesTotal > 0 ? nodesReady / nodesTotal : 1;
  const podHealth = podsTotal > 0 ? podsRunning / podsTotal : 1;
  const healthPercent = (nodeHealth * 0.4 + podHealth * 0.6);

  return {
    apiServerHealthy: nodesTotal > 0,
    controlPlaneHealthy: nodesReady > 0,
    healthPercent,
    nodesReady,
    nodesTotal,
    podsRunning,
    podsTotal
  };
};
