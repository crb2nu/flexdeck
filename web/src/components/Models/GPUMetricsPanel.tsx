import { Component, createSignal, createEffect, onCleanup, Show } from 'solid-js';
import { prom } from '../../lib/api';

interface GPUMetrics {
  utilization: number | null;
  vramUsed: number | null;
  vramTotal: number | null;
  temperature: number | null;
  powerWatts: number | null;
}

const POLL_INTERVAL = 10_000;

const GPUMetricsPanel: Component<{ node: string; vendor?: string }> = (props) => {
  const [metrics, setMetrics] = createSignal<GPUMetrics>({
    utilization: null,
    vramUsed: null,
    vramTotal: null,
    temperature: null,
    powerWatts: null,
  });
  const [error, setError] = createSignal(false);

  const isAMD = () => (props.vendor || '').toLowerCase().includes('amd');

  const queryProm = async (query: string): Promise<number | null> => {
    try {
      const data = await prom.query(query);
      const result = data?.data?.result;
      if (result && result.length > 0 && result[0].value) {
        return parseFloat(result[0].value[1]);
      }
    } catch {
      // metric may not exist
    }
    return null;
  };

  const fetchMetrics = async () => {
    const node = props.node;
    if (!node) return;

    const nodeFilter = `instance=~".*${node}.*"`;

    let utilization: number | null = null;
    let vramUsed: number | null = null;
    let vramTotal: number | null = null;
    let temperature: number | null = null;
    let powerWatts: number | null = null;

    if (isAMD()) {
      [utilization, vramUsed, vramTotal, temperature, powerWatts] = await Promise.all([
        queryProm(`amdgpu_gpu_busy_percent{${nodeFilter}}`),
        queryProm(`amdgpu_vram_used_bytes{${nodeFilter}}`),
        queryProm(`amdgpu_vram_total_bytes{${nodeFilter}}`),
        queryProm(`amdgpu_temperature_edge{${nodeFilter}}`),
        queryProm(`amdgpu_power_average_watts{${nodeFilter}}`),
      ]);
    } else {
      // NVIDIA fallback
      const [util1, util2] = await Promise.all([
        queryProm(`DCGM_FI_DEV_GPU_UTIL{${nodeFilter}}`),
        queryProm(`nvidia_gpu_duty_cycle{${nodeFilter}}`),
      ]);
      utilization = util1 ?? util2;

      const [fbUsed, fbFree] = await Promise.all([
        queryProm(`DCGM_FI_DEV_FB_USED{${nodeFilter}}`),
        queryProm(`DCGM_FI_DEV_FB_FREE{${nodeFilter}}`),
      ]);
      if (fbUsed != null) {
        vramUsed = fbUsed * 1024 * 1024; // MB to bytes
        if (fbFree != null) vramTotal = (fbUsed + fbFree) * 1024 * 1024;
      }

      [temperature, powerWatts] = await Promise.all([
        queryProm(`DCGM_FI_DEV_GPU_TEMP{${nodeFilter}}`),
        queryProm(`DCGM_FI_DEV_POWER_USAGE{${nodeFilter}}`),
      ]);
    }

    const hasAny = utilization != null || vramUsed != null || temperature != null || powerWatts != null;
    setError(!hasAny);
    setMetrics({ utilization, vramUsed, vramTotal, temperature, powerWatts });
  };

  let timer: ReturnType<typeof setInterval>;
  createEffect(() => {
    if (props.node) {
      fetchMetrics();
      timer = setInterval(fetchMetrics, POLL_INTERVAL);
    }
  });
  onCleanup(() => clearInterval(timer));

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

  return (
    <Show when={!error() && (metrics().utilization != null || metrics().vramUsed != null)}>
      <div class="rounded-md bg-neon-cyan/5 p-2 space-y-1.5">
        <div class="text-[10px] font-medium text-neon-cyan uppercase tracking-wider">
          GPU Metrics {isAMD() ? '(ROCm)' : '(NVIDIA)'}
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
      </div>
    </Show>
  );
};

export default GPUMetricsPanel;
