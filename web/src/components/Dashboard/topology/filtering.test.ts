import { describe, expect, it } from 'vitest';
import type { K8sNode, K8sPod, K8sService } from '../../../lib/types';
import { computeTopologyFilterMatches, hasActiveTopologyFilter } from './filtering';
import type { TopologyNode } from './types';

const buildNode = (name: string): K8sNode => ({
  metadata: { name },
  status: { conditions: [{ type: 'Ready', status: 'True' }] },
});

const buildPod = (name: string, namespace: string, nodeName: string, phase = 'Running'): K8sPod => ({
  metadata: { name, namespace },
  spec: { nodeName, containers: [] },
  status: { phase: phase as K8sPod['status']['phase'] },
});

const buildService = (name: string, namespace: string): K8sService => ({
  metadata: { name, namespace },
  spec: { type: 'ClusterIP', selector: { app: name } },
});

const graphNode = (id: string, type: TopologyNode['type'], data: TopologyNode['data'], namespace?: string): TopologyNode => ({
  id,
  type,
  label: id,
  namespace,
  status: 'ok',
  data,
});

describe('hasActiveTopologyFilter', () => {
  it('is false for undefined or empty filters', () => {
    expect(hasActiveTopologyFilter(undefined)).toBe(false);
    expect(hasActiveTopologyFilter({})).toBe(false);
    expect(hasActiveTopologyFilter({ status: [] })).toBe(false);
  });

  it('is true when any dimension is set', () => {
    expect(hasActiveTopologyFilter({ namespace: 'apps' })).toBe(true);
    expect(hasActiveTopologyFilter({ status: ['Running'] })).toBe(true);
    expect(hasActiveTopologyFilter({ nodeName: 'node-a' })).toBe(true);
    expect(hasActiveTopologyFilter({ searchTerm: 'api' })).toBe(true);
  });
});

describe('computeTopologyFilterMatches', () => {
  const k8sNode = buildNode('node-a');
  const podApps = buildPod('api-1', 'apps', 'node-a');
  const podInfra = buildPod('cache-1', 'infra', 'node-b', 'Pending');
  const svcApps = buildService('api', 'apps');
  const pods = [podApps, podInfra];

  const nodes: TopologyNode[] = [
    graphNode('node-node-a', 'node', k8sNode),
    graphNode('pod-apps-api-1', 'pod', podApps, 'apps'),
    graphNode('pod-infra-cache-1', 'pod', podInfra, 'infra'),
    graphNode('service-apps-api', 'service', svcApps, 'apps'),
  ];

  it('returns null when no filter is active so callers skip dimming entirely', () => {
    expect(computeTopologyFilterMatches(nodes, pods, undefined)).toBeNull();
    expect(computeTopologyFilterMatches(nodes, pods, {})).toBeNull();
  });

  it('matches namespaces across pods, services, and hosting nodes', () => {
    const matches = computeTopologyFilterMatches(nodes, pods, { namespace: 'apps' });
    expect(matches).not.toBeNull();
    expect([...matches!].sort()).toEqual(['node-node-a', 'pod-apps-api-1', 'service-apps-api']);
  });

  it('matches pod status filters and excludes services', () => {
    const matches = computeTopologyFilterMatches(nodes, pods, { status: ['Pending'] });
    expect(matches!.has('pod-infra-cache-1')).toBe(true);
    expect(matches!.has('pod-apps-api-1')).toBe(false);
    expect(matches!.has('service-apps-api')).toBe(false);
  });

  it('matches search terms against names', () => {
    const matches = computeTopologyFilterMatches(nodes, pods, { searchTerm: 'cache' });
    expect(matches!.has('pod-infra-cache-1')).toBe(true);
    expect(matches!.has('service-apps-api')).toBe(false);
  });
});
