import type { TopologyLink, TopologyNode } from './types';

export interface TopologyViewportTransform {
  x: number;
  y: number;
  k: number;
}

export interface TopologyViewportFrustum {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface TopologyViewportCache {
  frustum: TopologyViewportFrustum;
  transform: TopologyViewportTransform;
  dimensions: {
    width: number;
    height: number;
  };
}

export interface VisibleTopologyState {
  nodeFlags: Uint8Array;
  nodeIndices: number[];
  hostsLinkIndices: number[];
  selectsLinkIndices: number[];
}

export interface RefreshVisibleTopologyInput {
  nodes: TopologyNode[];
  hostsLinks: TopologyLink[];
  selectsLinks: TopologyLink[];
  transform: TopologyViewportTransform;
  width: number;
  height: number;
  densityOverviewBlend: number;
  viewportCacheDirty: boolean;
  force?: boolean;
  cache: TopologyViewportCache;
  state: VisibleTopologyState;
  shouldRenderNode: (node: TopologyNode, densityOverviewBlend: number) => boolean;
}

export interface VisibleTopologyResult {
  refreshed: boolean;
  nodeCount: number;
  hostsLinkCount: number;
  selectsLinkCount: number;
}

export const createTopologyViewportCache = (): TopologyViewportCache => ({
  frustum: { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  transform: { x: -Infinity, y: -Infinity, k: -Infinity },
  dimensions: { width: -1, height: -1 },
});

export const refreshVisibleTopology = ({
  nodes,
  hostsLinks,
  selectsLinks,
  transform,
  width,
  height,
  densityOverviewBlend,
  viewportCacheDirty,
  force = false,
  cache,
  state,
  shouldRenderNode,
}: RefreshVisibleTopologyInput): VisibleTopologyResult => {
  if (!force && !viewportCacheDirty) {
    return {
      refreshed: false,
      nodeCount: state.nodeIndices.length,
      hostsLinkCount: state.hostsLinkIndices.length,
      selectsLinkCount: state.selectsLinkIndices.length,
    };
  }

  if (
    transform.x !== cache.transform.x ||
    transform.y !== cache.transform.y ||
    transform.k !== cache.transform.k ||
    width !== cache.dimensions.width ||
    height !== cache.dimensions.height ||
    force
  ) {
    const margin = 50 / transform.k;
    cache.frustum.minX = -transform.x / transform.k - margin;
    cache.frustum.maxX = (width - transform.x) / transform.k + margin;
    cache.frustum.minY = -transform.y / transform.k - margin;
    cache.frustum.maxY = (height - transform.y) / transform.k + margin;
    cache.transform.x = transform.x;
    cache.transform.y = transform.y;
    cache.transform.k = transform.k;
    cache.dimensions.width = width;
    cache.dimensions.height = height;
  }

  const { minX, maxX, minY, maxY } = cache.frustum;
  let nodeCount = 0;

  for (let index = 0, length = nodes.length; index < length; index++) {
    const node = nodes[index];
    const isVisible =
      node.x !== undefined &&
      node.y !== undefined &&
      shouldRenderNode(node, densityOverviewBlend) &&
      node.x >= minX &&
      node.x <= maxX &&
      node.y >= minY &&
      node.y <= maxY;
    state.nodeFlags[index] = isVisible ? 1 : 0;
    if (isVisible) state.nodeIndices[nodeCount++] = index;
  }
  state.nodeIndices.length = nodeCount;

  let hostsLinkCount = 0;
  for (let index = 0, length = hostsLinks.length; index < length; index++) {
    const link = hostsLinks[index];
    if (link.sourceIdx !== undefined && link.targetIdx !== undefined) {
      if (state.nodeFlags[link.sourceIdx] === 0 && state.nodeFlags[link.targetIdx] === 0) continue;
    }
    state.hostsLinkIndices[hostsLinkCount++] = index;
  }
  state.hostsLinkIndices.length = hostsLinkCount;

  let selectsLinkCount = 0;
  for (let index = 0, length = selectsLinks.length; index < length; index++) {
    const link = selectsLinks[index];
    if (link.sourceIdx !== undefined && link.targetIdx !== undefined) {
      if (state.nodeFlags[link.sourceIdx] === 0 && state.nodeFlags[link.targetIdx] === 0) continue;
    }
    state.selectsLinkIndices[selectsLinkCount++] = index;
  }
  state.selectsLinkIndices.length = selectsLinkCount;

  return {
    refreshed: true,
    nodeCount,
    hostsLinkCount,
    selectsLinkCount,
  };
};
