import type {
  FlexInferProxyMetricsResponse,
  ModelCache,
  ModelCatalogEntry,
  RegisteredModel,
} from './types';

export interface FlexInferModelCountState {
  deployed: number;
  total: number;
  loading: boolean;
  error: string;
}

export interface FlexInferInferenceHealthState {
  totalTps: number;
  modelCount: number;
  queueDepth: number;
  loading: boolean;
  error: string;
}

export interface FlexInferSupplyChainSummary {
  catalogCount: number;
  catalogModelCount: number;
  cacheCount: number;
  readyCacheCount: number;
  failedCacheCount: number;
}

export interface InferenceHealthSummary {
  totalTps: number;
  modelCount: number;
  queueDepth: number;
  error: string;
}

export function buildInferenceHealthSummary(
  data: FlexInferProxyMetricsResponse | null | undefined,
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

export function buildFlexInferModelCountState(
  models: RegisteredModel[],
  loading: boolean,
  error: string,
): FlexInferModelCountState {
  return {
    deployed: models.filter((model) => model.deployment_status === 'deployed').length,
    total: models.length,
    loading,
    error,
  };
}

export function buildFlexInferInferenceHealthState(
  enabled: boolean,
  metrics: FlexInferProxyMetricsResponse | null | undefined,
  loading: boolean,
  error: string,
): FlexInferInferenceHealthState {
  if (!enabled) {
    return {
      totalTps: 0,
      modelCount: 0,
      queueDepth: 0,
      loading: false,
      error: '',
    };
  }

  const summary = buildInferenceHealthSummary(metrics);
  return {
    totalTps: summary.totalTps,
    modelCount: summary.modelCount,
    queueDepth: summary.queueDepth,
    loading,
    error: error || summary.error,
  };
}

export function buildFlexInferSupplyChainSummary(
  catalogs: ModelCatalogEntry[],
  caches: ModelCache[],
): FlexInferSupplyChainSummary {
  return {
    catalogCount: catalogs.length,
    catalogModelCount: catalogs.reduce((sum, catalog) => sum + (catalog.models?.length || 0), 0),
    cacheCount: caches.length,
    readyCacheCount: caches.filter((cache) => cache.status?.phase === 'Ready').length,
    failedCacheCount: caches.filter((cache) => cache.status?.phase === 'Failed').length,
  };
}
