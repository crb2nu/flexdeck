import { Component, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { prom } from '../../lib/api';
import { k8sStore, isNodeReady } from '../../stores/k8s';
import Sparkline from '../shared/Sparkline';

interface NodeGPU {
  node: string;
  gpuCount: number;
  utilization: number | null;
  vramUsed: number | null;
  vramTotal: number | null;
  temperature: number | null;
  powerWatts: number | null;
}

interface NodeResources {
  node: string;
  ready: boolean;
  cpuPercent: number | null;
  memPercent: number | null;
  gpu: NodeGPU | null;
}

const POLL_INTERVAL = 15_000;
const HISTORY_SIZE = 12;

function pushHist(arr: number[], val: number | null): number[] {
  if (val == null) return arr;
  const next = [...arr, val];
  return next.length > HISTORY_SIZE ? next.slice(next.length - HISTORY_SIZE) : next;
}

const NodeResourcePanel: Component = () => {
  const [nodes, setNodes] = createSignal<NodeResources[]>([]);
  const [gpuHistory, setGpuHistory] = createSignal<Record<string, number[]>>({});
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(false);

  const queryProm = async (query: string) => {
    try {
      const data = await prom.query(query);
      const result = data?.data?.result;
      if (!Array.isArray(result)) {
        return [];
      }
      return result.map((r: any) => ({
        metric: r.metric || {},
        value: parseFloat(r.value?.[1] ?? '0'),
      }));
    } catch {
      return [];
    }
  };

  const fetchResources = async () => {
    const k8sNodes = Array.isArray(k8sStore.nodes) ? k8sStore.nodes : [];
    if (k8sNodes.length === 0) {
      setLoading(false);
      return;
    }

    const [cpuResults, memResults, gpuUtilResults, vramUsedResults, vramTotalResults, tempResults, powerResults] =
      await Promise.all([
        queryProm('100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'),
        queryProm('(1 - (node_memory_AvailableBytes / node_memory_MemTotalBytes)) * 100'),
        queryProm('avg by (instance) (amdgpu_gpu_busy_percent)'),
        queryProm('sum by (instance) (amdgpu_vram_used_bytes)'),
        queryProm('sum by (instance) (amdgpu_vram_total_bytes)'),
        queryProm('max by (instance) (amdgpu_temperature_edge)'),
        queryProm('sum by (instance) (amdgpu_power_average_watts)'),
      ]);

    // Count GPUs per node
    const gpuCountResults = await queryProm('count by (instance) (amdgpu_gpu_busy_percent)');

    const normalizeNodeName = (value: string): string => {
      return value.toLowerCase().trim().split(':')[0].split('.')[0];
    };

    const metricNodeName = (metric: Record<string, string>): string => {
      return (
        metric.node ||
        metric.nodename ||
        metric.kubernetes_node ||
        metric.exported_node ||
        metric.instance ||
        ''
      );
    };

    const matchNode = (metricNode: string, nodeName: string): boolean => {
      const metricNorm = normalizeNodeName(metricNode);
      const nodeNorm = normalizeNodeName(nodeName);
      return (
        metricNorm === nodeNorm ||
        metricNorm.includes(nodeNorm) ||
        nodeNorm.includes(metricNorm)
      );
    };

    const findVal = (results: any[], nodeName: string): number | null => {
      const match = results.find((r: any) => matchNode(metricNodeName(r.metric || {}), nodeName));
      return match ? match.value : null;
    };

    const nextNodes: NodeResources[] = k8sNodes.map((n) => {
      const name = n.metadata.name;
      const cpuPct = findVal(cpuResults, name);
      const memPct = findVal(memResults, name);

      const gpuUtil = findVal(gpuUtilResults, name);
      const hasGPU = gpuUtil != null;

      return {
        node: name,
        ready: isNodeReady(n),
        cpuPercent: cpuPct,
        memPercent: memPct,
        gpu: hasGPU
          ? {
              node: name,
              gpuCount: findVal(gpuCountResults, name) ?? 1,
              utilization: gpuUtil,
              vramUsed: findVal(vramUsedResults, name),
              vramTotal: findVal(vramTotalResults, name),
              temperature: findVal(tempResults, name),
              powerWatts: findVal(powerResults, name),
            }
          : null,
      };
    });

    setNodes(nextNodes);
    setLoading(false);
    setError(nextNodes.every((n) => n.cpuPercent == null && n.memPercent == null));

    // Update GPU utilization history
    setGpuHistory((prev) => {
      const next = { ...prev };
      for (const n of nextNodes) {
        if (n.gpu?.utilization != null) {
          next[n.node] = pushHist(prev[n.node] || [], n.gpu.utilization);
        }
      }
      return next;
    });
  };

  let timer: ReturnType<typeof setInterval>;
  createEffect(() => {
    fetchResources();
    timer = setInterval(fetchResources, POLL_INTERVAL);
  });
  onCleanup(() => clearInterval(timer));

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  const barColor = (pct: number) =>
    pct > 90 ? 'bg-status-error' : pct > 70 ? 'bg-status-warn' : 'bg-neon-cyan';

  const gpuNodes = () => nodes().filter((n) => n.gpu != null);
  const nonGpuNodes = () => nodes().filter((n) => n.gpu == null);

  return (
    <div class="glass-panel p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-bold uppercase tracking-widest text-text-main">
          Node Resources
        </h3>
        <span class="text-[10px] text-text-dim">
          {nodes().length} nodes · {gpuNodes().length} GPU
        </span>
      </div>

      <Show when={loading()}>
        <div class="flex items-center justify-center py-6">
          <div class="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
        </div>
      </Show>

      <Show when={!loading() && error()}>
        <div class="text-xs text-status-warn text-center py-4">
          No node metrics available. Check Prometheus connectivity.
        </div>
      </Show>

      <Show when={!loading() && !error()}>
        <div class="space-y-2">
          {/* GPU Nodes first */}
          <For each={gpuNodes()}>
            {(n) => {
              const gpu = () => n.gpu!;
              const vramPct = () =>
                gpu().vramUsed != null && gpu().vramTotal != null && gpu().vramTotal! > 0
                  ? (gpu().vramUsed! / gpu().vramTotal!) * 100
                  : null;
              const hist = () => gpuHistory()[n.node] || [];

              return (
                <div class="rounded-md bg-white/5 p-2.5 space-y-1.5">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <span
                        class={`w-1.5 h-1.5 rounded-full ${n.ready ? 'bg-status-ok' : 'bg-status-error'}`}
                      />
                      <span class="text-xs font-mono text-text-main">{n.node}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                      <span class="text-[9px] px-1.5 py-0.5 rounded bg-neon-purple/20 text-neon-purple font-medium">
                        {gpu().gpuCount} GPU
                      </span>
                      <Show when={gpu().temperature != null}>
                        <span
                          class={`text-[9px] font-mono ${gpu().temperature! > 85 ? 'text-status-error' : 'text-text-dim'}`}
                        >
                          {gpu().temperature!.toFixed(0)}°C
                        </span>
                      </Show>
                      <Show when={gpu().powerWatts != null}>
                        <span class="text-[9px] font-mono text-text-dim">
                          {gpu().powerWatts!.toFixed(0)}W
                        </span>
                      </Show>
                    </div>
                  </div>

                  {/* GPU Util bar */}
                  <Show when={gpu().utilization != null}>
                    <div class="flex items-center gap-2">
                      <span class="text-[9px] text-text-dim w-10">GPU</span>
                      <div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          class={`h-full rounded-full transition-all ${barColor(gpu().utilization!)}`}
                          style={{ width: `${gpu().utilization}%` }}
                        />
                      </div>
                      <span class="text-[9px] font-mono text-neon-cyan w-8 text-right">
                        {gpu().utilization!.toFixed(0)}%
                      </span>
                    </div>
                  </Show>

                  {/* VRAM bar */}
                  <Show when={vramPct() != null}>
                    <div class="flex items-center gap-2">
                      <span class="text-[9px] text-text-dim w-10">VRAM</span>
                      <div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          class={`h-full rounded-full transition-all ${vramPct()! > 90 ? 'bg-status-error' : 'bg-neon-purple'}`}
                          style={{ width: `${vramPct()}%` }}
                        />
                      </div>
                      <span class="text-[9px] font-mono text-neon-purple w-8 text-right">
                        {formatBytes(gpu().vramUsed!)}
                      </span>
                    </div>
                  </Show>

                  {/* CPU + Mem inline */}
                  <div class="flex gap-3">
                    <Show when={n.cpuPercent != null}>
                      <div class="flex items-center gap-1.5 flex-1">
                        <span class="text-[9px] text-text-dim w-10">CPU</span>
                        <div class="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                          <div
                            class={`h-full rounded-full ${barColor(n.cpuPercent!)}`}
                            style={{ width: `${n.cpuPercent}%` }}
                          />
                        </div>
                        <span class="text-[9px] font-mono text-text-muted w-8 text-right">
                          {n.cpuPercent!.toFixed(0)}%
                        </span>
                      </div>
                    </Show>
                    <Show when={n.memPercent != null}>
                      <div class="flex items-center gap-1.5 flex-1">
                        <span class="text-[9px] text-text-dim w-10">MEM</span>
                        <div class="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                          <div
                            class={`h-full rounded-full ${barColor(n.memPercent!)}`}
                            style={{ width: `${n.memPercent}%` }}
                          />
                        </div>
                        <span class="text-[9px] font-mono text-text-muted w-8 text-right">
                          {n.memPercent!.toFixed(0)}%
                        </span>
                      </div>
                    </Show>
                  </div>

                  {/* GPU sparkline */}
                  <Show when={hist().length >= 2}>
                    <div class="flex items-center gap-1 pt-0.5 border-t border-white/5">
                      <span class="text-[8px] text-text-dim">GPU trend</span>
                      <Sparkline data={hist()} width={80} height={14} color="#22d3ee" />
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>

          {/* Non-GPU Nodes */}
          <For each={nonGpuNodes()}>
            {(n) => (
              <div class="rounded-md bg-white/5 p-2 space-y-1">
                <div class="flex items-center gap-2">
                  <span
                    class={`w-1.5 h-1.5 rounded-full ${n.ready ? 'bg-status-ok' : 'bg-status-error'}`}
                  />
                  <span class="text-xs font-mono text-text-main">{n.node}</span>
                </div>
                <div class="flex gap-3">
                  <Show when={n.cpuPercent != null}>
                    <div class="flex items-center gap-1.5 flex-1">
                      <span class="text-[9px] text-text-dim w-8">CPU</span>
                      <div class="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div
                          class={`h-full rounded-full ${barColor(n.cpuPercent!)}`}
                          style={{ width: `${n.cpuPercent}%` }}
                        />
                      </div>
                      <span class="text-[9px] font-mono text-text-muted w-7 text-right">
                        {n.cpuPercent!.toFixed(0)}%
                      </span>
                    </div>
                  </Show>
                  <Show when={n.memPercent != null}>
                    <div class="flex items-center gap-1.5 flex-1">
                      <span class="text-[9px] text-text-dim w-8">MEM</span>
                      <div class="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div
                          class={`h-full rounded-full ${barColor(n.memPercent!)}`}
                          style={{ width: `${n.memPercent}%` }}
                        />
                      </div>
                      <span class="text-[9px] font-mono text-text-muted w-7 text-right">
                        {n.memPercent!.toFixed(0)}%
                      </span>
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default NodeResourcePanel;
