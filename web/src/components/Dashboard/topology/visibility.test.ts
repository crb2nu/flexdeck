import { describe, expect, it } from 'vitest';
import { createTopologyViewportCache, refreshVisibleTopology } from './visibility';
import type { TopologyLink, TopologyNode } from './types';
import type { K8sPod } from '../../../lib/types';

const makeNode = (id: string, x: number, y: number, type: TopologyNode['type'] = 'pod'): TopologyNode => ({
  id,
  type,
  label: id,
  namespace: 'apps',
  status: 'ok',
  data: {
    metadata: { name: id, namespace: 'apps' },
    spec: { containers: [] },
    status: { phase: 'Running' },
  } satisfies K8sPod,
  x,
  y,
});

const makeLink = (sourceIdx: number, targetIdx: number, type: TopologyLink['type']): TopologyLink => ({
  source: `node-${sourceIdx}`,
  target: `node-${targetIdx}`,
  sourceIdx,
  targetIdx,
  type,
});

describe('topology visibility', () => {
  it('filters visible nodes and keeps links with at least one visible endpoint', () => {
    const state = {
      nodeFlags: new Uint8Array(3),
      nodeIndices: [],
      hostsLinkIndices: [],
      selectsLinkIndices: [],
    };

    const result = refreshVisibleTopology({
      nodes: [
        makeNode('node-0', 20, 20),
        makeNode('node-1', 780, 580),
        makeNode('node-2', 1200, 900),
      ],
      hostsLinks: [makeLink(0, 1, 'hosts'), makeLink(1, 2, 'hosts')],
      selectsLinks: [makeLink(2, 2, 'selects')],
      transform: { x: 0, y: 0, k: 1 },
      width: 800,
      height: 600,
      densityOverviewBlend: 0,
      viewportCacheDirty: true,
      cache: createTopologyViewportCache(),
      state,
      shouldRenderNode: () => true,
    });

    expect(result).toEqual({
      refreshed: true,
      nodeCount: 2,
      hostsLinkCount: 2,
      selectsLinkCount: 0,
    });
    expect(state.nodeIndices).toEqual([0, 1]);
    expect([...state.nodeFlags]).toEqual([1, 1, 0]);
    expect(state.hostsLinkIndices).toEqual([0, 1]);
    expect(state.selectsLinkIndices).toEqual([]);
  });

  it('uses density visibility callback before accepting in-frustum nodes', () => {
    const service = makeNode('service-0', 100, 100, 'service');
    const pod = makeNode('pod-0', 120, 120, 'pod');
    const state = {
      nodeFlags: new Uint8Array(2),
      nodeIndices: [],
      hostsLinkIndices: [],
      selectsLinkIndices: [],
    };

    const result = refreshVisibleTopology({
      nodes: [service, pod],
      hostsLinks: [],
      selectsLinks: [makeLink(0, 1, 'selects')],
      transform: { x: 0, y: 0, k: 1 },
      width: 800,
      height: 600,
      densityOverviewBlend: 1,
      viewportCacheDirty: true,
      cache: createTopologyViewportCache(),
      state,
      shouldRenderNode: (node) => node.type !== 'pod',
    });

    expect(result.nodeCount).toBe(1);
    expect(state.nodeIndices).toEqual([0]);
    expect(state.selectsLinkIndices).toEqual([0]);
  });

  it('skips work when the viewport cache is clean unless forced', () => {
    const state = {
      nodeFlags: new Uint8Array(1),
      nodeIndices: [0],
      hostsLinkIndices: [0],
      selectsLinkIndices: [],
    };
    const cache = createTopologyViewportCache();

    const skipped = refreshVisibleTopology({
      nodes: [makeNode('node-0', 1000, 1000)],
      hostsLinks: [makeLink(0, 0, 'hosts')],
      selectsLinks: [],
      transform: { x: 0, y: 0, k: 1 },
      width: 800,
      height: 600,
      densityOverviewBlend: 0,
      viewportCacheDirty: false,
      cache,
      state,
      shouldRenderNode: () => true,
    });

    expect(skipped.refreshed).toBe(false);
    expect(state.nodeIndices).toEqual([0]);

    const forced = refreshVisibleTopology({
      nodes: [makeNode('node-0', 1000, 1000)],
      hostsLinks: [makeLink(0, 0, 'hosts')],
      selectsLinks: [],
      transform: { x: 0, y: 0, k: 1 },
      width: 800,
      height: 600,
      densityOverviewBlend: 0,
      viewportCacheDirty: false,
      force: true,
      cache,
      state,
      shouldRenderNode: () => true,
    });

    expect(forced.refreshed).toBe(true);
    expect(forced.nodeCount).toBe(0);
    expect(state.nodeIndices).toEqual([]);
  });
});
