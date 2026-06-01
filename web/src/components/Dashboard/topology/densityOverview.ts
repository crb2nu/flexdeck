// Pure density-overview math extracted from TopologyGraph.tsx.
//
// At high node/pod counts and low zoom the topology view fades individual
// pods/services into a namespace-level overview. These helpers compute that
// blend factor and its derived state without touching the canvas, signals, or
// any component closure state.

export const DENSITY_OVERVIEW_NODE_THRESHOLD = 600;
export const DENSITY_OVERVIEW_POD_THRESHOLD = 300;
export const DENSITY_OVERVIEW_ZOOM_THRESHOLD = 1.25;
export const DENSITY_OVERVIEW_TRANSITION_BAND = 0.22;
export const DENSITY_OVERVIEW_NEAR_FULL_BLEND = 0.98;
// Overview is considered "active" (worth surfacing hidden counts) past this blend.
export const DENSITY_OVERVIEW_ACTIVE_BLEND = 0.18;

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export interface DensityOverviewInput {
  zoomLevel: number;
  nodeCount: number;
  podCount: number;
}

/**
 * Overview blend in [0,1]: 0 = full detail, 1 = namespace overview.
 *
 * Only large graphs (by node or pod count) fade at all; below the thresholds
 * the blend is always 0. Above them it ramps from 0 to 1 as the zoom level
 * drops through the transition band around DENSITY_OVERVIEW_ZOOM_THRESHOLD.
 */
export function computeDensityOverviewBlend({ zoomLevel, nodeCount, podCount }: DensityOverviewInput): number {
  const largeGraph =
    nodeCount >= DENSITY_OVERVIEW_NODE_THRESHOLD ||
    podCount >= DENSITY_OVERVIEW_POD_THRESHOLD;
  if (!largeGraph) return 0;
  const transitionStart = DENSITY_OVERVIEW_ZOOM_THRESHOLD - DENSITY_OVERVIEW_TRANSITION_BAND;
  const transitionEnd = DENSITY_OVERVIEW_ZOOM_THRESHOLD + DENSITY_OVERVIEW_TRANSITION_BAND;
  return 1 - smoothstep(transitionStart, transitionEnd, zoomLevel);
}

/**
 * Cluster ("node"-type) nodes always render; pods/services drop out only once
 * the blend is near full overview.
 */
export function shouldRenderNodeForDensity(nodeType: string, blend: number): boolean {
  return blend < DENSITY_OVERVIEW_NEAR_FULL_BLEND || nodeType === 'node';
}

export interface DensityOverviewSummary {
  active: boolean;
  hiddenPods: number;
  hiddenServices: number;
}

/**
 * Derived overview state: whether overview is active and how many pods/services
 * it is hiding at the given blend. Counts are 0 while inactive.
 */
export function densityOverviewSummary(
  blend: number,
  podCount: number,
  serviceCount: number,
): DensityOverviewSummary {
  const active = blend > DENSITY_OVERVIEW_ACTIVE_BLEND;
  return {
    active,
    hiddenPods: active ? Math.round(podCount * blend) : 0,
    hiddenServices: active ? Math.round(serviceCount * blend) : 0,
  };
}
