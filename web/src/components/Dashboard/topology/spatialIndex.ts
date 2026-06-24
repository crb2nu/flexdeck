import type { TopologyNode } from './types';

export const DEFAULT_SPATIAL_GRID_CELL_SIZE = 50;
export const DEFAULT_SPATIAL_GRID_KEY_MULTIPLIER = 100000;

const CELL_KEY_NONE = -1;

export interface SpatialIndexOptions {
  cellSize?: number;
  keyMultiplier?: number;
}

export interface SpatialRebuildInput {
  nodes: readonly TopologyNode[];
  visibleNodeIndices?: readonly number[];
  visibleNodeCount?: number;
  now?: number;
}

export interface SpatialSearchInput {
  nodes: readonly TopologyNode[];
  x: number;
  y: number;
  getRadius: (node: TopologyNode) => number;
  hitPadding?: number;
}

export interface SpatialIndexSnapshot {
  valid: boolean;
  dirty: boolean;
  lastBuildAt: number;
  cellCount: number;
  activeCellCount: number;
  nodeCellKeyCount: number;
}

export interface TopologySpatialIndex {
  canIncrementalUpdate(nodeCount: number): boolean;
  findNearest(input: SpatialSearchInput): TopologyNode | null;
  getLastBuildAt(): number;
  invalidate(): void;
  isDirty(): boolean;
  isValid(): boolean;
  markDirty(): void;
  rebuild(input: SpatialRebuildInput): void;
  snapshot(): SpatialIndexSnapshot;
  updateIncremental(input: SpatialRebuildInput): void;
}

export const createSpatialKey = (
  x: number,
  y: number,
  cellSize = DEFAULT_SPATIAL_GRID_CELL_SIZE,
  keyMultiplier = DEFAULT_SPATIAL_GRID_KEY_MULTIPLIER,
): number => {
  const cellX = Math.floor(x / cellSize);
  const cellY = Math.floor(y / cellSize);
  return cellX * keyMultiplier + cellY;
};

export const createTopologySpatialIndex = (
  options: SpatialIndexOptions = {},
): TopologySpatialIndex => {
  const cellSize = options.cellSize ?? DEFAULT_SPATIAL_GRID_CELL_SIZE;
  const keyMultiplier = options.keyMultiplier ?? DEFAULT_SPATIAL_GRID_KEY_MULTIPLIER;
  const grid = new Map<number, number[]>();
  const activeKeys: number[] = [];
  let nodeCellKeys = new Int32Array(0);
  let valid = false;
  let dirty = false;
  let lastBuildAt = -Infinity;

  const getKey = (x: number, y: number): number =>
    createSpatialKey(x, y, cellSize, keyMultiplier);

  const clearActiveBuckets = () => {
    for (let i = 0; i < activeKeys.length; i++) {
      const bucket = grid.get(activeKeys[i]);
      if (bucket) bucket.length = 0;
    }
    activeKeys.length = 0;
  };

  const ensureNodeCellKeySize = (nodeCount: number) => {
    if (nodeCellKeys.length === nodeCount) return;
    nodeCellKeys = new Int32Array(nodeCount);
    nodeCellKeys.fill(CELL_KEY_NONE);
  };

  const addNodeToCell = (nodeIndex: number, key: number) => {
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    if (bucket.length === 0) activeKeys.push(key);
    bucket.push(nodeIndex);
    nodeCellKeys[nodeIndex] = key;
  };

  const rebuild = (input: SpatialRebuildInput) => {
    clearActiveBuckets();
    ensureNodeCellKeySize(input.nodes.length);

    const visibleNodeCount = input.visibleNodeCount ?? 0;
    const visibleNodeIndices = input.visibleNodeIndices;
    const useVisibleNodes =
      visibleNodeIndices !== undefined &&
      visibleNodeCount > 0 &&
      visibleNodeCount < input.nodes.length;

    if (useVisibleNodes) {
      for (let i = 0; i < visibleNodeCount; i++) {
        const nodeIndex = visibleNodeIndices[i];
        const node = input.nodes[nodeIndex];
        if (!node || node.x === undefined || node.y === undefined) continue;
        addNodeToCell(nodeIndex, getKey(node.x, node.y));
      }
    } else {
      for (let nodeIndex = 0; nodeIndex < input.nodes.length; nodeIndex++) {
        const node = input.nodes[nodeIndex];
        if (node.x === undefined || node.y === undefined) continue;
        addNodeToCell(nodeIndex, getKey(node.x, node.y));
      }
    }

    valid = true;
    dirty = false;
    lastBuildAt = input.now ?? performance.now();
  };

  const updateIncremental = (input: SpatialRebuildInput) => {
    if (!valid || nodeCellKeys.length !== input.nodes.length) {
      rebuild(input);
      return;
    }

    let movedCount = 0;
    for (let nodeIndex = 0; nodeIndex < input.nodes.length; nodeIndex++) {
      const node = input.nodes[nodeIndex];
      if (node.x === undefined || node.y === undefined) continue;
      const newKey = getKey(node.x, node.y);
      const oldKey = nodeCellKeys[nodeIndex];
      if (newKey === oldKey) continue;

      movedCount++;
      if (oldKey !== CELL_KEY_NONE) {
        const oldBucket = grid.get(oldKey);
        if (oldBucket) {
          const bucketIndex = oldBucket.indexOf(nodeIndex);
          if (bucketIndex !== -1) {
            oldBucket[bucketIndex] = oldBucket[oldBucket.length - 1];
            oldBucket.pop();
          }
        }
      }

      let newBucket = grid.get(newKey);
      if (!newBucket) {
        newBucket = [];
        grid.set(newKey, newBucket);
        activeKeys.push(newKey);
      }
      if (newBucket.length === 0 && !activeKeys.includes(newKey)) {
        activeKeys.push(newKey);
      }
      newBucket.push(nodeIndex);
      nodeCellKeys[nodeIndex] = newKey;
    }

    if (movedCount > input.nodes.length * 0.3) {
      rebuild(input);
      return;
    }

    dirty = false;
    lastBuildAt = input.now ?? performance.now();
  };

  const findNearest = (input: SpatialSearchInput): TopologyNode | null => {
    const hitPadding = input.hitPadding ?? 0;
    let minDistSq = Infinity;
    let found: TopologyNode | null = null;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = getKey(input.x + dx * cellSize, input.y + dy * cellSize);
        const cellNodeIndices = grid.get(key);
        if (!cellNodeIndices) continue;

        for (let i = 0; i < cellNodeIndices.length; i++) {
          const node = input.nodes[cellNodeIndices[i]];
          if (!node || node.x === undefined || node.y === undefined) continue;
          const deltaX = input.x - node.x;
          const deltaY = input.y - node.y;
          const distSq = deltaX * deltaX + deltaY * deltaY;
          const radius = input.getRadius(node) + hitPadding;
          const radiusSq = radius * radius;
          if (distSq < radiusSq && distSq < minDistSq) {
            minDistSq = distSq;
            found = node;
          }
        }
      }
    }

    return found;
  };

  return {
    canIncrementalUpdate: (nodeCount: number) => valid && nodeCellKeys.length === nodeCount,
    findNearest,
    getLastBuildAt: () => lastBuildAt,
    invalidate: () => {
      valid = false;
      dirty = true;
    },
    isDirty: () => dirty,
    isValid: () => valid,
    markDirty: () => {
      dirty = true;
    },
    rebuild,
    snapshot: () => ({
      valid,
      dirty,
      lastBuildAt,
      cellCount: grid.size,
      activeCellCount: activeKeys.length,
      nodeCellKeyCount: nodeCellKeys.length,
    }),
    updateIncremental,
  };
};
