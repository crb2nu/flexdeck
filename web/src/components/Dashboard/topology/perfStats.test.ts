import { describe, expect, it } from "vitest";

import { computeFrameStats, safeAverage } from "./perfStats";

describe("computeFrameStats", () => {
  it("returns all-zero stats for an empty window", () => {
    expect(computeFrameStats([])).toEqual({ avgFrameMs: 0, fps: 0, p95FrameMs: 0 });
  });

  it("computes average and fps from frame durations", () => {
    const stats = computeFrameStats([10, 20, 30]);
    expect(stats.avgFrameMs).toBeCloseTo(20, 10);
    expect(stats.fps).toBeCloseTo(1000 / 20, 10);
  });

  it("derives fps as zero when the average frame time is zero", () => {
    const stats = computeFrameStats([0, 0]);
    expect(stats.avgFrameMs).toBe(0);
    expect(stats.fps).toBe(0);
  });

  it("does not mutate the caller's array when computing p95", () => {
    const samples = [30, 10, 20];
    computeFrameStats(samples);
    expect(samples).toEqual([30, 10, 20]);
  });

  it("selects p95 from the sorted window (clamped to the last index)", () => {
    // 20 samples: floor(20 * 0.95) = 19 -> the max value once sorted.
    const samples = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(computeFrameStats(samples).p95FrameMs).toBe(20);
  });

  it("clamps p95 index for tiny windows", () => {
    // floor(2 * 0.95) = 1 -> the larger of two sorted samples.
    expect(computeFrameStats([5, 1]).p95FrameMs).toBe(5);
    // Single sample -> index 0.
    expect(computeFrameStats([7]).p95FrameMs).toBe(7);
  });
});

describe("safeAverage", () => {
  it("returns total/count when count is positive", () => {
    expect(safeAverage(100, 4)).toBe(25);
  });

  it("guards against a zero or negative count", () => {
    expect(safeAverage(100, 0)).toBe(0);
    expect(safeAverage(100, -3)).toBe(0);
  });
});
