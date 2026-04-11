import { Component, For, Show, createMemo } from 'solid-js';
import PulseCard from '../shared/PulseCard';
import type { ComputeSnapshot, NodeCondition } from './types';

interface Props {
  snapshot: ComputeSnapshot;
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function utilizationColor(pct: number): string {
  if (pct >= 90) return 'bg-status-error';
  if (pct >= 75) return 'bg-status-warn';
  if (pct >= 50) return 'bg-white/40';
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

function pressureBadges(conditions?: NodeCondition[]) {
  if (!conditions) return null;
  const pressureTypes: Record<string, string> = {
    MemoryPressure: 'bg-status-warn text-black',
    DiskPressure: 'bg-status-error text-white',
    PIDPressure: 'bg-status-warn text-black',
  };
  const active = conditions.filter(
    (c) => pressureTypes[c.type] && c.status === 'True',
  );
  if (active.length === 0) return null;
  return active.map((c) => (
    <span
      class={`inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${pressureTypes[c.type]}`}
      title={c.message || c.type}
    >
      {c.type.replace('Pressure', '')}
    </span>
  ));
}

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

      {/* OOM banner */}
      <Show when={snap().oomKilledCount > 0}>
        <div class="surface flex items-start gap-3 border border-status-error/30 bg-status-error/5 p-3">
          <span class="text-status-error text-lg leading-none">!</span>
          <div>
            <div class="text-sm font-semibold text-status-error">
              {snap().oomKilledCount} OOMKilled container{snap().oomKilledCount > 1 ? 's' : ''} detected
            </div>
            <div class="mt-1 flex flex-wrap gap-1.5">
              <For each={snap().oomKilledPods ?? []}>
                {(pod) => (
                  <span class="inline-flex items-center gap-1 rounded bg-status-error/10 px-1.5 py-0.5 text-[10px] font-mono text-status-error">
                    {pod.namespace}/{pod.name}:{pod.container}
                    <span class="text-text-dim">on {pod.nodeName}</span>
                  </span>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* Node table */}
      <div class="surface overflow-hidden">
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
                          <span class="font-mono text-xs text-text-main truncate max-w-[140px]" title={node.name}>
                            {node.name}
                          </span>
                          {pressureBadges(node.conditions)}
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
