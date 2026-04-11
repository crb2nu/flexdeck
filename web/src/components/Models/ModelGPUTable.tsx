import { Component, createSignal, For, onMount, Show } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { api } from '../../lib/api';
import Sparkline from '../shared/Sparkline';
import {
  aggregateModelGPUEntries,
  hasAnyGPUData,
  type AggregatedModelGPUEntry,
  type ModelGPUEntry,
} from './modelGpuTableUtils';

interface ModelGPUHistory {
  utilization: number[];
  vram: number[];
}

const POLL_INTERVAL = 15_000;
const HISTORY_SIZE = 20;

function pushHistory(arr: number[], val: number | null): number[] {
  if (val == null) return arr;
  const next = [...arr, val];
  return next.length > HISTORY_SIZE ? next.slice(next.length - HISTORY_SIZE) : next;
}

function utilColor(val: number): string {
  if (val >= 80) return 'text-status-error';
  if (val >= 50) return 'text-text-muted';
  return 'text-status-ok';
}

const ModelGPUTable: Component = () => {
  const [models, setModels] = createSignal<AggregatedModelGPUEntry[]>([]);
  const [historyMap, setHistoryMap] = createSignal<Record<string, ModelGPUHistory>>({});
  const [error, setError] = createSignal(false);

  const fetchData = async () => {
    try {
      const data = await api<{ models: ModelGPUEntry[] }>('/k8s/metrics/gpu/models');
      const entries = data.models || [];
      const aggregated = aggregateModelGPUEntries(entries);
      setModels(aggregated);
      setError(false);

      setHistoryMap(prev => {
        const next = { ...prev };
        for (const m of aggregated) {
          const key = `${m.modelName}@${m.node}`;
          const existing = next[key] || { utilization: [], vram: [] };
          next[key] = {
            utilization: pushHistory(existing.utilization, m.gpuUtilization),
            vram: pushHistory(existing.vram, m.vramUsedPercent),
          };
        }
        return next;
      });
    } catch {
      setError(true);
    }
  };

  onMount(() => {
    void fetchData();
  });

  createPolling('gpu-models', fetchData, POLL_INTERVAL);

  return (
    <Show when={!error() && models().length > 0}>
      <div class="surface p-4">
        <div class="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-2">
          GPU Usage by Model
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-text-dim border-b border-white/5">
                <th class="text-left py-1.5 pr-3 font-medium">Model</th>
                <th class="text-left py-1.5 pr-3 font-medium">Node</th>
                <th class="text-right py-1.5 pr-3 font-medium">Pods</th>
                <th class="text-right py-1.5 pr-3 font-medium">GPU Util</th>
                <th class="text-right py-1.5 pr-3 font-medium">VRAM</th>
                <th class="text-right py-1.5 pr-3 font-medium">Temp</th>
                <th class="text-right py-1.5 pr-3 font-medium">Power</th>
                <th class="text-center py-1.5 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              <For each={models()}>
                {(m) => {
                  const hist = () => historyMap()[`${m.modelName}@${m.node}`];
                  return (
                    <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td class="py-1.5 pr-3 font-mono text-text-main truncate max-w-[160px]">
                        {m.modelName}
                      </td>
                      <td class="py-1.5 pr-3 font-mono text-text-dim truncate max-w-[120px]">
                        {m.node}
                      </td>
                      <td class="py-1.5 pr-3 text-right font-mono text-text-muted">
                        {m.replicas}
                      </td>
                      <td class="py-1.5 pr-3 text-right font-mono">
                        <Show when={m.gpuUtilization != null} fallback={<span class="text-text-dim">-</span>}>
                          <span class={utilColor(m.gpuUtilization!)}>{m.gpuUtilization!.toFixed(0)}%</span>
                        </Show>
                      </td>
                      <td class="py-1.5 pr-3 text-right font-mono">
                        <Show when={m.vramUsedPercent != null} fallback={<span class="text-text-dim">-</span>}>
                          <span class={m.vramUsedPercent! > 90 ? 'text-status-error' : 'text-text-dim'}>
                            {m.vramUsedPercent!.toFixed(0)}%
                          </span>
                        </Show>
                      </td>
                      <td class="py-1.5 pr-3 text-right font-mono">
                        <Show when={m.temperature != null} fallback={<span class="text-text-dim">-</span>}>
                          <span class={m.temperature! > 85 ? 'text-status-error' : 'text-text-muted'}>
                            {m.temperature!.toFixed(0)}°C
                          </span>
                        </Show>
                      </td>
                      <td class="py-1.5 pr-3 text-right font-mono">
                        <Show when={m.power != null} fallback={<span class="text-text-dim">-</span>}>
                          <span class="text-text-muted">{m.power!.toFixed(0)}W</span>
                        </Show>
                      </td>
                      <td class="py-1.5 text-center">
                        <Show when={hist()?.utilization?.length >= 2}>
                          <Sparkline data={hist()!.utilization} width={50} height={14} color="#22d3ee" />
                        </Show>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
        <Show when={!hasAnyGPUData(models())}>
          <div class="mt-2 text-[11px] text-status-warn">
            GPU telemetry is unavailable for current model nodes. Check DCGM/ROCm exporters and Prometheus scrape targets.
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default ModelGPUTable;
