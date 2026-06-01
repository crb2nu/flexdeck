import { describe, expect, it } from "vitest";

import {
  clamp01,
  computeDensityOverviewBlend,
  densityOverviewSummary,
  shouldRenderNodeForDensity,
  smoothstep,
  DENSITY_OVERVIEW_NODE_THRESHOLD,
  DENSITY_OVERVIEW_POD_THRESHOLD,
} from "./densityOverview";

describe("clamp01 / smoothstep", () => {
  it("clamps to [0,1]", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });

  it("smoothstep is 0 below edge0, 1 above edge1, monotonic between", () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 10);
    expect(smoothstep(0, 1, 0.25)).toBeLessThan(smoothstep(0, 1, 0.75));
  });

  it("smoothstep handles a degenerate edge0 === edge1", () => {
    expect(smoothstep(1, 1, 0.5)).toBe(0);
    expect(smoothstep(1, 1, 1)).toBe(1);
  });
});

describe("computeDensityOverviewBlend", () => {
  it("is 0 for small graphs regardless of zoom", () => {
    expect(computeDensityOverviewBlend({ zoomLevel: 0.1, nodeCount: 10, podCount: 10 })).toBe(0);
  });

  it("activates when either node or pod count crosses its threshold", () => {
    const byNodes = computeDensityOverviewBlend({
      zoomLevel: 0.5,
      nodeCount: DENSITY_OVERVIEW_NODE_THRESHOLD,
      podCount: 0,
    });
    const byPods = computeDensityOverviewBlend({
      zoomLevel: 0.5,
      nodeCount: 0,
      podCount: DENSITY_OVERVIEW_POD_THRESHOLD,
    });
    expect(byNodes).toBeGreaterThan(0);
    expect(byPods).toBeGreaterThan(0);
  });

  it("fades toward 1 as zoom drops and toward 0 as zoom rises (large graph)", () => {
    const big = { nodeCount: 1000, podCount: 500 };
    const zoomedOut = computeDensityOverviewBlend({ zoomLevel: 0.5, ...big });
    const zoomedIn = computeDensityOverviewBlend({ zoomLevel: 2.0, ...big });
    expect(zoomedOut).toBeGreaterThan(0.9); // far below transition band -> near full overview
    expect(zoomedIn).toBeLessThan(0.1); // well above band -> near full detail
    expect(zoomedOut).toBeGreaterThan(zoomedIn);
  });

  it("returns blend within [0,1]", () => {
    for (const zoomLevel of [0, 0.5, 1.0, 1.25, 1.5, 3]) {
      const b = computeDensityOverviewBlend({ zoomLevel, nodeCount: 1000, podCount: 500 });
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });
});

describe("shouldRenderNodeForDensity", () => {
  it("always renders cluster nodes even at full overview", () => {
    expect(shouldRenderNodeForDensity("node", 1)).toBe(true);
  });

  it("hides pods/services only near full overview", () => {
    expect(shouldRenderNodeForDensity("pod", 0.5)).toBe(true);
    expect(shouldRenderNodeForDensity("pod", 0.99)).toBe(false);
    expect(shouldRenderNodeForDensity("service", 0.99)).toBe(false);
  });
});

describe("densityOverviewSummary", () => {
  it("is inactive with zero hidden counts below the active blend", () => {
    expect(densityOverviewSummary(0.1, 400, 80)).toEqual({
      active: false,
      hiddenPods: 0,
      hiddenServices: 0,
    });
  });

  it("rounds hidden counts proportionally to the blend when active", () => {
    expect(densityOverviewSummary(0.5, 400, 81)).toEqual({
      active: true,
      hiddenPods: 200,
      hiddenServices: 41, // round(81 * 0.5) = round(40.5) = 41
    });
  });
});
