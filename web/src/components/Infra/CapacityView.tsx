import { Component, For, Show, createMemo } from 'solid-js';
import PulseCard from '../shared/PulseCard';
import type { CapacitySnapshot, PressureItem } from './types';

interface Props {
  snapshot: CapacitySnapshot;
}

function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

function heatColor(pct: number): string {
  if (pct >= 90) return 'bg-status-error/80 text-white';
  if (pct >= 75) return 'bg-status-warn/70 text-white';
  if (pct >= 50) return 'bg-white/10 text-white';
  return 'bg-status-ok/20 text-status-ok';
}

function resourceIcon(resource: PressureItem['resource']): string {
  switch (resource) {
    case 'cpu': return '⚙';
    case 'memory': return '💾';
    case 'disk': return '💽';
    case 'gpu': return '🖥';
  }
}

function fmtEta(secs: number): string {
  if (secs <= 0) return 'already saturated';
  if (secs < 3600) return `~${Math.round(secs / 60)}m`;
  if (secs < 86400) return `~${(secs / 3600).toFixed(1)}h`;
  return `~${Math.floor(secs / 86400)}d`;
}

function trendIcon(dir: PressureItem['trendDirection']): string {
  if (dir === 'up') return '↑';
  if (dir === 'down') return '↓';
  return '→';
}

function trendColor(dir: PressureItem['trendDirection']): string {
  if (dir === 'up') return 'text-status-error';
  if (dir === 'down') return 'text-status-ok';
  return 'text-text-dim';
}

const HotNodeCell: Component<{ label: string; value: number }> = (props) => (
  <div class={`rounded px-2 py-1 text-center font-mono text-[10px] ${heatColor(props.value)}`}>
    <div class="font-semibold">{pct(props.value)}</div>
    <div class="opacity-70 text-[9px] uppercase">{props.label}</div>
  </div>
);

const CapacityView: Component<Props> = (props) => {
  const snap = () => props.snapshot;
  const criticalPressure = createMemo(() => snap().pressureItems.filter((p) => p.pct >= 80).length);
  const highEffWaste = createMemo(() =>
    snap().efficiencyByNs.filter((e) => e.cpuRequested > 0 && e.cpuActual / e.cpuRequested < 0.3).length
  );

  return (
    <div class="flex flex-col gap-4">
      {/* KPI row */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <PulseCard
          title="Critical Pressure"
          value={`${criticalPressure()}`}
          sub={`${snap().pressureItems.length} total pressure items`}
          icon="🔥"
          color={criticalPressure() > 0 ? 'orange' : 'green'}
        />
        <PulseCard
          title="Hot Nodes"
          value={`${snap().hotNodes.length}`}
          icon="🌡"
          color={snap().hotNodes.length > 0 ? 'orange' : 'cyan'}
        />
        <PulseCard
          title="Overprovisioned NS"
          value={`${highEffWaste()}`}
          sub="CPU requested vs actual < 30%"
          icon="📉"
          color={highEffWaste() > 0 ? 'orange' : 'green'}
        />
      </div>

      {/* Pressure items */}
      <Show when={snap().pressureItems.length > 0}>
        <div class="surface overflow-hidden">
          <div class="border-b border-white/5 px-4 py-2.5">
            <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Pressure Items
            </span>
          </div>
          <div class="divide-y divide-white/5">
            <For each={snap().pressureItems}>
              {(item) => (
                <div class="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors">
                  <span class="text-base">{resourceIcon(item.resource)}</span>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="font-mono text-xs text-text-main truncate">{item.node}</span>
                      <span class="font-mono text-[10px] uppercase text-text-dim">{item.resource}</span>
                    </div>
                    <div class="mt-1 h-1 w-full rounded-full bg-white/5">
                      <div
                        class={`h-1 rounded-full transition-all duration-500 ${item.pct >= 90 ? 'bg-status-error' : item.pct >= 75 ? 'bg-status-warn' : 'bg-white/40'}`}
                        style={{ width: `${Math.min(100, item.pct)}%` }}
                      />
                    </div>
                  </div>
                  <div class="text-right flex-shrink-0">
                    <div class="font-mono text-xs text-text-main">{pct(item.pct)}</div>
                    <div class={`font-mono text-[10px] ${trendColor(item.trendDirection)}`}>
                      {trendIcon(item.trendDirection)}{' '}
                      {item.etaSaturateSecs > 0 ? fmtEta(item.etaSaturateSecs) : 'stable'}
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Hot nodes heatmap */}
      <Show when={snap().hotNodes.length > 0}>
        <div class="surface p-4">
          <div class="mb-3">
            <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">Hot Nodes</span>
          </div>
          <div class="flex flex-col gap-3">
            <For each={snap().hotNodes}>
              {(node) => (
                <div class="flex items-center gap-3">
                  <span class="font-mono text-xs text-text-muted truncate w-32 flex-shrink-0">
                    {node.name}
                  </span>
                  <div class="flex flex-1 gap-2">
                    <HotNodeCell label="CPU" value={node.cpuPct} />
                    <HotNodeCell label="Mem" value={node.memPct} />
                    <HotNodeCell label="Disk" value={node.diskPct} />
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Namespace efficiency */}
      <Show when={snap().efficiencyByNs.length > 0}>
        <div class="surface overflow-hidden">
          <div class="border-b border-white/5 px-4 py-2.5">
            <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Allocation Efficiency by Namespace
            </span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left">
              <thead>
                <tr class="border-b border-white/5">
                  <th class="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Namespace</th>
                  <th class="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-dim">CPU Req</th>
                  <th class="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-dim">CPU Actual</th>
                  <th class="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-dim">Mem Req (Mi)</th>
                  <th class="py-2 pr-4 text-right text-[10px] font-semibold uppercase tracking-wider text-text-dim">Mem Actual (Mi)</th>
                </tr>
              </thead>
              <tbody>
                <For each={snap().efficiencyByNs}>
                  {(ns) => {
                    const cpuEff = ns.cpuRequested > 0 ? ns.cpuActual / ns.cpuRequested : 1;
                    const isWaste = cpuEff < 0.3;
                    return (
                      <tr class="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                        <td class="px-4 py-2 pr-3">
                          <div class="flex items-center gap-2">
                            <Show when={isWaste}>
                              <span class="text-status-warn text-[10px]">⚠</span>
                            </Show>
                            <span class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                              {ns.namespace}
                            </span>
                          </div>
                        </td>
                        <td class="py-2 pr-3 text-right">
                          <span class="font-mono text-xs text-text-muted">{ns.cpuRequested.toFixed(2)}</span>
                        </td>
                        <td class="py-2 pr-3 text-right">
                          <span class={`font-mono text-xs ${isWaste ? 'text-status-warn' : 'text-text-muted'}`}>
                            {ns.cpuActual.toFixed(2)}
                          </span>
                        </td>
                        <td class="py-2 pr-3 text-right">
                          <span class="font-mono text-xs text-text-muted">{ns.memRequestedMi.toFixed(0)}</span>
                        </td>
                        <td class="py-2 pr-4 text-right">
                          <span class="font-mono text-xs text-text-muted">{ns.memActualMi.toFixed(0)}</span>
                        </td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default CapacityView;
