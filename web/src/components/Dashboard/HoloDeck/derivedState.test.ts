import { describe, expect, it } from 'vitest';

import type { K8sNode, K8sPod, K8sService } from '../../../lib/types';
import { computeClusterHealth, nodeMatchesFilter, podMatchesFilter, serviceMatchesFilter } from './derivedState';

const buildNode = (name: string, ready: boolean): K8sNode => ({
  metadata: { name },
  status: {
    conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }]
  }
});

const buildPod = (name: string, namespace: string, nodeName: string, phase: K8sPod['status']['phase']): K8sPod => ({
  metadata: { name, namespace },
  spec: {
    nodeName,
    containers: [{ name: 'c', image: 'img' }]
  },
  status: { phase }
});

const buildService = (name: string, namespace: string): K8sService => ({
  metadata: { name, namespace },
  spec: {
    type: 'ClusterIP',
    selector: { app: name }
  }
});

describe('HoloDeck derived state helpers', () => {
  it('filters pods by namespace, status, node, and search term', () => {
    const pod = buildPod('api-server', 'kube-system', 'node-a', 'Running');
    expect(podMatchesFilter(pod, { namespace: 'kube-system' })).toBe(true);
    expect(podMatchesFilter(pod, { namespace: 'default' })).toBe(false);
    expect(podMatchesFilter(pod, { status: ['Pending'] })).toBe(false);
    expect(podMatchesFilter(pod, { nodeName: 'node-a' })).toBe(true);
    expect(podMatchesFilter(pod, { searchTerm: 'api' })).toBe(true);
  });

  it('matches nodes via attached pods for namespace and search filters', () => {
    const node = buildNode('worker-a', true);
    const pods = [
      buildPod('frontend-1', 'default', 'worker-a', 'Running'),
      buildPod('payments-1', 'payments', 'worker-b', 'Running')
    ];

    expect(nodeMatchesFilter(node, pods, { namespace: 'default' })).toBe(true);
    expect(nodeMatchesFilter(node, pods, { namespace: 'payments' })).toBe(false);
    expect(nodeMatchesFilter(node, pods, { searchTerm: 'frontend' })).toBe(true);
    expect(nodeMatchesFilter(node, pods, { nodeName: 'worker-b' })).toBe(false);
  });

  it('filters services by namespace and search while hiding them for pod-only filters', () => {
    const service = buildService('payments-api', 'payments');
    expect(serviceMatchesFilter(service, { namespace: 'payments' })).toBe(true);
    expect(serviceMatchesFilter(service, { namespace: 'default' })).toBe(false);
    expect(serviceMatchesFilter(service, { searchTerm: 'payments' })).toBe(true);
    expect(serviceMatchesFilter(service, { nodeName: 'worker-a' })).toBe(false);
    expect(serviceMatchesFilter(service, { status: ['Running'] })).toBe(false);
  });

  it('computes weighted cluster health from node and pod readiness', () => {
    const nodes = [buildNode('n1', true), buildNode('n2', false)];
    const pods = [
      buildPod('p1', 'default', 'n1', 'Running'),
      buildPod('p2', 'default', 'n1', 'Pending'),
      buildPod('p3', 'default', 'n2', 'Running')
    ];

    const health = computeClusterHealth(nodes, pods);
    expect(health.nodesReady).toBe(1);
    expect(health.podsRunning).toBe(2);
    expect(health.healthPercent).toBeCloseTo((0.5 * 0.4) + ((2 / 3) * 0.6), 5);
  });
});
