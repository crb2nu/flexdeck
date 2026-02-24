import { describe, expect, it } from 'vitest';
import type { K8sNode, K8sPod, K8sService } from '../../../lib/types';
import { buildTopologyGraphData, getTopologyLayoutTuning } from './layoutEngine';
import type { TopologyNode } from './types';

const makeNode = (name: string, ready = true): K8sNode => ({
  metadata: { name },
  status: {
    conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }]
  }
});

const makePod = (name: string, namespace: string, labels: Record<string, string>, nodeName = 'node-a'): K8sPod => ({
  metadata: { name, namespace, labels },
  spec: {
    nodeName,
    containers: []
  },
  status: { phase: 'Running' }
});

const makeService = (name: string, namespace: string, selector: Record<string, string>): K8sService => ({
  metadata: { name, namespace },
  spec: {
    type: 'ClusterIP',
    selector
  }
});

describe('layoutEngine', () => {
  it('preserves previous node physics coordinates', () => {
    const previousNodes: TopologyNode[] = [{
      id: 'pod-ns-a',
      type: 'pod',
      label: 'a',
      namespace: 'ns',
      status: 'ok',
      data: makePod('a', 'ns', { app: 'api' }),
      x: 41,
      y: 87,
      vx: 0.4,
      vy: -0.2
    }];

    const result = buildTopologyGraphData({
      nodes: [makeNode('node-a')],
      pods: [makePod('a', 'ns', { app: 'api' })],
      services: [],
      prevNodes: previousNodes
    });

    const podNode = result.nodes.find((node) => node.id === 'pod-ns-a');
    expect(podNode).toBeDefined();
    expect(podNode?.x).toBe(41);
    expect(podNode?.y).toBe(87);
    expect(podNode?.vx).toBe(0.4);
    expect(podNode?.vy).toBe(-0.2);
  });

  it('links services only to selector-matching pods', () => {
    const pods = [
      makePod('api-0', 'apps', { app: 'api', tier: 'prod' }),
      makePod('api-1', 'apps', { app: 'api', tier: 'canary' }),
      makePod('worker-0', 'apps', { app: 'worker', tier: 'prod' }),
    ];

    const result = buildTopologyGraphData({
      nodes: [makeNode('node-a')],
      pods,
      services: [makeService('api-svc', 'apps', { app: 'api', tier: 'prod' })],
      prevNodes: []
    });

    expect(result.selectsLinks).toHaveLength(1);
    expect(result.selectsLinks[0].target).toBe('pod-apps-api-0');
  });

  it('uses denser layout tuning for very large graphs', () => {
    const veryLarge = getTopologyLayoutTuning(1500);
    expect(veryLarge.warmupTicks).toBe(48);
    expect(veryLarge.alphaDecay).toBe(0.05);
    expect(veryLarge.collisionEnabled).toBe(false);

    const small = getTopologyLayoutTuning(120);
    expect(small.collisionEnabled).toBe(true);
    expect(small.alphaDecay).toBe(0.03);
  });
});
