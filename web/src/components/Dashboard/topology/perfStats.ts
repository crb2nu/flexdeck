// Pure perf-statistics helpers extracted from TopologyGraph.tsx.
//
// These compute the frame-timing summary (average, p95, fps) and the
// total/count averages used to build the topology performance HUD snapshot.
// Keeping them pure and side-effect free makes the numbers unit-testable
// without standing up the full canvas component.

export interface FrameStats {
  avgFrameMs: number;
  fps: number;
  p95FrameMs: number;
}

/**
 * Summarize a window of frame durations (in milliseconds).
 *
 * Pure: does not mutate the input. An empty window yields all-zero stats, and
 * fps is derived from the average frame time (0 when no time has elapsed).
 */
export function computeFrameStats(samples: readonly number[]): FrameStats {
  if (samples.length === 0) {
    return { avgFrameMs: 0, fps: 0, p95FrameMs: 0 };
  }

  let total = 0;
  for (const sample of samples) total += sample;
  const avgFrameMs = total / samples.length;

  const sorted = [...samples].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  const p95FrameMs = sorted[p95Index];

  const fps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;
  return { avgFrameMs, fps, p95FrameMs };
}

/**
 * total / count with a zero-count guard. Returns 0 when count <= 0 so HUD
 * averages never surface NaN before any samples have accumulated.
 */
export function safeAverage(total: number, count: number): number {
  return count > 0 ? total / count : 0;
}
