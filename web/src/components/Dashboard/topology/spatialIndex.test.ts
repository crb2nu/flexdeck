import { describe, expect, it } from 'vitest';
import {
  createSpatialKey,
  createTopologySpatialIndex,
  DEFAULT_SPATIAL_GRID_CELL_SIZE,
} from './spatialIndex';
import type { TopologyNode } from './types';
import type { K8sPod } from '../../../lib/types';

const makeNode = (id: string, x: number, y: number): TopologyNode => ({
  id,
  type: 'pod',
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

const findNearest = (
  index: ReturnType<typeof createTopologySpatialIndex>,
  nodes: readonly TopologyNode[],
  x: number,
  y: number,
): TopologyNode | null =>
  index.findNearest({
    nodes,
    x,
    y,
    hitPadding: 4,
    getRadius: () => 8,
  });

describe('topology spatial index', () => {
  it('uses numeric keys for stable cell lookup', () => {
    expect(createSpatialKey(0, 0)).toBe(0);
    expect(createSpatialKey(49, 49)).toBe(0);
    expect(createSpatialKey(50, 0)).toBe(100000);
    expect(createSpatialKey(-1, -1)).toBe(-100001);
    expect(DEFAULT_SPATIAL_GRID_CELL_SIZE).toBe(50);
  });

  it('rebuilds from the visible node subset when a smaller visible set is supplied', () => {
    const nodes = [
      makeNode('visible-a', 0, 0),
      makeNode('hidden', 500, 0),
      makeNode('visible-b', 10, 0),
    ];
    const index = createTopologySpatialIndex();

    index.rebuild({
      nodes,
      visibleNodeIndices: [0, 2, 1],
      visibleNodeCount: 2,
      now: 42,
    });

    expect(index.snapshot()).toMatchObject({
      valid: true,
      dirty: false,
      lastBuildAt: 42,
      activeCellCount: 1,
      nodeCellKeyCount: 3,
    });
    expect(findNearest(index, nodes, 10, 0)?.id).toBe('visible-b');
    expect(findNearest(index, nodes, 500, 0)).toBeNull();
  });

  it('updates moved nodes incrementally after a rebuild', () => {
    const nodes = [makeNode('moved', 0, 0), makeNode('steady', 100, 0)];
    const index = createTopologySpatialIndex();

    index.rebuild({ nodes, now: 10 });
    nodes[0].x = 120;
    index.updateIncremental({ nodes, now: 20 });

    expect(index.snapshot()).toMatchObject({
      valid: true,
      dirty: false,
      lastBuildAt: 20,
    });
    expect(findNearest(index, nodes, 0, 0)).toBeNull();
    expect(findNearest(index, nodes, 120, 0)?.id).toBe('moved');
  });

  it('falls back to a full rebuild when incremental state is not valid', () => {
    const nodes = [makeNode('fresh', 25, 25)];
    const index = createTopologySpatialIndex();

    index.markDirty();
    expect(index.isDirty()).toBe(true);
    index.updateIncremental({ nodes, now: 30 });

    expect(index.canIncrementalUpdate(nodes.length)).toBe(true);
    expect(index.snapshot()).toMatchObject({
      valid: true,
      dirty: false,
      lastBuildAt: 30,
    });
    expect(findNearest(index, nodes, 25, 25)?.id).toBe('fresh');
  });

  it('returns the closest hit from adjacent cells', () => {
    const nodes = [
      makeNode('far', 48, 0),
      makeNode('near', 51, 0),
    ];
    const index = createTopologySpatialIndex();

    index.rebuild({ nodes, now: 5 });

    expect(findNearest(index, nodes, 50, 0)?.id).toBe('near');
    expect(findNearest(index, nodes, 90, 0)).toBeNull();
  });
});
