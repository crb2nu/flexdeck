import { describe, expect, it } from 'vitest';

import {
  getTopologyNodeColor,
  getTopologyNodeIcon,
  getTopologyNodeRadius,
  refreshTopologyNodeStyles,
  truncateTopologyNodeLabel,
} from './nodeVisuals';
import type { TopologyNode } from './types';
import type { K8sPod } from '../../../lib/types';

const makeNode = (overrides: Partial<TopologyNode> = {}): TopologyNode => ({
  id: 'pod-1',
  type: 'pod',
  label: 'pod-1',
  namespace: 'apps',
  status: 'ok',
  data: {
    metadata: { name: 'pod-1', namespace: 'apps' },
    spec: { containers: [] },
    status: { phase: 'Running' },
  } satisfies K8sPod,
  ...overrides,
});

describe('topology node visuals', () => {
  it('maps node types to stable radii and legend icons', () => {
    expect(getTopologyNodeRadius(makeNode({ type: 'node' }))).toBe(28);
    expect(getTopologyNodeRadius(makeNode({ type: 'service' }))).toBe(18);
    expect(getTopologyNodeRadius(makeNode({ type: 'pod' }))).toBe(8);

    expect(getTopologyNodeIcon(makeNode({ type: 'node' }))).toBe('⬡');
    expect(getTopologyNodeIcon(makeNode({ type: 'service' }))).toBe('◆');
    expect(getTopologyNodeIcon(makeNode({ type: 'pod' }))).toBe('●');
  });

  it('uses readiness colors for cluster nodes and namespace colors for namespaced nodes', () => {
    const namespaceMap = new Map([['apps', 0]]);

    expect(getTopologyNodeColor(makeNode({ type: 'node', status: 'ok', namespace: undefined }), namespaceMap)).toBe('#00c8ff');
    expect(getTopologyNodeColor(makeNode({ type: 'node', status: 'error', namespace: undefined }), namespaceMap)).toBe('#ff3d71');
    expect(getTopologyNodeColor(makeNode({ type: 'pod', namespace: 'apps' }), namespaceMap)).toBe('#00c8ff');
  });

  it('falls back to status colors when no namespace is available', () => {
    const namespaceMap = new Map<string, number>();

    expect(getTopologyNodeColor(makeNode({ namespace: undefined, status: 'ok' }), namespaceMap)).toBe('#22e076');
    expect(getTopologyNodeColor(makeNode({ namespace: undefined, status: 'warn' }), namespaceMap)).toBe('#ff6b35');
    expect(getTopologyNodeColor(makeNode({ namespace: undefined, status: 'error' }), namespaceMap)).toBe('#ff3d71');
  });

  it('truncates long labels using the existing topology label budget', () => {
    expect(truncateTopologyNodeLabel('short-label')).toBe('short-label');
    expect(truncateTopologyNodeLabel('abcdefghijklmnop')).toBe('abcdefghijkl...');
  });

  it('refreshes node styles incrementally and removes stale cache entries', () => {
    const cache = new Map([
      ['stale', { r: 8, color: '#fff', truncLabel: 'stale' }],
      ['pod-1', { r: 8, color: '#00c8ff', truncLabel: 'pod-1' }],
    ]);

    refreshTopologyNodeStyles(
      [
        makeNode({ id: 'pod-1', label: 'pod-1' }),
        makeNode({ id: 'svc-1', type: 'service', label: 'very-long-service-name' }),
      ],
      cache,
      new Map([['apps', 0]]),
    );

    expect(cache.has('stale')).toBe(false);
    expect(cache.get('pod-1')).toEqual({ r: 8, color: '#00c8ff', truncLabel: 'pod-1' });
    expect(cache.get('svc-1')).toEqual({ r: 18, color: '#00c8ff', truncLabel: 'very-long-se...' });
  });
});
