import type { FlexInferProxyMetricsResponse, FlexInferProxyModelMetrics } from '../../lib/types';

export function listInferenceModels(
  metrics: FlexInferProxyMetricsResponse | null | undefined
): string[] {
  const names = new Set<string>();

  for (const model of Object.keys(metrics?.byModel || {})) {
    if (model !== '_total') names.add(model);
  }
  for (const model of Object.keys(metrics?.requests || {})) {
    if (model !== '_total') names.add(model);
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export function hasProxyMetricsForModel(
  metrics: FlexInferProxyMetricsResponse | null | undefined,
  model: string
): boolean {
  if (!metrics || model === '_total') return false;
  return (
    metrics.byModel?.[model] != null ||
    metrics.requests?.[model] != null ||
    metrics.queue_depth?.[model] != null ||
    metrics.active_conn?.[model] != null ||
    metrics.requestsByStatus?.[model] != null
  );
}

export function findProxyMetricModel(
  metrics: FlexInferProxyMetricsResponse | null | undefined,
  candidates: Array<string | null | undefined>
): string | undefined {
  for (const candidate of candidates) {
    if (!candidate || candidate === '_total') continue;
    if (hasProxyMetricsForModel(metrics, candidate)) return candidate;
  }
  return undefined;
}

export function proxyMetricsForModel(
  metrics: FlexInferProxyMetricsResponse | null | undefined,
  model: string | null | undefined,
): FlexInferProxyModelMetrics | undefined {
  if (!metrics || !model || model === '_total') return undefined;
  return metrics.byModel?.[model];
}

export function requestsForModel(
  metrics: FlexInferProxyMetricsResponse | null | undefined,
  model: string
): number {
  const normalized = metrics?.byModel?.[model]?.requestsTotal;
  if (typeof normalized === 'number') return normalized;
  return metrics?.requests?.[model] ?? 0;
}

export function queueDepthForModel(
  metrics: FlexInferProxyMetricsResponse | null | undefined,
  model: string
): number {
  const normalized = metrics?.byModel?.[model]?.queueDepth;
  if (typeof normalized === 'number') return normalized;
  return metrics?.queue_depth?.[model] ?? 0;
}

export function activeConnectionsForModel(
  metrics: FlexInferProxyMetricsResponse | null | undefined,
  model: string
): number {
  const normalized = metrics?.byModel?.[model]?.activeConnections;
  if (typeof normalized === 'number') return normalized;
  return metrics?.active_conn?.[model] ?? 0;
}

export function errorRateForModel(
  metrics: FlexInferProxyMetricsResponse | null | undefined,
  model: string
): number {
  const statuses = metrics?.requestsByStatus?.[model] || {};
  let total = 0;
  let failed = 0;
  for (const [status, value] of Object.entries(statuses)) {
    total += value;
    if (status.startsWith('4') || status.startsWith('5')) {
      failed += value;
    }
  }
  if (total > 0) return failed / total;

  const requestsTotal = metrics?.byModel?.[model]?.requestsTotal ?? 0;
  const errorsTotal = metrics?.byModel?.[model]?.errorsTotal ?? 0;
  if (requestsTotal > 0) return errorsTotal / requestsTotal;

  return 0;
}
