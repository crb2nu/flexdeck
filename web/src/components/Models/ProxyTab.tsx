import { Component, createSignal, For, Show } from 'solid-js';
import { flexinferProxyApi } from '../../lib/api/infrastructure';
import { createPolling } from '../../hooks/createPolling';
import { resolveFreshness } from '../../lib/freshness';
import type { FlexInferProxyMetricsResponse, FlexInferProxyModelMetrics } from '../../lib/types';

const ProxyTab: Component = () => {
  const [metrics, setMetrics] = createSignal<FlexInferProxyMetricsResponse | null>(null);
  const [health, setHealth] = createSignal<any>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [lastUpdated, setLastUpdated] = createSignal(0);
  const freshness = () => resolveFreshness(lastUpdated(), 15_000);

  const fetchData = async () => {
    try {
      const [metricsData, healthData] = await Promise.all([
        flexinferProxyApi.metrics(),
        flexinferProxyApi.health().catch(() => null),
      ]);
      setMetrics(metricsData);
      setHealth(healthData);
      setError('');
      setLastUpdated(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch proxy metrics');
    } finally {
      setLoading(false);
    }
  };

  createPolling('models-proxy-metrics', fetchData, 15_000);

  const modelEntries = () => {
    const m = metrics();
    if (!m?.byModel) return [];
    return Object.entries(m.byModel).sort(([a], [b]) => a.localeCompare(b));
  };

  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  return (
    <div class="flex flex-col gap-4">
      <Show when={error()}>
        <div class="glass-panel p-4 text-sm text-status-error">{error()}</div>
      </Show>

      <Show when={loading() && !metrics()}>
        <div class="glass-panel flex items-center justify-center py-12">
          <div class="text-center">
            <div class="mb-4 text-4xl animate-pulse text-neon-cyan">&#x2B21;</div>
            <p class="text-text-dim">Loading proxy metrics...</p>
          </div>
        </div>
      </Show>

      <Show when={metrics()}>
        {/* Health + Summary Row */}
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryCard
            label="Health"
            value={health()?.status === 'ok' ? 'OK' : health()?.status || 'Unknown'}
            color={health()?.status === 'ok' ? 'text-status-ok' : 'text-status-warn'}
          />
          <SummaryCard label="Models" value={String(metrics()!.totals?.modelCount ?? 0)} color="text-neon-cyan" />
          <SummaryCard label="Total Requests" value={fmt(metrics()!.totals?.requestsTotal ?? 0)} color="text-text-main" />
          <SummaryCard
            label="Error Rate"
            value={`${((metrics()!.totals?.errorRate ?? 0) * 100).toFixed(2)}%`}
            color={(metrics()!.totals?.errorRate ?? 0) > 0.05 ? 'text-status-error' : 'text-status-ok'}
          />
          <SummaryCard label="Active Conns" value={String(metrics()!.totals?.activeConnections ?? 0)} color="text-neon-purple" />
          <SummaryCard label="Scale Ups" value={String(metrics()!.totals?.scaleUps ?? 0)} color="text-status-warn" />
        </div>

        {/* Per-model table */}
        <div class="glass-panel overflow-hidden">
          <div class="px-4 py-3 border-b border-white/5">
            <h3 class="text-sm font-medium text-text-main">Per-Model Metrics</h3>
          </div>
          <Show
            when={modelEntries().length > 0}
            fallback={
              <div class="p-6 text-center text-sm text-text-dim">
                No per-model metrics available
              </div>
            }
          >
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-white/5 text-left text-text-dim">
                    <th class="px-4 py-2 font-medium">Model</th>
                    <th class="px-4 py-2 font-medium text-right">Requests</th>
                    <th class="px-4 py-2 font-medium text-right">Errors</th>
                    <th class="px-4 py-2 font-medium text-right">Queue</th>
                    <th class="px-4 py-2 font-medium text-right">Connections</th>
                    <th class="px-4 py-2 font-medium text-right">Scale Ups</th>
                    <th class="px-4 py-2 font-medium text-right">Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={modelEntries()}>
                    {([name, m]) => (
                      <ProxyModelRow name={name} metrics={m} />
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </div>

        <Show when={metrics()!.partial}>
          <div class="glass-panel p-3 text-xs text-status-warn border border-status-warn/20">
            Metrics are partial — some proxy endpoints may be unreachable.
          </div>
        </Show>
      </Show>
    </div>
  );
};

const SummaryCard: Component<{ label: string; value: string; color: string }> = (props) => (
  <div class="glass-panel p-3">
    <div class="text-[10px] font-medium uppercase tracking-wider text-text-dim">{props.label}</div>
    <div class={`mt-1 text-xl font-mono font-medium ${props.color}`}>{props.value}</div>
  </div>
);

const ProxyModelRow: Component<{ name: string; metrics: FlexInferProxyModelMetrics }> = (props) => {
  const errorRate = () => {
    const total = props.metrics.requestsTotal;
    if (total === 0) return 0;
    return props.metrics.errorsTotal / total;
  };

  return (
    <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
      <td class="px-4 py-2 font-mono text-text-main">{props.name}</td>
      <td class="px-4 py-2 text-right font-mono text-text-muted">{props.metrics.requestsTotal}</td>
      <td class={`px-4 py-2 text-right font-mono ${errorRate() > 0.05 ? 'text-status-error' : 'text-text-muted'}`}>
        {props.metrics.errorsTotal}
        <Show when={errorRate() > 0}>
          <span class="ml-1 text-[10px] opacity-60">({(errorRate() * 100).toFixed(1)}%)</span>
        </Show>
      </td>
      <td class={`px-4 py-2 text-right font-mono ${props.metrics.queueDepth > 5 ? 'text-status-warn' : 'text-text-muted'}`}>
        {props.metrics.queueDepth}
      </td>
      <td class="px-4 py-2 text-right font-mono text-text-muted">{props.metrics.activeConnections}</td>
      <td class="px-4 py-2 text-right font-mono text-text-muted">{props.metrics.scaleUps}</td>
      <td class={`px-4 py-2 text-right font-mono ${props.metrics.queueRejectedTotal > 0 ? 'text-status-error' : 'text-text-muted'}`}>
        {props.metrics.queueRejectedTotal}
      </td>
    </tr>
  );
};

export default ProxyTab;
