import { Component, For, Show, createMemo, createResource } from 'solid-js';
import DetailPanel from '../shared/DetailPanel';
import { flexinferProxyMetrics } from '../../stores/flexinferOperational';
import { errorRateForModel } from '../Models/inferenceMetrics';
import { modelsApi } from '../../lib/api';
import type { FlexInferProxyModelMetrics, InferenceMetrics } from '../../lib/types';

export interface ModelTelemetryDrawerProps {
  model: string;
  /** Resolved CRD coordinates, when the proxy model maps to a known CRD. */
  crd?: { namespace: string; name: string };
  onClose: () => void;
}

function fmtLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

function fmtCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtRate(value: number | null | undefined, suffix = '/s'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value === 0) return `0${suffix}`;
  return `${value < 10 ? value.toFixed(2) : Math.round(value).toLocaleString()}${suffix}`;
}

interface MetricSpec {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}

const MetricGrid: Component<{ items: MetricSpec[] }> = (props) => (
  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
    <For each={props.items}>
      {(item) => (
        <div class="surface px-3 py-2.5">
          <div class="heading-label">{item.label}</div>
          <div class={`mt-1 font-mono text-base leading-none ${item.tone ?? 'text-text-main'}`}>{item.value}</div>
          <Show when={item.hint}>
            <div class="mt-1 text-[10px] text-text-dim">{item.hint}</div>
          </Show>
        </div>
      )}
    </For>
  </div>
);

const SectionLabel: Component<{ children: string }> = (props) => (
  <div class="mb-2 mt-1 text-[11px] font-semibold uppercase tracking-wide text-text-dim">{props.children}</div>
);

/**
 * Slide-up detail drawer for a single proxy model: live proxy counters and
 * latency percentiles (from byModel) plus the richer Prometheus per-model
 * inference series (TPS, queue-wait p95, cold-start, rejections) when the model
 * resolves to a known CRD. Routing/lifecycle counters get their own tab.
 */
const ModelTelemetryDrawer: Component<ModelTelemetryDrawerProps> = (props) => {
  const live = (): FlexInferProxyModelMetrics | undefined =>
    flexinferProxyMetrics()?.byModel?.[props.model];
  const errorRate = () => errorRateForModel(flexinferProxyMetrics(), props.model);

  const crdKey = () => (props.crd ? `${props.crd.namespace}/${props.crd.name}` : null);
  const [inference, { refetch }] = createResource<InferenceMetrics | null, string>(
    crdKey,
    async () => {
      const crd = props.crd;
      if (!crd) return null;
      return modelsApi.crdInference(crd.namespace, crd.name);
    },
  );

  const status = createMemo<'ok' | 'warn' | 'error' | 'running'>(() => {
    const m = live();
    const err = errorRate();
    if (err >= 0.05) return 'error';
    if (err > 0 || (m?.queueDepth || 0) >= 10) return 'warn';
    if ((m?.queueDepth || 0) > 0 || (m?.activeConnections || 0) > 0) return 'running';
    return 'ok';
  });

  const overviewMetrics = createMemo<MetricSpec[]>(() => {
    const m = live();
    const inf = inference();
    const items: MetricSpec[] = [
      { label: 'Requests', value: fmtCount(m?.requestsTotal) },
      {
        label: 'Error rate',
        value: `${(errorRate() * 100).toFixed(2)}%`,
        tone: errorRate() > 0 ? 'text-sem-warn' : 'text-text-main',
      },
      { label: 'Queue depth', value: fmtCount(m?.queueDepth), tone: (m?.queueDepth || 0) > 0 ? 'text-sem-warn' : 'text-text-main' },
      { label: 'Active conns', value: fmtCount(m?.activeConnections) },
      { label: 'p50 latency', value: fmtLatency(m?.latencyP50Ms) },
      { label: 'p95 latency', value: fmtLatency(m?.latencyP95Ms), tone: (m?.latencyP95Ms ?? 0) >= 2000 ? 'text-sem-warn' : 'text-text-main' },
      { label: 'p99 latency', value: fmtLatency(m?.latencyP99Ms) },
      { label: 'avg latency', value: fmtLatency(m?.latencyAvgMs) },
    ];
    if (inf) {
      items.push(
        { label: 'Throughput', value: fmtRate(inf.tps, ' tok/s'), hint: 'LiteLLM tokens' },
        { label: 'Requests/s', value: fmtRate(inf.requestsPerSec) },
        { label: 'Queue wait p95', value: fmtLatency(inf.queueWaitP95Ms) },
        { label: 'Rejected/s', value: fmtRate(inf.rejectedRequestsPerSec), tone: (inf.rejectedRequestsPerSec ?? 0) > 0 ? 'text-sem-warn' : 'text-text-main' },
        { label: 'Cold start p95', value: fmtLatency(inf.coldStartP95Ms) },
        { label: 'Scale-ups (5m)', value: fmtCount(inf.scaleUps5m) },
        { label: 'Activation retries (5m)', value: fmtCount(inf.activationRetries5m), tone: (inf.activationRetries5m ?? 0) > 0 ? 'text-sem-warn' : 'text-text-main' },
      );
    }
    return items;
  });

  const lifecycleMetrics = createMemo<MetricSpec[]>(() => {
    const m = live();
    return [
      { label: 'Routing decisions', value: fmtCount(m?.routingDecisionsTotal) },
      { label: 'Routing target hits', value: fmtCount(m?.routingTargetHitsTotal) },
      { label: 'Routing key cardinality', value: fmtCount(m?.routingKeyCardinality) },
      { label: 'Cardinality overflow', value: fmtCount(m?.routingKeyCardinalityOverflowTotal), tone: (m?.routingKeyCardinalityOverflowTotal || 0) > 0 ? 'text-sem-warn' : 'text-text-main' },
      { label: 'Rate limited', value: fmtCount(m?.rateLimitedTotal), tone: (m?.rateLimitedTotal || 0) > 0 ? 'text-sem-warn' : 'text-text-main' },
      { label: 'Queue rejected', value: fmtCount(m?.queueRejectedTotal), tone: (m?.queueRejectedTotal || 0) > 0 ? 'text-sem-warn' : 'text-text-main' },
      { label: 'Queued requests', value: fmtCount(m?.queuedRequestsTotal) },
      { label: 'Scale-ups (total)', value: fmtCount(m?.scaleUps) },
      { label: 'Activation retries', value: fmtCount(m?.activationRetriesTotal) },
      { label: 'Activation failures', value: fmtCount(m?.activationFailuresTotal), tone: (m?.activationFailuresTotal || 0) > 0 ? 'text-sem-crit' : 'text-text-main' },
      { label: 'Endpoints', value: fmtCount(m?.endpointCount) },
      { label: 'Endpoint changes', value: fmtCount(m?.endpointChangesTotal) },
      { label: 'GPU-group swaps', value: fmtCount(m?.gpuGroupSwapSignalsTotal) },
      { label: 'GPU-group queued', value: fmtCount(m?.gpuGroupQueuedRequestsTotal) },
    ];
  });

  const rawPayload = createMemo(() =>
    JSON.stringify({ proxy: live() ?? null, inference: inference() ?? null }, null, 2),
  );

  return (
    <DetailPanel
      title={props.model}
      subtitle={props.crd ? `${props.crd.namespace}/${props.crd.name}` : 'proxy model · no CRD match'}
      status={status()}
      onClose={props.onClose}
      actions={[{ label: 'Refresh', icon: '↻', onClick: () => void refetch() }]}
      tabs={[
        {
          id: 'overview',
          label: 'Overview',
          content: () => (
            <div class="space-y-4">
              <Show when={!live()}>
                <div class="surface px-3 py-2 text-xs text-text-dim">No live proxy metrics for this model.</div>
              </Show>
              <MetricGrid items={overviewMetrics()} />
              <Show when={props.crd && inference.loading}>
                <div class="text-xs text-text-dim">Loading Prometheus per-model detail…</div>
              </Show>
              <Show when={props.crd && inference.error}>
                <div class="rounded-md border border-status-error/20 bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
                  Per-model inference query failed.
                </div>
              </Show>
              <Show when={!props.crd}>
                <div class="text-[11px] text-text-dim">
                  Prometheus per-model detail (throughput, queue-wait, cold-start) needs a matching FlexInfer CRD; this
                  proxy model has no resolved CRD.
                </div>
              </Show>
              <Show when={inference()?.partial}>
                <div class="text-[11px] text-text-dim">
                  Some Prometheus series are unavailable: {inference()?.missingMetrics?.join(', ')}
                </div>
              </Show>
            </div>
          ),
        },
        {
          id: 'lifecycle',
          label: 'Routing & lifecycle',
          content: () => (
            <div class="space-y-3">
              <SectionLabel>Cumulative proxy counters</SectionLabel>
              <MetricGrid items={lifecycleMetrics()} />
            </div>
          ),
        },
        {
          id: 'raw',
          label: 'Raw',
          content: () => (
            <pre class="max-h-[40vh] overflow-auto rounded-md border border-white/5 bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-text-muted">
              {rawPayload()}
            </pre>
          ),
        },
      ]}
    />
  );
};

export default ModelTelemetryDrawer;
