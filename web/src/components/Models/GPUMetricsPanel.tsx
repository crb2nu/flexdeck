import { Component, createSignal, Show, For } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { prom } from '../../lib/api';
import Sparkline from '../shared/Sparkline';

interface GPUDeviceMetrics {
  device: string;
  utilization: number | null;
  vramUsed: number | null;
  vramTotal: number | null;
  temperature: number | null;
  powerWatts: number | null;
}

interface GPUMetrics {
  utilization: number | null;
  vramUsed: number | null;
  vramTotal: number | null;
  temperature: number | null;
  powerWatts: number | null;
}

interface MetricsHistory {
  utilization: number[];
  vramPercent: number[];
  temperature: number[];
  power: number[];
}

const POLL_INTERVAL = 10_000;
const HISTORY_SIZE = 20;

function pushHistory(arr: number[], val: number | null): number[] {
  if (val == null) return arr;
  const next = [...arr, val];
  return next.length > HISTORY_SIZE ? next.slice(next.length - HISTORY_SIZE) : next;
}

const GPUMetricsPanel: Component<{ node: string; vendor?: string }> = (props) => {
  const [metrics, setMetrics] = createSignal<GPUMetrics>({
    utilization: null,
    vramUsed: null,
    vramTotal: null,
    temperature: null,
    powerWatts: null,
  });
  const [devices, setDevices] = createSignal<GPUDeviceMetrics[]>([]);
  const [showDevices, setShowDevices] = createSignal(false);
  const [history, setHistory] = createSignal<MetricsHistory>({
    utilization: [],
    vramPercent: [],
    temperature: [],
    power: [],
  });
  const [error, setError] = createSignal(false);

  const isAMD = () => (props.vendor || '').toLowerCase().includes('amd');

  const queryPromAll = async (query: string): Promise<Array<{ metric: Record<string, string>; value: number }>> => {
    try {
      const data = await prom.query(query);
      const result = data?.data?.result;
      if (result && result.length > 0) {
        return result.map((r: any) => ({
          metric: r.metric || {},
          value: parseFloat(r.value[1]),
        }));
      }
    } catch {
      // metric may not exist
    }
    return [];
  };

  const fetchMetrics = async () => {
    const node = props.node;
    if (!node) return;

    const nodeFilter = `instance=~".*${node}.*"`;

    let allDevices: GPUDeviceMetrics[] = [];

    if (isAMD()) {
      const [utilResults, vramUsedResults, vramTotalResults, tempResults, powerResults] = await Promise.all([
        queryPromAll(`amdgpu_gpu_busy_percent{${nodeFilter}}`),
        queryPromAll(`amdgpu_vram_used_bytes{${nodeFilter}}`),
        queryPromAll(`amdgpu_vram_total_bytes{${nodeFilter}}`),
        queryPromAll(`amdgpu_temperature_edge{${nodeFilter}}`),
        queryPromAll(`amdgpu_power_average_watts{${nodeFilter}}`),
      ]);

      const deviceIds = new Set<string>();
      [utilResults, vramUsedResults, tempResults, powerResults].forEach(results =>
        results.forEach(r => deviceIds.add(r.metric.gpu || r.metric.device || '0'))
      );

      allDevices = [...deviceIds].map(dev => {
        const findVal = (results: typeof utilResults) =>
          results.find(r => (r.metric.gpu || r.metric.device || '0') === dev)?.value ?? null;
        return {
          device: dev,
          utilization: findVal(utilResults),
          vramUsed: findVal(vramUsedResults),
          vramTotal: findVal(vramTotalResults),
          temperature: findVal(tempResults),
          powerWatts: findVal(powerResults),
        };
      });
    } else {
      const [util1Results, util2Results] = await Promise.all([
        queryPromAll(`DCGM_FI_DEV_GPU_UTIL{${nodeFilter}}`),
        queryPromAll(`nvidia_gpu_duty_cycle{${nodeFilter}}`),
      ]);
      const utilResults = util1Results.length > 0 ? util1Results : util2Results;

      const [fbUsedResults, fbFreeResults, tempResults, powerResults] = await Promise.all([
        queryPromAll(`DCGM_FI_DEV_FB_USED{${nodeFilter}}`),
        queryPromAll(`DCGM_FI_DEV_FB_FREE{${nodeFilter}}`),
        queryPromAll(`DCGM_FI_DEV_GPU_TEMP{${nodeFilter}}`),
        queryPromAll(`DCGM_FI_DEV_POWER_USAGE{${nodeFilter}}`),
      ]);

      const deviceIds = new Set<string>();
      [utilResults, fbUsedResults, tempResults, powerResults].forEach(results =>
        results.forEach(r => deviceIds.add(r.metric.gpu || r.metric.device || '0'))
      );

      allDevices = [...deviceIds].map(dev => {
        const findVal = (results: typeof utilResults) =>
          results.find(r => (r.metric.gpu || r.metric.device || '0') === dev)?.value ?? null;
        const fbUsed = findVal(fbUsedResults);
        const fbFree = findVal(fbFreeResults);
        return {
          device: dev,
          utilization: findVal(utilResults),
          vramUsed: fbUsed != null ? fbUsed * 1024 * 1024 : null,
          vramTotal: fbUsed != null && fbFree != null ? (fbUsed + fbFree) * 1024 * 1024 : null,
          temperature: findVal(tempResults),
          powerWatts: findVal(powerResults),
        };
      });
    }

    setDevices(allDevices);

    // Aggregate across devices
    const aggregate: GPUMetrics = { utilization: null, vramUsed: null, vramTotal: null, temperature: null, powerWatts: null };
    if (allDevices.length > 0) {
      const utils = allDevices.map(d => d.utilization).filter((v): v is number => v != null);
      const vramUseds = allDevices.map(d => d.vramUsed).filter((v): v is number => v != null);
      const vramTotals = allDevices.map(d => d.vramTotal).filter((v): v is number => v != null);
      const temps = allDevices.map(d => d.temperature).filter((v): v is number => v != null);
      const powers = allDevices.map(d => d.powerWatts).filter((v): v is number => v != null);

      if (utils.length > 0) aggregate.utilization = utils.reduce((a, b) => a + b, 0) / utils.length;
      if (vramUseds.length > 0) aggregate.vramUsed = vramUseds.reduce((a, b) => a + b, 0);
      if (vramTotals.length > 0) aggregate.vramTotal = vramTotals.reduce((a, b) => a + b, 0);
      if (temps.length > 0) aggregate.temperature = Math.max(...temps);
      if (powers.length > 0) aggregate.powerWatts = powers.reduce((a, b) => a + b, 0);
    }

    const hasAny = aggregate.utilization != null || aggregate.vramUsed != null || aggregate.temperature != null || aggregate.powerWatts != null;
    setError(!hasAny);
    setMetrics(aggregate);

    // Update history
    const vp = aggregate.vramUsed != null && aggregate.vramTotal != null && aggregate.vramTotal > 0
      ? (aggregate.vramUsed / aggregate.vramTotal) * 100
      : null;
    setHistory(prev => ({
      utilization: pushHistory(prev.utilization, aggregate.utilization),
      vramPercent: pushHistory(prev.vramPercent, vp),
      temperature: pushHistory(prev.temperature, aggregate.temperature),
      power: pushHistory(prev.power, aggregate.powerWatts),
    }));
  };

  createPolling(
    () => `models-gpu-metrics-${props.node}`,
    fetchMetrics,
    POLL_INTERVAL,
    () => Boolean(props.node),
  );

  const vramPercent = () => {
    const m = metrics();
    if (m.vramUsed != null && m.vramTotal != null && m.vramTotal > 0) {
      return (m.vramUsed / m.vramTotal) * 100;
    }
    return null;
  };

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  const multiGPU = () => devices().length > 1;

  return (
    <Show when={!error() && (metrics().utilization != null || metrics().vramUsed != null)}>
      <div class="rounded-md bg-neon-cyan/5 p-2 space-y-1.5">
        <div class="flex items-center justify-between">
          <div class="text-[10px] font-medium text-neon-cyan uppercase tracking-wider">
            GPU Metrics {isAMD() ? '(ROCm)' : '(NVIDIA)'}
            {multiGPU() ? ` [${devices().length} GPUs]` : ''}
          </div>
          <Show when={multiGPU()}>
            <button
              onClick={() => setShowDevices(!showDevices())}
              class="text-[10px] text-neon-cyan/60 hover:text-neon-cyan transition-colors"
            >
              {showDevices() ? 'Hide' : 'Show'} devices
            </button>
          </Show>
        </div>

        {/* Utilization bar */}
        <Show when={metrics().utilization != null}>
          <div class="space-y-0.5">
            <div class="flex justify-between text-xs">
              <span class="text-text-dim">Utilization</span>
              <span class="text-neon-cyan font-mono">{metrics().utilization!.toFixed(0)}%</span>
            </div>
            <div class="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                class="h-full rounded-full bg-neon-cyan transition-all"
                style={{ width: `${metrics().utilization}%` }}
              />
            </div>
          </div>
        </Show>

        {/* VRAM bar */}
        <Show when={vramPercent() != null}>
          <div class="space-y-0.5">
            <div class="flex justify-between text-xs">
              <span class="text-text-dim">VRAM</span>
              <span class="text-neon-cyan font-mono">
                {formatBytes(metrics().vramUsed!)} / {formatBytes(metrics().vramTotal!)}
              </span>
            </div>
            <div class="h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                class={`h-full rounded-full transition-all ${
                  vramPercent()! > 90 ? 'bg-status-error' : 'bg-neon-purple'
                }`}
                style={{ width: `${vramPercent()}%` }}
              />
            </div>
          </div>
        </Show>

        {/* Temp + Power */}
        <div class="flex gap-4">
          <Show when={metrics().temperature != null}>
            <div class="flex justify-between text-xs flex-1">
              <span class="text-text-dim">Temp</span>
              <span class={`font-mono ${
                metrics().temperature! > 85 ? 'text-status-error' : 'text-text-muted'
              }`}>
                {metrics().temperature!.toFixed(0)}°C
              </span>
            </div>
          </Show>
          <Show when={metrics().powerWatts != null}>
            <div class="flex justify-between text-xs flex-1">
              <span class="text-text-dim">Power</span>
              <span class="text-text-muted font-mono">{metrics().powerWatts!.toFixed(0)}W</span>
            </div>
          </Show>
        </div>

        {/* Sparkline history */}
        <Show when={history().utilization.length >= 2}>
          <div class="grid grid-cols-2 gap-1.5 pt-1 border-t border-white/5">
            <Show when={history().utilization.length >= 2}>
              <div class="flex items-center gap-1">
                <span class="text-[9px] text-text-dim w-6">Util</span>
                <Sparkline data={history().utilization} width={60} height={16} color="#22d3ee" />
              </div>
            </Show>
            <Show when={history().vramPercent.length >= 2}>
              <div class="flex items-center gap-1">
                <span class="text-[9px] text-text-dim w-6">VRAM</span>
                <Sparkline data={history().vramPercent} width={60} height={16} color="#a855f7" />
              </div>
            </Show>
            <Show when={history().temperature.length >= 2}>
              <div class="flex items-center gap-1">
                <span class="text-[9px] text-text-dim w-6">Temp</span>
                <Sparkline data={history().temperature} width={60} height={16} color="#f97316" />
              </div>
            </Show>
            <Show when={history().power.length >= 2}>
              <div class="flex items-center gap-1">
                <span class="text-[9px] text-text-dim w-6">Pwr</span>
                <Sparkline data={history().power} width={60} height={16} color="#eab308" />
              </div>
            </Show>
          </div>
        </Show>

        {/* Per-device breakdown (multi-GPU) */}
        <Show when={multiGPU() && showDevices()}>
          <div class="space-y-1.5 pt-1 border-t border-white/5">
            <For each={devices()}>
              {(dev) => {
                const devVramPct = () =>
                  dev.vramUsed != null && dev.vramTotal != null && dev.vramTotal > 0
                    ? (dev.vramUsed / dev.vramTotal) * 100 : null;
                return (
                  <div class="rounded bg-white/5 p-1.5 space-y-0.5">
                    <div class="text-[9px] font-mono text-text-dim">GPU {dev.device}</div>
                    <Show when={dev.utilization != null}>
                      <div class="flex items-center gap-2">
                        <span class="text-[9px] text-text-dim w-8">Util</span>
                        <div class="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                          <div class="h-full rounded-full bg-neon-cyan" style={{ width: `${dev.utilization}%` }} />
                        </div>
                        <span class="text-[9px] font-mono text-neon-cyan w-8 text-right">{dev.utilization!.toFixed(0)}%</span>
                      </div>
                    </Show>
                    <Show when={devVramPct() != null}>
                      <div class="flex items-center gap-2">
                        <span class="text-[9px] text-text-dim w-8">VRAM</span>
                        <div class="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                          <div class={`h-full rounded-full ${devVramPct()! > 90 ? 'bg-status-error' : 'bg-neon-purple'}`} style={{ width: `${devVramPct()}%` }} />
                        </div>
                        <span class="text-[9px] font-mono text-neon-purple w-8 text-right">{devVramPct()!.toFixed(0)}%</span>
                      </div>
                    </Show>
                    <div class="flex gap-3 text-[9px]">
                      <Show when={dev.temperature != null}>
                        <span class={dev.temperature! > 85 ? 'text-status-error' : 'text-text-dim'}>
                          {dev.temperature!.toFixed(0)}°C
                        </span>
                      </Show>
                      <Show when={dev.powerWatts != null}>
                        <span class="text-text-dim">{dev.powerWatts!.toFixed(0)}W</span>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default GPUMetricsPanel;
