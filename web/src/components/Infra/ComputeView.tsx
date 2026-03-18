import { Component, For, Show, createMemo } from 'solid-js';
import PulseCard from '../shared/PulseCard';
import type { ComputeSnapshot, NodeInfo } from './types';

interface Props {
  snapshot: ComputeSnapshot;
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function utilizationColor(pct: number): string {
  if (pct >= 90) return 'bg-status-error';
  if (pct >= 75) return 'bg-status-warn';
  if (pct >= 50) return 'bg-neon-cyan/70';
  return 'bg-status-ok';
}

function UtilBar(props: { value: number; max?: number }) {
  const width = createMemo(() => Math.min(100, Math.max(0, props.value)));
  return (
    <div class="relative h-1.5 w-full rounded-full bg-white/5">
      <div
        class={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${utilizationColor(props.value)}`}
        style={{ width: `${width()}%` }}
      />
    </div>
  );
}

const NodeRow: Component<{ node: NodeInfo }> = (props) => (
  <tr class="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
    <td class="py-2 pr-3">
      <div class="flex items-center gap-2">
        <span
          class={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${props.node.status === 'Ready' ? 'bg-status-ok' : 'bg-status-error'}`}
        />
        <span class="font-mono text-xs text-text-main truncate max-w-[140px]" title={props.node.name}>
          {props.node.name}
        </span>
      </div>
    </td>
    <td class="py-2 pr-3 w-24">
      <div class="flex flex-col gap-0.5">
        <span class="font-mono text-[11px] text-text-muted">{pct(props.node.cpuPct)}</span>
        <UtilBar value={props.node.cpuPct} />
      </div>
    </td>
    <td class="py-2 pr-3 w-24">
      <div class="flex flex-col gap-0.5">
        <span class="font-mono text-[11px] text-text-muted">{pct(props.node.memPct)}</span>
        <UtilBar value={props.node.memPct} />
      </div>
    </td>
    <td class="py-2 pr-3 w-24">
      <div class="flex flex-col gap-0.5">
        <span class="font-mono text-[11px] text-text-muted">
          {props.node.gpuVramTotalMi > 0 ? pct(props.node.gpuVramPct) : '—'}
        </span>
        <Show when={props.node.gpuVramTotalMi > 0}>
          <UtilBar value={props.node.gpuVramPct} />
        </Show>
      </div>
    </td>
    <td class="py-2 text-right">
      <span class="font-mono text-[11px] text-text-dim">{props.node.podCount}</span>
    </td>
  </tr>
);

const ComputeView: Component<Props> = (props) => {
  const snap = () => props.snapshot;
  const podDensity = createMemo(() => {
    const nodes = snap().nodes;
    if (!nodes.length) return 0;
    return Math.round(snap().totalPods / nodes.length);
  });

  return (
    <div class="flex flex-col gap-4">
      {/* KPI row */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PulseCard title="Cluster CPU" value={pct(snap().clusterCpuPct)} icon="⚙" color="cyan" />
        <PulseCard title="Cluster Mem" value={pct(snap().clusterMemPct)} icon="💾" color="purple" />
        <PulseCard
          title="GPU VRAM"
          value={snap().gpuVramPct > 0 ? pct(snap().gpuVramPct) : 'N/A'}
          icon="🖥"
          color="orange"
        />
        <PulseCard
          title="Pod Density"
          value={`${podDensity()}`}
          sub={`${snap().runningPods}/${snap().totalPods} running`}
          meta={`${snap().readyNodes}/${snap().totalNodes} nodes ready`}
          icon="📦"
          color="green"
        />
      </div>

      {/* Node table */}
      <div class="glass-panel overflow-hidden">
        <div class="border-b border-white/5 px-4 py-2.5">
          <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">Nodes</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b border-white/5">
                <th class="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Name</th>
                <th class="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">CPU</th>
                <th class="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Mem</th>
                <th class="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">GPU VRAM</th>
                <th class="py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-text-dim">Pods</th>
              </tr>
            </thead>
            <tbody class="px-4">
              <Show when={snap().nodes.length > 0} fallback={
                <tr><td colspan="5" class="px-4 py-6 text-center text-xs text-text-dim">No nodes</td></tr>
              }>
                <For each={snap().nodes}>
                  {(node) => (
                    <tr class="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td class="px-4 py-2 pr-3">
                        <div class="flex items-center gap-2">
                          <span
                            class={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${node.status === 'Ready' ? 'bg-status-ok' : 'bg-status-error'}`}
                          />
                          <span class="font-mono text-xs text-text-main truncate max-w-[160px]" title={node.name}>
                            {node.name}
                          </span>
                        </div>
                      </td>
                      <td class="py-2 pr-3 w-28">
                        <div class="flex flex-col gap-0.5">
                          <span class="font-mono text-[11px] text-text-muted">{pct(node.cpuPct)}</span>
                          <UtilBar value={node.cpuPct} />
                        </div>
                      </td>
                      <td class="py-2 pr-3 w-28">
                        <div class="flex flex-col gap-0.5">
                          <span class="font-mono text-[11px] text-text-muted">{pct(node.memPct)}</span>
                          <UtilBar value={node.memPct} />
                        </div>
                      </td>
                      <td class="py-2 pr-3 w-28">
                        <div class="flex flex-col gap-0.5">
                          <span class="font-mono text-[11px] text-text-muted">
                            {node.gpuVramTotalMi > 0 ? pct(node.gpuVramPct) : '—'}
                          </span>
                          <Show when={node.gpuVramTotalMi > 0}>
                            <UtilBar value={node.gpuVramPct} />
                          </Show>
                        </div>
                      </td>
                      <td class="py-2 pr-4 text-right">
                        <span class="font-mono text-[11px] text-text-dim">{node.podCount}</span>
                      </td>
                    </tr>
                  )}
                </For>
              </Show>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ComputeView;
