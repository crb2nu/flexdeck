import { Component, For, Show, createMemo } from 'solid-js';
import PulseCard from '../shared/PulseCard';
import type { StorageSnapshot } from './types';

interface Props {
  snapshot: StorageSnapshot;
}

function robustnessColor(r?: string): string {
  if (!r) return 'text-text-dim';
  const lower = r.toLowerCase();
  if (lower === 'healthy') return 'text-status-ok';
  if (lower === 'degraded') return 'text-status-warn';
  if (lower === 'faulted') return 'text-status-error';
  return 'text-text-dim';
}

function phaseColor(phase: string): string {
  if (phase === 'Bound') return 'text-status-ok';
  if (phase === 'Pending') return 'text-status-warn';
  if (phase === 'Lost') return 'text-status-error';
  return 'text-text-dim';
}

const StorageView: Component<Props> = (props) => {
  const snap = () => props.snapshot;
  const usedGi = createMemo(() => snap().usedCapacityGi.toFixed(1));
  const totalGi = createMemo(() => snap().totalCapacityGi.toFixed(1));
  const usedPct = createMemo(() => {
    if (snap().totalCapacityGi === 0) return 0;
    return (snap().usedCapacityGi / snap().totalCapacityGi) * 100;
  });

  return (
    <div class="flex flex-col gap-4">
      {/* KPI row */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <PulseCard
          title="Total Capacity"
          value={`${totalGi()} Gi`}
          sub={`${usedGi()} Gi used (${usedPct().toFixed(0)}%)`}
          icon="💽"
          color="cyan"
        />
        <PulseCard
          title="Volumes"
          value={`${snap().totalVolumes}`}
          sub={`${snap().degradedVolumes} degraded`}
          icon="📀"
          color={snap().degradedVolumes > 0 ? 'orange' : 'green'}
        />
        <PulseCard
          title="PVCs"
          value={`${snap().pvcs.length}`}
          sub={`${snap().pvcs.filter((p) => p.phase === 'Bound').length} bound`}
          icon="🗄"
          color="purple"
        />
      </div>

      {/* PVC table */}
      <div class="surface overflow-hidden">
        <div class="border-b border-white/5 px-4 py-2.5">
          <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Persistent Volume Claims
          </span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b border-white/5">
                <th class="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Name</th>
                <th class="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Namespace</th>
                <th class="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Capacity</th>
                <th class="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Storage Class</th>
                <th class="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Phase</th>
                <th class="py-2 pr-4 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Longhorn</th>
              </tr>
            </thead>
            <tbody>
              <Show
                when={snap().pvcs.length > 0}
                fallback={
                  <tr>
                    <td colspan="6" class="px-4 py-6 text-center text-xs text-text-dim">
                      No PVCs
                    </td>
                  </tr>
                }
              >
                <For each={snap().pvcs}>
                  {(pvc) => (
                    <tr class="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                      <td class="px-4 py-2 pr-3">
                        <span class="font-mono text-xs text-text-main">{pvc.name}</span>
                      </td>
                      <td class="py-2 pr-3">
                        <span class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                          {pvc.namespace}
                        </span>
                      </td>
                      <td class="py-2 pr-3">
                        <span class="font-mono text-xs text-text-muted">
                          {pvc.capacityGi > 0 ? `${pvc.capacityGi.toFixed(0)} Gi` : pvc.capacity || '—'}
                        </span>
                      </td>
                      <td class="py-2 pr-3">
                        <span class="font-mono text-[10px] text-text-dim">{pvc.storageClass || '—'}</span>
                      </td>
                      <td class="py-2 pr-3">
                        <span class={`font-mono text-xs ${phaseColor(pvc.phase)}`}>{pvc.phase}</span>
                      </td>
                      <td class="py-2 pr-4">
                        <span class={`font-mono text-xs ${robustnessColor(pvc.longhornRobustness)}`}>
                          {pvc.longhornRobustness || '—'}
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
    </div>
  );
};

export default StorageView;
