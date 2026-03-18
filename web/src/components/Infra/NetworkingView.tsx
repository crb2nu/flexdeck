import { Component, For, Show } from 'solid-js';
import PulseCard from '../shared/PulseCard';
import type { NetworkingSnapshot } from './types';

interface Props {
  snapshot: NetworkingSnapshot;
}

function errorRateColor(rate: number): string {
  if (rate >= 0.05) return 'text-status-error bg-status-error/10 border-status-error/20';
  if (rate >= 0.01) return 'text-status-warn bg-status-warn/10 border-status-warn/20';
  return 'text-status-ok bg-status-ok/10 border-status-ok/20';
}

function fmtRps(rps: number): string {
  if (rps >= 1000) return `${(rps / 1000).toFixed(1)}k`;
  return rps.toFixed(1);
}

function fmtMs(ms: number): string {
  if (ms === 0) return '—';
  return `${ms.toFixed(0)}ms`;
}

const NetworkingView: Component<Props> = (props) => {
  const snap = () => props.snapshot;

  return (
    <div class="flex flex-col gap-4">
      {/* KPI row */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <PulseCard
          title="Total RPS"
          value={fmtRps(snap().totalRps)}
          icon="🌐"
          color="cyan"
        />
        <PulseCard
          title="P99 Latency"
          value={fmtMs(snap().p99Ms)}
          icon="⏱"
          color="purple"
        />
        <PulseCard
          title="Error Rate"
          value={`${(snap().errorRate * 100).toFixed(2)}%`}
          icon="⚠"
          color={snap().errorRate >= 0.01 ? 'orange' : 'green'}
        />
      </div>

      {/* Ingress table */}
      <div class="glass-panel overflow-hidden">
        <div class="border-b border-white/5 px-4 py-2.5">
          <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">Ingresses</span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b border-white/5">
                <th class="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Host</th>
                <th class="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Namespace</th>
                <th class="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-dim">RPS</th>
                <th class="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-dim">P95</th>
                <th class="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-dim">P99</th>
                <th class="py-2 pr-4 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Errors</th>
              </tr>
            </thead>
            <tbody>
              <Show
                when={snap().ingresses.length > 0}
                fallback={
                  <tr>
                    <td colspan="6" class="px-4 py-6 text-center text-xs text-text-dim">
                      No ingresses
                    </td>
                  </tr>
                }
              >
                <For each={snap().ingresses}>
                  {(ing) => (
                    <tr class="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td class="px-4 py-2 pr-3">
                        <div class="flex flex-col gap-0.5">
                          <span class="font-mono text-xs text-text-main">{ing.name}</span>
                          <Show when={ing.hosts.length > 0}>
                            <span class="font-mono text-[10px] text-text-dim truncate max-w-[200px]">
                              {ing.hosts[0]}
                            </span>
                          </Show>
                        </div>
                      </td>
                      <td class="py-2 pr-3">
                        <span class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                          {ing.namespace}
                        </span>
                      </td>
                      <td class="py-2 pr-3 text-right">
                        <span class="font-mono text-xs text-text-muted">{fmtRps(ing.rps)}</span>
                      </td>
                      <td class="py-2 pr-3 text-right">
                        <span class="font-mono text-xs text-text-muted">{fmtMs(ing.p95Ms)}</span>
                      </td>
                      <td class="py-2 pr-3 text-right">
                        <span class="font-mono text-xs text-text-muted">{fmtMs(ing.p99Ms)}</span>
                      </td>
                      <td class="py-2 pr-4">
                        <span
                          class={`rounded-full border px-1.5 py-0.5 font-mono text-[10px] ${errorRateColor(ing.errorRate)}`}
                        >
                          {(ing.errorRate * 100).toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  )}
                </For>
              </Show>
            </tbody>
          </table>
        </div>
      </div>

      {/* Policy gaps */}
      <Show when={snap().policyGaps.length > 0}>
        <div class="glass-panel p-4">
          <div class="mb-3 flex items-center gap-2">
            <span class="text-status-warn">⚠</span>
            <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Network Policy Gaps ({snap().policyGaps.length})
            </span>
          </div>
          <div class="flex flex-wrap gap-2">
            <For each={snap().policyGaps}>
              {(ns) => (
                <span class="rounded border border-status-warn/20 bg-status-warn/10 px-2 py-0.5 font-mono text-[11px] text-status-warn">
                  {ns}
                </span>
              )}
            </For>
          </div>
          <p class="mt-2 text-[11px] text-text-dim">
            These namespaces have no ingress or egress NetworkPolicy configured.
          </p>
        </div>
      </Show>
    </div>
  );
};

export default NetworkingView;
