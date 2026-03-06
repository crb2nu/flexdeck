import { Component, createSignal, For, Show } from 'solid-js';
import { flexinferProxyApi, modelsApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import type {
  FlexInferProxyMetricsResponse,
  InferenceMetrics,
  LoRAAdapter,
} from '../../lib/types';
import { fetchModelIntegrationsBatch } from '../../lib/modelIntegration';
import {
  activeConnectionsForModel,
  errorRateForModel as proxyErrorRateForModel,
  listInferenceModels,
  queueDepthForModel,
  requestsForModel,
} from './inferenceMetrics';

type ReliabilityState = {
  label: 'Healthy' | 'Degraded' | 'Partial' | 'Unknown';
  tone: string;
};

const InferenceTab: Component = () => {
  const [proxyMetrics, setProxyMetrics] = createSignal<FlexInferProxyMetricsResponse | null>(null);
  const [proxyHealth, setProxyHealth] = createSignal<Record<string, unknown> | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [selectedModel, setSelectedModel] = createSignal<string | null>(null);
  const [modelMetrics, setModelMetrics] = createSignal<Record<string, InferenceMetrics>>({});
  const [modelAdapters, setModelAdapters] = createSignal<Record<string, LoRAAdapter[]>>({});
  const [knownModels, setKnownModels] = createSignal<string[]>([]);
  const [modelMetricsLoading, setModelMetricsLoading] = createSignal(false);
  const [aiNamespace, setAiNamespace] = createSignal('flexinfer-system');

  const fetchAllModelDetails = async (
    namespace: string,
    models: string[],
    namespaceByModel: Record<string, string>
  ) => {
    if (models.length === 0) {
      setModelMetrics({});
      setModelAdapters({});
      return;
    }

    setModelMetricsLoading(true);
    try {
      const nextMetrics: Record<string, InferenceMetrics> = {};
      const nextAdapters: Record<string, LoRAAdapter[]> = {};
      const integrations = await fetchModelIntegrationsBatch(
        models.map((model) => ({ namespace: namespaceByModel[model] || namespace, name: model })),
        { concurrency: 4 }
      );
      for (const model of models) {
        const integration = integrations[`${namespaceByModel[model] || namespace}/${model}`];
        if (!integration) continue;
        if (integration.metrics) {
          nextMetrics[model] = integration.metrics;
        }
        nextAdapters[model] = integration.adapters;
      }
      setModelMetrics(nextMetrics);
      setModelAdapters(nextAdapters);
    } finally {
      setModelMetricsLoading(false);
    }
  };

  const fetchAll = async () => {
    try {
      const [health, metrics, crdData] = await Promise.allSettled([
        flexinferProxyApi.health(),
        flexinferProxyApi.metrics(),
        modelsApi.crd(),
      ]);

      if (health.status === 'fulfilled') setProxyHealth(health.value);

      let namespace = aiNamespace();
      let crdModels: Array<{ namespace: string; name: string }> = [];
      if (crdData.status === 'fulfilled' && crdData.value?.namespace) {
        namespace = crdData.value.namespace;
        setAiNamespace(namespace);
        crdModels = Array.isArray(crdData.value.models) ? crdData.value.models : [];
      }

      let metricsData: FlexInferProxyMetricsResponse | null = null;
      if (metrics.status === 'fulfilled') {
        metricsData = metrics.value;
        setProxyMetrics(metrics.value);
      } else {
        setProxyMetrics(null);
      }

      const namespaceByModel: Record<string, string> = {};
      const crdModelNames = crdModels.map((model) => {
        namespaceByModel[model.name] = model.namespace || namespace;
        return model.name;
      });
      const proxyModels = listInferenceModels(metricsData);
      const models = Array.from(new Set([...crdModelNames, ...proxyModels])).sort((a, b) => a.localeCompare(b));
      setKnownModels(models);
      await fetchAllModelDetails(namespace, models, namespaceByModel);

      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch inference data');
    } finally {
      setLoading(false);
    }
  };

  createPolling('models-inference-tab', fetchAll, 30000);

  const modelNames = () => {
    return knownModels();
  };

  const requestsFor = (model: string) => requestsForModel(proxyMetrics(), model);
  const queueDepthFor = (model: string) => queueDepthForModel(proxyMetrics(), model);
  const activeConnFor = (model: string) => activeConnectionsForModel(proxyMetrics(), model);
  const detailFor = (model: string) => modelMetrics()[model];
  const adaptersFor = (model: string) => modelAdapters()[model] || [];
  const errorRateFor = (model: string) => detailFor(model)?.errorRate ?? proxyErrorRateForModel(proxyMetrics(), model);

  const reliabilityFor = (model: string): ReliabilityState => {
    const detail = detailFor(model);
    if (!detail) {
      return { label: 'Unknown', tone: 'bg-white/10 text-text-dim' };
    }
    if (detail.partial) {
      return { label: 'Partial', tone: 'bg-status-warn/20 text-status-warn' };
    }
    const err = detail.errorRate ?? 0;
    const rejected = detail.rejectedRequestsPerSec ?? 0;
    const queueDepth = detail.queueDepth ?? queueDepthFor(model);
    if (err > 0.02 || rejected > 0.01 || queueDepth > 0) {
      return { label: 'Degraded', tone: 'bg-status-error/20 text-status-error' };
    }
    return { label: 'Healthy', tone: 'bg-status-ok/20 text-status-ok' };
  };

  const selectedDetail = () => {
    const model = selectedModel();
    return model ? detailFor(model) : undefined;
  };
  const selectedAdapters = () => {
    const model = selectedModel();
    return model ? adaptersFor(model) : [];
  };

  const totalRequests = () => proxyMetrics()?.totals?.requestsTotal ?? 0;
  const totalQueueDepth = () => proxyMetrics()?.totals?.queueDepth ?? 0;

  return (
    <div class="flex flex-col gap-4">
      <Show when={error()}>
        <div class="glass-panel p-3 text-sm text-status-error">{error()}</div>
      </Show>

      <Show when={proxyMetrics()?.partial}>
        <div class="glass-panel p-3 text-xs text-status-warn">
          Partial proxy metrics: one or more lines could not be parsed completely.
        </div>
      </Show>

      <Show when={loading() && !proxyHealth()}>
        <div class="glass-panel flex items-center justify-center py-8">
          <div class="text-text-dim animate-pulse">Loading inference metrics...</div>
        </div>
      </Show>

      <Show when={proxyHealth()}>
        <div class="glass-panel px-4 py-3 flex items-center gap-6">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-status-ok" />
            <span class="text-sm font-medium text-text-main">FlexInfer Proxy</span>
          </div>
          <div class="flex gap-6 text-xs text-text-dim">
            <span>Total Requests: <span class="text-text-muted font-mono">{totalRequests().toFixed(0)}</span></span>
            <span>Models: <span class="text-text-muted font-mono">{modelNames().length}</span></span>
            <span>Total Queue: <span class="text-text-muted font-mono">{totalQueueDepth().toFixed(0)}</span></span>
          </div>
        </div>

        <div class="glass-panel overflow-hidden">
          <div class="px-4 py-2 border-b border-white/5 flex items-center justify-between">
            <span class="text-xs font-mono text-text-main uppercase tracking-wider">Per-Model Inference Metrics</span>
            <Show when={modelMetricsLoading()}>
              <span class="text-[10px] text-text-dim animate-pulse">Refreshing model detail...</span>
            </Show>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-white/5 text-text-dim">
                  <th class="px-4 py-2 text-left font-normal">Model</th>
                  <th class="px-4 py-2 text-right font-normal">Requests</th>
                  <th class="px-4 py-2 text-right font-normal">Queue</th>
                  <th class="px-4 py-2 text-right font-normal">Active Conn</th>
                  <th class="px-4 py-2 text-right font-normal">Error %</th>
                  <th class="px-4 py-2 text-right font-normal">Queue Wait p95</th>
                  <th class="px-4 py-2 text-right font-normal">Rejected/s</th>
                  <th class="px-4 py-2 text-right font-normal">Retries 5m</th>
                  <th class="px-4 py-2 text-center font-normal">Reliability</th>
                </tr>
              </thead>
              <tbody>
                <For each={modelNames()} fallback={
                  <tr><td colspan="9" class="px-4 py-4 text-center text-text-dim">No model metrics available</td></tr>
                }>
                  {(model) => {
                    const detail = () => detailFor(model);
                    const reliability = () => reliabilityFor(model);
                    return (
                      <tr
                        class={`border-b border-white/5 cursor-pointer transition-colors ${
                          selectedModel() === model ? 'bg-neon-cyan/5' : 'hover:bg-white/5'
                        }`}
                        onClick={() => setSelectedModel(selectedModel() === model ? null : model)}
                      >
                        <td class="px-4 py-2 font-mono text-text-main">{model}</td>
                        <td class="px-4 py-2 text-right font-mono text-text-muted">{requestsFor(model).toFixed(0)}</td>
                        <td class="px-4 py-2 text-right font-mono text-text-muted">{queueDepthFor(model).toFixed(0)}</td>
                        <td class="px-4 py-2 text-right font-mono text-text-muted">{activeConnFor(model).toFixed(0)}</td>
                        <td class="px-4 py-2 text-right font-mono text-text-muted">{(errorRateFor(model) * 100).toFixed(2)}%</td>
                        <td class="px-4 py-2 text-right font-mono text-text-muted">
                          {detail()?.queueWaitP95Ms != null ? `${detail()!.queueWaitP95Ms!.toFixed(0)} ms` : '-'}
                        </td>
                        <td class="px-4 py-2 text-right font-mono text-text-muted">
                          {detail()?.rejectedRequestsPerSec != null ? detail()!.rejectedRequestsPerSec!.toFixed(3) : '-'}
                        </td>
                        <td class="px-4 py-2 text-right font-mono text-text-muted">
                          {detail()?.activationRetries5m != null ? detail()!.activationRetries5m!.toFixed(2) : '-'}
                        </td>
                        <td class="px-4 py-2 text-center">
                          <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${reliability().tone}`}>
                            {reliability().label}
                          </span>
                        </td>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </div>

        <Show when={selectedModel()}>
          <div class="glass-panel p-4">
            <div class="flex items-center justify-between mb-3">
              <span class="text-sm font-medium text-neon-cyan font-mono">{selectedModel()}</span>
              <Show when={modelMetricsLoading()}>
                <div class="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
              </Show>
            </div>

            <Show when={selectedDetail()} fallback={<div class="text-xs text-text-dim">No Prometheus metrics available for this model</div>}>
              <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Metric label="TPS" value={`${(selectedDetail()?.tps ?? 0).toFixed(2)}`} />
                <Metric label="p95 Latency" value={`${(selectedDetail()?.p95LatencyMs ?? 0).toFixed(1)} ms`} />
                <Metric label="Error Rate" value={`${((selectedDetail()?.errorRate ?? 0) * 100).toFixed(2)}%`} />
                <Metric label="Queue Wait p95" value={`${(selectedDetail()?.queueWaitP95Ms ?? 0).toFixed(0)} ms`} />
                <Metric label="Scale Ups (5m)" value={`${(selectedDetail()?.scaleUps5m ?? 0).toFixed(2)}`} />
              </div>
              <Show when={selectedDetail()?.partial}>
                <div class="mt-3 rounded border border-status-warn/30 bg-status-warn/10 px-3 py-2 text-[11px] text-status-warn">
                  Partial model metrics.
                  <Show when={(selectedDetail()?.missingMetrics?.length || 0) > 0}>
                    <span class="ml-1 text-text-dim">
                      Missing: {(selectedDetail()?.missingMetrics || []).join(', ')}
                    </span>
                  </Show>
                </div>
              </Show>
            </Show>

            <div class="mt-4 border-t border-white/5 pt-3">
              <div class="text-[10px] text-text-dim uppercase tracking-wider mb-2">LoRA Adapters</div>
              <Show when={selectedAdapters().length > 0} fallback={<div class="text-xs text-text-dim">No adapters loaded for this model</div>}>
                <div class="flex flex-col gap-2">
                  <For each={selectedAdapters()}>
                    {(adapter) => (
                      <div class="rounded bg-white/5 border border-white/5 px-3 py-2 flex items-center justify-between gap-2">
                        <div class="min-w-0">
                          <div class="text-xs font-mono text-text-main truncate">{adapter.name}</div>
                          <div class="text-[10px] text-text-dim truncate">{adapter.adapterSource}</div>
                        </div>
                        <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          adapter.state === 'Loaded'
                            ? 'bg-status-ok/20 text-status-ok'
                            : adapter.state === 'Pending'
                              ? 'bg-status-warn/20 text-status-warn'
                              : 'bg-neon-purple/20 text-neon-purple'
                        }`}>
                          {adapter.state}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
};

const Metric: Component<{ label: string; value: string }> = (props) => (
  <div>
    <div class="text-[10px] text-text-dim uppercase">{props.label}</div>
    <div class="text-sm font-mono text-text-main">{props.value}</div>
  </div>
);

export default InferenceTab;
