/**
 * Performance Benchmark Collector
 *
 * Collects samples from all flexdeck telemetry exports and produces
 * summary statistics. Attach to window for console use.
 *
 * Usage (browser console):
 *   window.__flexBench.start()          // begin 10s collection
 *   window.__flexBench.start(30000)     // begin 30s collection
 *   window.__flexBench.stop()           // stop early and print results
 *   window.__flexBench.report()         // print latest report
 *   window.__flexBench.raw()            // return raw sample arrays
 *
 * Safari note: use window.__flexBench (not bare __flexBench)
 */

interface TopologyLive {
  fps: number;
  avgFrameMs: number;
  nodes: number;
  links: number;
  lastBuildMs: number;
  lastSettleMs: number;
  fiAccelSelectorCalls: number;
  fiAccelSelectorCandidates: number;
  fiAccelSelectorMs: number;
}

interface TopologyPerf {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  maxFrameMs: number;
  nodes: number;
  links: number;
  framesRendered: number;
  baseLayerDraws: number;
  avgBaseLayerDrawMs: number;
  overlayLayerDraws: number;
  avgOverlayLayerDrawMs: number;
  styleCacheRebuilds: number;
  avgStyleCacheRebuildMs: number;
  styleRefreshes: number;
  styleDebounceCoalesces: number;
  visibilityRefreshes: number;
  avgVisibilityRefreshMs: number;
  framePressureScore: number;
  simulationInits: number;
  simulationSettles: number;
  avgSimulationSettleMs: number;
}

interface PipelinePerf {
  fps: number;
  avgFrameMs: number;
  maxFrameMs: number;
  framesRendered: number;
  activeParticles: number;
  animationStarts: number;
  animationStops: number;
  particleSpawns: number;
  demoAdvances: number;
  demoSettled: boolean;
  isAnimating: boolean;
  isDemoMode: boolean;
}

interface PollPerf {
  pollCount: number;
  pollErrors: number;
  avgFetchMs: number;
  maxFetchMs: number;
  lastFetchMs: number;
  tabHiddenSkips: number;
  tabVisible: boolean;
  autoRefresh: boolean;
  isPipelineActive: boolean;
}

interface BenchSample {
  ts: number;
  topology?: TopologyLive | null;
  topologyPerf?: TopologyPerf | null;
  pipeline?: PipelinePerf | null;
  poll?: PollPerf | null;
}

interface BenchReport {
  durationMs: number;
  sampleCount: number;
  topology: {
    avgFps: number;
    minFps: number;
    maxFps: number;
    avgFrameMs: number;
    p95FrameMs: number;
    maxFrameMs: number;
    avgBaseLayerDrawMs: number;
    avgOverlayLayerDrawMs: number;
    avgStyleCacheRebuildMs: number;
    avgVisibilityRefreshMs: number;
    styleDebounceSavings: string;
    framePressureMax: number;
    nodes: number;
    links: number;
  } | null;
  pipeline: {
    avgFps: number;
    minFps: number;
    maxFps: number;
    avgFrameMs: number;
    maxFrameMs: number;
    totalFrames: number;
    peakParticles: number;
    animationStarts: number;
    animationStops: number;
    demoSettled: boolean;
  } | null;
  poll: {
    avgFetchMs: number;
    maxFetchMs: number;
    totalPolls: number;
    errorRate: string;
  } | null;
}

const w = window as Window & {
  __FLEXDECK_TOPOLOGY_LIVE__?: TopologyLive;
  __FLEXDECK_TOPOLOGY_PERF__?: TopologyPerf;
  __FLEXDECK_PIPELINE_PERF__?: PipelinePerf;
  __FLEXDECK_PIPELINE_POLL__?: PollPerf;
  __flexBench?: ReturnType<typeof createBenchmark>;
};

function createBenchmark() {
  let samples: BenchSample[] = [];
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let report: BenchReport | null = null;

  const collect = () => {
    samples.push({
      ts: performance.now(),
      topology: w.__FLEXDECK_TOPOLOGY_LIVE__ ?? null,
      topologyPerf: w.__FLEXDECK_TOPOLOGY_PERF__ ?? null,
      pipeline: w.__FLEXDECK_PIPELINE_PERF__ ?? null,
      poll: w.__FLEXDECK_PIPELINE_POLL__ ?? null,
    });
  };

  const summarize = (): BenchReport => {
    const durationMs = samples.length > 1
      ? samples[samples.length - 1].ts - samples[0].ts
      : 0;

    // Topology stats
    const topoSamples = samples.filter((s) => s.topology);
    let topoReport: BenchReport['topology'] = null;
    if (topoSamples.length > 0) {
      const fpsSamples = topoSamples.map((s) => s.topology!.fps);
      const perfSamples = samples.filter((s) => s.topologyPerf);
      const lastPerf = perfSamples.length > 0 ? perfSamples[perfSamples.length - 1].topologyPerf! : null;
      topoReport = {
        avgFps: fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length,
        minFps: Math.min(...fpsSamples),
        maxFps: Math.max(...fpsSamples),
        avgFrameMs: lastPerf?.avgFrameMs ?? 0,
        p95FrameMs: lastPerf?.p95FrameMs ?? 0,
        maxFrameMs: lastPerf?.maxFrameMs ?? 0,
        avgBaseLayerDrawMs: lastPerf?.avgBaseLayerDrawMs ?? 0,
        avgOverlayLayerDrawMs: lastPerf?.avgOverlayLayerDrawMs ?? 0,
        avgStyleCacheRebuildMs: lastPerf?.avgStyleCacheRebuildMs ?? 0,
        avgVisibilityRefreshMs: lastPerf?.avgVisibilityRefreshMs ?? 0,
        styleDebounceSavings: lastPerf
          ? `${lastPerf.styleDebounceCoalesces}/${lastPerf.styleRefreshes} coalesced`
          : 'n/a',
        framePressureMax: lastPerf?.framePressureScore ?? 0,
        nodes: topoSamples[topoSamples.length - 1].topology!.nodes,
        links: topoSamples[topoSamples.length - 1].topology!.links,
      };
    }

    // Pipeline stats
    const pipeSamples = samples.filter((s) => s.pipeline);
    let pipeReport: BenchReport['pipeline'] = null;
    if (pipeSamples.length > 0) {
      const fpsSamples = pipeSamples.map((s) => s.pipeline!.fps).filter((f) => f > 0);
      const lastPipe = pipeSamples[pipeSamples.length - 1].pipeline!;
      pipeReport = {
        avgFps: fpsSamples.length > 0 ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : 0,
        minFps: fpsSamples.length > 0 ? Math.min(...fpsSamples) : 0,
        maxFps: fpsSamples.length > 0 ? Math.max(...fpsSamples) : 0,
        avgFrameMs: lastPipe.avgFrameMs,
        maxFrameMs: lastPipe.maxFrameMs,
        totalFrames: lastPipe.framesRendered,
        peakParticles: Math.max(...pipeSamples.map((s) => s.pipeline!.activeParticles)),
        animationStarts: lastPipe.animationStarts,
        animationStops: lastPipe.animationStops,
        demoSettled: lastPipe.demoSettled,
      };
    }

    // Poll stats
    const pollSamples = samples.filter((s) => s.poll);
    let pollReport: BenchReport['poll'] = null;
    if (pollSamples.length > 0) {
      const lastPoll = pollSamples[pollSamples.length - 1].poll!;
      pollReport = {
        avgFetchMs: lastPoll.avgFetchMs,
        maxFetchMs: lastPoll.maxFetchMs,
        totalPolls: lastPoll.pollCount,
        errorRate: lastPoll.pollCount > 0
          ? `${((lastPoll.pollErrors / lastPoll.pollCount) * 100).toFixed(1)}%`
          : '0%',
      };
    }

    return { durationMs, sampleCount: samples.length, topology: topoReport, pipeline: pipeReport, poll: pollReport };
  };

  const formatReport = (r: BenchReport): string => {
    const lines: string[] = [
      `=== FlexDeck Performance Benchmark ===`,
      `Duration: ${(r.durationMs / 1000).toFixed(1)}s | Samples: ${r.sampleCount}`,
      '',
    ];

    if (r.topology) {
      const t = r.topology;
      lines.push(
        `--- Topology Graph ---`,
        `  FPS:        avg=${t.avgFps.toFixed(1)}  min=${t.minFps.toFixed(1)}  max=${t.maxFps.toFixed(1)}`,
        `  Frame:      avg=${t.avgFrameMs.toFixed(2)}ms  p95=${t.p95FrameMs.toFixed(2)}ms  max=${t.maxFrameMs.toFixed(2)}ms`,
        `  Base draw:  avg=${t.avgBaseLayerDrawMs.toFixed(2)}ms`,
        `  Overlay:    avg=${t.avgOverlayLayerDrawMs.toFixed(2)}ms`,
        `  Style cache: avg=${t.avgStyleCacheRebuildMs.toFixed(2)}ms`,
        `  Visibility:  avg=${t.avgVisibilityRefreshMs.toFixed(3)}ms`,
        `  Debounce:   ${t.styleDebounceSavings}`,
        `  Pressure:   ${t.framePressureMax}/12`,
        `  Graph:      ${t.nodes} nodes, ${t.links} links`,
        '',
      );
    }

    if (r.pipeline) {
      const p = r.pipeline;
      lines.push(
        `--- Pipeline Animation ---`,
        `  FPS:        avg=${p.avgFps.toFixed(1)}  min=${p.minFps.toFixed(1)}  max=${p.maxFps.toFixed(1)}`,
        `  Frame:      avg=${p.avgFrameMs.toFixed(2)}ms  max=${p.maxFrameMs.toFixed(2)}ms`,
        `  Frames:     ${p.totalFrames} rendered`,
        `  Particles:  peak=${p.peakParticles}`,
        `  Animation:  ${p.animationStarts} starts, ${p.animationStops} stops`,
        `  Demo:       settled=${p.demoSettled}`,
        '',
      );
    }

    if (r.poll) {
      const q = r.poll;
      lines.push(
        `--- Pipeline Polling ---`,
        `  Fetch:      avg=${q.avgFetchMs.toFixed(0)}ms  max=${q.maxFetchMs.toFixed(0)}ms`,
        `  Polls:      ${q.totalPolls} total, ${q.errorRate} errors`,
        '',
      );
    }

    if (!r.topology && !r.pipeline && !r.poll) {
      lines.push('  No telemetry data collected. Navigate to Dashboard or Pipeline page first.');
    }

    return lines.join('\n');
  };

  return {
    start(durationMs = 10000) {
      if (intervalId) this.stop();
      samples = [];
      collect();
      intervalId = setInterval(collect, 250);
      console.log(`Benchmark started. Collecting for ${(durationMs / 1000).toFixed(0)}s...`);
      setTimeout(() => {
        if (intervalId) this.stop();
      }, durationMs);
    },

    stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      collect(); // final sample
      report = summarize();
      console.log(formatReport(report));
      return report;
    },

    report() {
      if (!report && samples.length > 0) report = summarize();
      if (report) {
        console.log(formatReport(report));
        return report;
      }
      console.log('No benchmark data. Run __flexBench.start() first.');
      return null;
    },

    raw: () => ({ samples, report }),
  };
}

export function installBenchmark() {
  if (typeof window === 'undefined') return;
  w.__flexBench = createBenchmark();
  console.debug('[flexdeck] perf benchmark ready → window.__flexBench.start()');
}
