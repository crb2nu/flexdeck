import { Component, createSignal, createEffect, For, Show, createMemo } from 'solid-js';
import { modelsApi } from '../../lib/api';
import type { FlexInferModel, FlexInferModelListResponse, ModelComparisonData } from '../../lib/types';

const COLORS = ['text-neon-cyan', 'text-neon-purple', 'text-status-ok'];
const BG_COLORS = ['bg-neon-cyan', 'bg-neon-purple', 'bg-status-ok'];

const ModelComparison: Component = () => {
  const [models, setModels] = createSignal<FlexInferModel[]>([]);
  const [selected, setSelected] = createSignal<string[]>([]);
  const [viewMode, setViewMode] = createSignal<'table' | 'chart'>('table');
  const [gpuData, setGpuData] = createSignal<any[]>([]);

  createEffect(async () => {
    try {
      const [crd, gpu] = await Promise.all([
        modelsApi.crd('flexinfer-system'),
        fetch('/api/k8s/metrics/gpu/models').then(r => r.ok ? r.json() : { models: [] }),
      ]);
      setModels((crd as FlexInferModelListResponse).models || []);
      setGpuData(gpu.models || []);
    } catch { /* ignore */ }
  });

  const readyModels = createMemo(() => models().filter(m => m.status?.phase === 'Ready'));

  const toggleSelect = (name: string) => {
    const current = selected();
    if (current.includes(name)) {
      setSelected(current.filter(n => n !== name));
    } else if (current.length < 3) {
      setSelected([...current, name]);
    }
  };

  const comparisonData = createMemo((): ModelComparisonData[] => {
    return selected().map(name => {
      const model = models().find(m => m.name === name);
      const gpu = gpuData().find((g: any) => g.modelName === name);
      return {
        name,
        phase: model?.status?.phase || 'Unknown',
        throughput: model?.status?.metrics?.tokensPerSecond ? parseFloat(model.status.metrics.tokensPerSecond) : null,
        latencyMs: model?.status?.metrics?.avgLatencyMs ? parseFloat(model.status.metrics.avgLatencyMs) : null,
        gpuUtilization: gpu?.gpuUtilization ?? null,
        vramPercent: gpu?.vramUsedPercent ?? null,
        vramMB: model?.status?.gpu?.memoryMB ?? null,
        gpuNode: model?.status?.gpu?.node ?? null,
      };
    });
  });

  const metrics = [
    { key: 'throughput', label: 'Throughput (tok/s)', unit: 'tok/s', higher: true },
    { key: 'latencyMs', label: 'Avg Latency', unit: 'ms', higher: false },
    { key: 'gpuUtilization', label: 'GPU Utilization', unit: '%', higher: false },
    { key: 'vramPercent', label: 'VRAM Usage', unit: '%', higher: false },
  ] as const;

  const bestValue = (key: string, higher: boolean) => {
    const vals = comparisonData().map(d => (d as any)[key]).filter((v: any) => v !== null);
    if (vals.length === 0) return null;
    return higher ? Math.max(...vals) : Math.min(...vals);
  };

  return (
    <div class="flex flex-col gap-4">
      {/* Model selector */}
      <div class="glass-panel px-4 py-3">
        <div class="text-xs text-text-dim mb-2">Select 2-3 models to compare (Ready phase only):</div>
        <div class="flex flex-wrap gap-2">
          <For each={readyModels()}>
            {(model) => (
              <button
                class={`px-3 py-1 text-xs rounded-md border transition-all ${
                  selected().includes(model.name)
                    ? 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30'
                    : 'text-text-dim hover:bg-white/5 border-white/10'
                }`}
                onClick={() => toggleSelect(model.name)}
              >
                {model.name}
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={selected().length >= 2}>
        {/* View mode toggle */}
        <div class="flex gap-2">
          <button
            class={`px-3 py-1 text-xs rounded-md ${viewMode() === 'table' ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-text-dim'}`}
            onClick={() => setViewMode('table')}
          >Table</button>
          <button
            class={`px-3 py-1 text-xs rounded-md ${viewMode() === 'chart' ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-text-dim'}`}
            onClick={() => setViewMode('chart')}
          >Chart</button>
        </div>

        <Show when={viewMode() === 'table'}>
          <div class="glass-panel overflow-hidden">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-white/5 text-text-dim">
                  <th class="text-left px-4 py-2 font-medium">Metric</th>
                  <For each={comparisonData()}>
                    {(model, idx) => (
                      <th class={`text-right px-4 py-2 font-medium ${COLORS[idx()]}`}>
                        {model.name}
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                <For each={metrics}>
                  {(metric) => {
                    const best = bestValue(metric.key, metric.higher);
                    return (
                      <tr class="hover:bg-white/5">
                        <td class="px-4 py-2 text-text-dim">{metric.label}</td>
                        <For each={comparisonData()}>
                          {(model) => {
                            const val = (model as any)[metric.key];
                            const isBest = val !== null && val === best;
                            return (
                              <td class={`text-right px-4 py-2 font-mono ${
                                isBest ? 'text-status-ok font-medium' : 'text-text-dim'
                              }`}>
                                {val !== null ? `${val.toFixed(1)} ${metric.unit}` : '\u2014'}
                              </td>
                            );
                          }}
                        </For>
                      </tr>
                    );
                  }}
                </For>
                <tr class="hover:bg-white/5">
                  <td class="px-4 py-2 text-text-dim">GPU Node</td>
                  <For each={comparisonData()}>
                    {(model) => (
                      <td class="text-right px-4 py-2 font-mono text-text-dim">
                        {model.gpuNode || '\u2014'}
                      </td>
                    )}
                  </For>
                </tr>
              </tbody>
            </table>
          </div>
        </Show>

        <Show when={viewMode() === 'chart'}>
          <div class="glass-panel p-4 space-y-4">
            <For each={metrics}>
              {(metric) => {
                const vals = comparisonData().map(d => (d as any)[metric.key]).filter((v: any) => v !== null);
                const maxVal = vals.length > 0 ? Math.max(...vals) : 1;
                return (
                  <div>
                    <div class="text-xs text-text-dim mb-1">{metric.label}</div>
                    <div class="space-y-1">
                      <For each={comparisonData()}>
                        {(model, idx) => {
                          const val = (model as any)[metric.key];
                          const pct = val !== null && maxVal > 0 ? (val / maxVal) * 100 : 0;
                          return (
                            <div class="flex items-center gap-2">
                              <span class={`text-[10px] w-24 truncate ${COLORS[idx()]}`}>{model.name}</span>
                              <div class="flex-1 h-4 bg-white/5 rounded overflow-hidden">
                                <div
                                  class={`h-full ${BG_COLORS[idx()]} opacity-60 rounded transition-all`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span class="text-[10px] text-text-dim w-16 text-right font-mono">
                                {val !== null ? `${val.toFixed(1)}` : '\u2014'}
                              </span>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={selected().length < 2}>
        <div class="glass-panel flex items-center justify-center py-8">
          <div class="text-text-dim text-sm">Select at least 2 models to compare</div>
        </div>
      </Show>
    </div>
  );
};

export default ModelComparison;
