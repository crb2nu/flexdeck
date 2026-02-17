import { Component, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { flexinferProxyApi, modelsApi } from '../../lib/api';

const InferenceTab: Component = () => {
  const [proxyMetrics, setProxyMetrics] = createSignal<any>(null);
  const [proxyHealth, setProxyHealth] = createSignal<any>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [selectedModel, setSelectedModel] = createSignal<string | null>(null);
  const [modelMetrics, setModelMetrics] = createSignal<any>(null);
  const [modelMetricsLoading, setModelMetricsLoading] = createSignal(false);
  const [aiNamespace, setAiNamespace] = createSignal('flexinfer-system');

  const fetchAll = async () => {
    try {
      const [health, metrics, crdData] = await Promise.allSettled([
        flexinferProxyApi.health(),
        flexinferProxyApi.metrics(),
        modelsApi.crd(),
      ]);

      if (health.status === 'fulfilled') setProxyHealth(health.value);
      if (metrics.status === 'fulfilled') setProxyMetrics(metrics.value);
      if (crdData.status === 'fulfilled' && crdData.value?.namespace) setAiNamespace(crdData.value.namespace);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch inference data');
    } finally {
      setLoading(false);
    }
  };

  const fetchModelDetail = async (model: string) => {
    setModelMetricsLoading(true);
    try {
      const data = await modelsApi.crdInference(aiNamespace(), model);
      setModelMetrics(data);
    } catch {
      setModelMetrics(null);
    } finally {
      setModelMetricsLoading(false);
    }
  };

  createEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    onCleanup(() => clearInterval(interval));
  });

  createEffect(() => {
    const model = selectedModel();
    if (model) fetchModelDetail(model);
  });

  const requests = () => proxyMetrics()?.requests as Record<string, number> | undefined;
  const queueDepth = () => proxyMetrics()?.queue_depth as Record<string, number> | undefined;
  const activeConn = () => proxyMetrics()?.active_conn as Record<string, number> | undefined;

  const modelNames = () => {
    const r = requests();
    if (!r) return [];
    return Object.keys(r).filter(k => k !== '_total');
  };

  const totalRequests = () => {
    const r = requests();
    return r?._total ?? Object.values(r || {}).reduce((a: number, b: number) => a + b, 0);
  };

  return (
    <div class="flex flex-col gap-4">
      <Show when={error()}>
        <div class="glass-panel p-3 text-sm text-status-error">{error()}</div>
      </Show>

      <Show when={loading() && !proxyHealth()}>
        <div class="glass-panel flex items-center justify-center py-8">
          <div class="text-text-dim animate-pulse">Loading inference metrics...</div>
        </div>
      </Show>

      <Show when={proxyHealth()}>
        {/* Summary strip */}
        <div class="glass-panel px-4 py-3 flex items-center gap-6">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-status-ok" />
            <span class="text-sm font-medium text-text-main">FlexInfer Proxy</span>
          </div>
          <div class="flex gap-6 text-xs text-text-dim">
            <span>Total Requests: <span class="text-text-muted font-mono">{totalRequests().toFixed(0)}</span></span>
            <span>Models: <span class="text-text-muted font-mono">{modelNames().length}</span></span>
          </div>
        </div>

        {/* Per-model table */}
        <div class="glass-panel overflow-hidden">
          <div class="px-4 py-2 border-b border-white/5">
            <span class="text-xs font-mono text-text-main uppercase tracking-wider">Per-Model Inference Metrics</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-white/5 text-text-dim">
                  <th class="px-4 py-2 text-left font-normal">Model</th>
                  <th class="px-4 py-2 text-right font-normal">Requests</th>
                  <th class="px-4 py-2 text-right font-normal">Queue</th>
                  <th class="px-4 py-2 text-right font-normal">Active Conn</th>
                </tr>
              </thead>
              <tbody>
                <For each={modelNames()} fallback={
                  <tr><td colspan="4" class="px-4 py-4 text-center text-text-dim">No model metrics available</td></tr>
                }>
                  {(model) => (
                    <tr
                      class={`border-b border-white/5 cursor-pointer transition-colors ${
                        selectedModel() === model ? 'bg-neon-cyan/5' : 'hover:bg-white/5'
                      }`}
                      onClick={() => setSelectedModel(selectedModel() === model ? null : model)}
                    >
                      <td class="px-4 py-2 font-mono text-text-main">{model}</td>
                      <td class="px-4 py-2 text-right font-mono text-text-muted">
                        {(requests()?.[model] ?? 0).toFixed(0)}
                      </td>
                      <td class="px-4 py-2 text-right font-mono text-text-muted">
                        {(queueDepth()?.[model] ?? 0).toFixed(0)}
                      </td>
                      <td class="px-4 py-2 text-right font-mono text-text-muted">
                        {(activeConn()?.[model] ?? 0).toFixed(0)}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>

        {/* Model detail panel */}
        <Show when={selectedModel()}>
          <div class="glass-panel p-4">
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-medium text-neon-cyan font-mono">{selectedModel()}</span>
              <Show when={modelMetricsLoading()}>
                <div class="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
              </Show>
            </div>
            <Show when={modelMetrics()} fallback={
              <div class="text-xs text-text-dim">No Prometheus metrics available for this model</div>
            }>
              <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div class="text-[10px] text-text-dim uppercase">TPS</div>
                  <div class="text-sm font-mono text-text-main">{(modelMetrics()?.tps ?? 0).toFixed(2)}</div>
                </div>
                <div>
                  <div class="text-[10px] text-text-dim uppercase">p95 Latency</div>
                  <div class="text-sm font-mono text-text-main">{(modelMetrics()?.p95LatencyMs ?? 0).toFixed(1)} ms</div>
                </div>
                <div>
                  <div class="text-[10px] text-text-dim uppercase">Queue Depth</div>
                  <div class="text-sm font-mono text-text-main">{(modelMetrics()?.queueDepth ?? 0).toFixed(0)}</div>
                </div>
                <div>
                  <div class="text-[10px] text-text-dim uppercase">Active Connections</div>
                  <div class="text-sm font-mono text-text-main">{(modelMetrics()?.activeConnections ?? 0).toFixed(0)}</div>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default InferenceTab;
