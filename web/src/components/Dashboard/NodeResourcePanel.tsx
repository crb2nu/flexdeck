import { Component, createMemo, createSignal, createEffect, For, Show } from 'solid-js';
import { dashboardSummary, dashboardSummaryLoading, dashboardSummaryError } from '../../stores/dashboardSummary';
import { k8sStore, isNodeReady } from '../../stores/k8s';
import Sparkline from '../shared/Sparkline';
import { stablePanelStatusClasses, useStablePanelState } from '../shared/useStablePanelState';

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

const HISTORY_SIZE = 12;

function pushHist(arr: number[], val: number | null): number[] {
  if (val == null) return arr;
  const next = [...arr, val];
  return next.length > HISTORY_SIZE ? next.slice(next.length - HISTORY_SIZE) : next;
}

const NodeResourcePanel: Component = () => {
  const [nodes, setNodes] = createSignal<NodeResources[]>([]);
  const [gpuHistory, setGpuHistory] = createSignal<Record<string, number[]>>({});
  const loading = () => dashboardSummaryLoading();
  const error = () => dashboardSummaryError() != null && nodes().every((n) => n.cpuPercent == null && n.memPercent == null);
  const stablePanel = useStablePanelState({
    value: () => ({
      nodes: nodes(),
      gpuHistory: gpuHistory(),
    }),
    loading,
    error,
    signature: (snapshot) => snapshot.nodes
      .map((node) => `${node.node}:${node.ready ? 1 : 0}:${Math.round(node.cpuPercent ?? -1)}:${Math.round(node.memPercent ?? -1)}:${Math.round(node.gpu?.utilization ?? -1)}`)
      .join('|'),
  });
  const displayNodes = createMemo(() => stablePanel.effectiveValue().nodes);
  const displayGpuHistory = createMemo(() => stablePanel.effectiveValue().gpuHistory);

  // Derive node resources from the server-side dashboard summary
  createEffect(() => {
    const summary = dashboardSummary();
    const k8sNodes = Array.isArray(k8sStore.nodes) ? k8sStore.nodes : [];
    if (!summary || k8sNodes.length === 0) return;

    const normalizeNodeName = (value: string): string =>
      value.toLowerCase().trim().split(':')[0].split('.')[0];

    const matchNode = (metricNode: string, nodeName: string): boolean => {
      const metricNorm = normalizeNodeName(metricNode);
      const nodeNorm = normalizeNodeName(nodeName);
      return metricNorm === nodeNorm || metricNorm.includes(nodeNorm) || nodeNorm.includes(metricNorm);
    };

    const findSummaryNode = (nodeName: string) =>
      summary.nodes.find((sn) => matchNode(sn.node, nodeName));

    const nextNodes: NodeResources[] = k8sNodes.map((n) => {
      const name = n.metadata.name;
      const sn = findSummaryNode(name);

      return {
        node: name,
        ready: isNodeReady(n),
        cpuPercent: sn?.cpu_percent ?? null,
        memPercent: sn?.mem_percent ?? null,
        gpu: sn?.gpu
          ? {
              node: name,
              gpuCount: sn.gpu.count,
              utilization: sn.gpu.utilization,
              vramUsed: sn.gpu.vram_used,
              vramTotal: sn.gpu.vram_total,
              temperature: sn.gpu.temperature,
              powerWatts: sn.gpu.power_watts,
            }
          : null,
      };
    });

    setNodes(nextNodes);

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
  });

  const formatBytes = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  const barColor = (pct: number) =>
    pct > 90 ? 'bg-status-error' : pct > 70 ? 'bg-status-warn' : 'bg-status-ok';

  const gpuNodes = () => displayNodes().filter((n) => n.gpu != null);
  const nonGpuNodes = () => displayNodes().filter((n) => n.gpu == null);

  return (
    <div class="glass-panel p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <h3 class="text-xs font-bold uppercase tracking-widest text-text-main">
            Node Resources
          </h3>
          <Show when={stablePanel.status()}>
            {(status) => (
              <span class={`rounded-full border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider ${stablePanelStatusClasses(status())}`}>
                {status()}
              </span>
            )}
          </Show>
        </div>
        <span class="text-[10px] text-text-dim">
          {displayNodes().length} nodes · {gpuNodes().length} GPU
        </span>
      </div>

      <Show when={stablePanel.showBlockingLoading()}>
        <div class="flex items-center justify-center py-6">
          <div class="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
        </div>
      </Show>

      <Show when={stablePanel.showBlockingError()}>
        <div class="text-xs text-status-warn text-center py-4">
          No node metrics available. Check Prometheus connectivity.
        </div>
      </Show>

      <Show when={stablePanel.hasStableValue() || (!loading() && !error())}>
        <div class={`relative space-y-2 transition-opacity duration-300 ${stablePanel.isRefreshing() ? 'opacity-90' : 'opacity-100'}`}>
          <div class={`pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20 transition-opacity duration-150 ${stablePanel.isRefreshing() ? 'opacity-100' : 'opacity-0'}`} />
          <Show when={error() && stablePanel.hasStableValue()}>
            <div class="rounded-md border border-status-warn/10 bg-status-warn/5 px-2 py-1 text-[10px] text-status-warn/90">
              Metrics refresh delayed. Showing last good snapshot.
            </div>
          </Show>
          {/* GPU Nodes first */}
          <For each={gpuNodes()}>
            {(n) => {
              const gpu = () => n.gpu!;
              const vramPct = () =>
                gpu().vramUsed != null && gpu().vramTotal != null && gpu().vramTotal! > 0
                  ? (gpu().vramUsed! / gpu().vramTotal!) * 100
                  : null;
              const hist = () => displayGpuHistory()[n.node] || [];

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
                      <span class="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-text-dim font-medium">
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
                      <span class="text-[9px] font-mono text-text-dim w-8 text-right">
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
                          class={`h-full rounded-full transition-all ${vramPct()! > 90 ? 'bg-status-error' : 'bg-white/40'}`}
                          style={{ width: `${vramPct()}%` }}
                        />
                      </div>
                      <span class="text-[9px] font-mono text-text-dim w-8 text-right">
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
