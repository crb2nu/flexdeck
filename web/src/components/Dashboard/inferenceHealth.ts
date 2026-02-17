import type { FlexInferProxyMetricsResponse } from '../../lib/types';

export interface InferenceHealthSummary {
  totalTps: number;
  modelCount: number;
  queueDepth: number;
  error: string;
}

export function buildInferenceHealthSummary(
  data: FlexInferProxyMetricsResponse | null | undefined
): InferenceHealthSummary {
  const totals = data?.totals;
  const byModel = data?.byModel || {};
  const derivedModelCount = Object.keys(byModel).filter((name) => name !== '_total').length;
  const modelCount =
    totals && typeof totals.modelCount === 'number' && totals.modelCount > 0
      ? totals.modelCount
      : derivedModelCount;

  return {
    totalTps: totals?.requestsTotal ?? 0,
    modelCount,
    queueDepth: totals?.queueDepth ?? 0,
    error: data?.partial ? 'partial data' : '',
  };
}
