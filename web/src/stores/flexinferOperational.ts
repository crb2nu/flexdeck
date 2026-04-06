import { batch, createSignal } from 'solid-js';
import { modelsApi, flexinferProxyApi, litellm } from '../lib/api';
import type {
  FlexInferProxyMetricsResponse,
  LiteLLMRouterResponse,
  ModelCache,
  ModelCatalogEntry,
  RegisteredModel,
} from '../lib/types';
import { pollingScheduler } from '../lib/polling';
import { healthStore } from './health';

export interface FlexInferProxyHealthState {
  healthy?: boolean;
  status?: string;
  mode?: string;
  partial?: boolean;
  message?: string;
}

interface AsyncState<T> {
  value: () => T;
  setValue: (value: T) => void;
  loading: () => boolean;
  setLoading: (loading: boolean) => void;
  error: () => string;
  setError: (error: string) => void;
  updatedAt: () => number;
  setUpdatedAt: (updatedAt: number) => void;
}

function createAsyncState<T>(initialValue: T): AsyncState<T> {
  const [value, setValue] = createSignal<T>(initialValue);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [updatedAt, setUpdatedAt] = createSignal(0);

  return {
    value,
    setValue,
    loading,
    setLoading,
    error,
    setError,
    updatedAt,
    setUpdatedAt,
  };
}

function resetAsyncState<T>(state: AsyncState<T>, value: T): void {
  batch(() => {
    state.setValue(value);
    state.setLoading(true);
    state.setError('');
    state.setUpdatedAt(0);
  });
}

function clearAsyncState<T>(state: AsyncState<T>, value: T): void {
  batch(() => {
    state.setValue(value);
    state.setLoading(false);
    state.setError('');
    state.setUpdatedAt(0);
  });
}

function startAsyncState<T>(state: AsyncState<T>): void {
  state.setLoading(true);
}

function completeAsyncState<T>(state: AsyncState<T>, value: T): void {
  batch(() => {
    state.setValue(value);
    state.setError('');
    state.setUpdatedAt(Date.now());
    state.setLoading(false);
  });
}

function failAsyncState<T>(state: AsyncState<T>, error: string): void {
  batch(() => {
    state.setError(error);
    state.setLoading(false);
  });
}

const REGISTRY_POLL_ID = 'flexinfer-registry-models';
const PROXY_POLL_ID = 'flexinfer-proxy-metrics';
const ROUTER_POLL_ID = 'flexinfer-router-info';
const CATALOG_POLL_ID = 'flexinfer-catalogs';
const CACHE_POLL_ID = 'flexinfer-caches';

const registryState = createAsyncState<RegisteredModel[]>([]);
const proxyMetricsState = createAsyncState<FlexInferProxyMetricsResponse | null>(null);
const proxyHealthState = createSignal<FlexInferProxyHealthState | null>(null);
const routerState = createAsyncState<LiteLLMRouterResponse | null>(null);
const catalogState = createAsyncState<ModelCatalogEntry[]>([]);
const cacheState = createAsyncState<ModelCache[]>([]);

let pollingConsumers = 0;

export function __resetFlexInferOperationalStoreForTests(): void {
  pollingConsumers = 0;
  pollingScheduler.unregister(REGISTRY_POLL_ID);
  pollingScheduler.unregister(PROXY_POLL_ID);
  pollingScheduler.unregister(ROUTER_POLL_ID);
  pollingScheduler.unregister(CATALOG_POLL_ID);
  pollingScheduler.unregister(CACHE_POLL_ID);

  batch(() => {
    resetAsyncState(registryState, []);
    resetAsyncState(proxyMetricsState, null);
    resetAsyncState(routerState, null);
    resetAsyncState(catalogState, []);
    resetAsyncState(cacheState, []);
    proxyHealthState[1](null);
  });
}

export async function refreshFlexInferRegistry(): Promise<void> {
  startAsyncState(registryState);
  try {
    const data = await modelsApi.list();
    completeAsyncState(registryState, data.models || []);
  } catch (err) {
    failAsyncState(registryState, err instanceof Error ? err.message : 'Failed to fetch models');
  }
}

export async function refreshFlexInferProxy(): Promise<void> {
  if (!healthStore.features?.flexinfer_proxy?.enabled) {
    batch(() => {
      clearAsyncState(proxyMetricsState, null);
      proxyHealthState[1](null);
    });
    return;
  }

  startAsyncState(proxyMetricsState);
  const [healthResult, metricsResult] = await Promise.allSettled([
    flexinferProxyApi.health(),
    flexinferProxyApi.metrics(),
  ]);

  if (healthResult.status === 'fulfilled') {
    proxyHealthState[1](healthResult.value);
  } else {
    proxyHealthState[1](null);
  }

  if (metricsResult.status === 'fulfilled') {
    completeAsyncState(proxyMetricsState, metricsResult.value);
  } else {
    failAsyncState(
      proxyMetricsState,
      metricsResult.reason instanceof Error
        ? metricsResult.reason.message
        : 'Failed to fetch proxy metrics',
    );
  }
}

export async function refreshFlexInferRouter(): Promise<void> {
  if (!healthStore.features?.flexinfer_proxy?.enabled) {
    clearAsyncState(routerState, null);
    return;
  }

  startAsyncState(routerState);
  try {
    const data = await litellm.router();
    completeAsyncState(routerState, data);
  } catch (err) {
    failAsyncState(routerState, err instanceof Error ? err.message : 'Failed to fetch router info');
  }
}

export async function refreshFlexInferCatalogs(): Promise<void> {
  startAsyncState(catalogState);
  try {
    const data = await modelsApi.catalogs();
    completeAsyncState(catalogState, data.catalogs || []);
  } catch (err) {
    failAsyncState(catalogState, err instanceof Error ? err.message : 'Failed to fetch catalogs');
  }
}

export async function refreshFlexInferCaches(): Promise<void> {
  if (!healthStore.features?.modelcache?.enabled) {
    clearAsyncState(cacheState, []);
    return;
  }

  startAsyncState(cacheState);
  try {
    const data = await modelsApi.cacheList();
    completeAsyncState(cacheState, data.caches || []);
  } catch (err) {
    failAsyncState(cacheState, err instanceof Error ? err.message : 'Failed to fetch caches');
  }
}

export async function refreshFlexInferOperationalData(): Promise<void> {
  await Promise.all([
    refreshFlexInferRegistry(),
    refreshFlexInferProxy(),
    refreshFlexInferRouter(),
    refreshFlexInferCatalogs(),
    refreshFlexInferCaches(),
  ]);
}

export function startFlexInferOperationalPolling(): void {
  pollingConsumers += 1;
  if (pollingConsumers > 1) return;

  pollingScheduler.register(REGISTRY_POLL_ID, refreshFlexInferRegistry, 15_000);
  pollingScheduler.register(PROXY_POLL_ID, refreshFlexInferProxy, 15_000);
  pollingScheduler.register(ROUTER_POLL_ID, refreshFlexInferRouter, 30_000);
  pollingScheduler.register(CATALOG_POLL_ID, refreshFlexInferCatalogs, 60_000);
  pollingScheduler.register(CACHE_POLL_ID, refreshFlexInferCaches, 30_000);
}

export function stopFlexInferOperationalPolling(): void {
  pollingConsumers = Math.max(0, pollingConsumers - 1);
  if (pollingConsumers > 0) return;

  pollingScheduler.unregister(REGISTRY_POLL_ID);
  pollingScheduler.unregister(PROXY_POLL_ID);
  pollingScheduler.unregister(ROUTER_POLL_ID);
  pollingScheduler.unregister(CATALOG_POLL_ID);
  pollingScheduler.unregister(CACHE_POLL_ID);
}

export const flexinferCacheError = cacheState.error;
export const flexinferCacheLoading = cacheState.loading;
export const flexinferCacheUpdatedAt = cacheState.updatedAt;
export const flexinferCaches = cacheState.value;

export const flexinferCatalogError = catalogState.error;
export const flexinferCatalogLoading = catalogState.loading;
export const flexinferCatalogUpdatedAt = catalogState.updatedAt;
export const flexinferCatalogs = catalogState.value;

export const flexinferProxyError = proxyMetricsState.error;
export const flexinferProxyHealth = proxyHealthState[0];
export const flexinferProxyLoading = proxyMetricsState.loading;
export const flexinferProxyMetrics = proxyMetricsState.value;
export const flexinferProxyUpdatedAt = proxyMetricsState.updatedAt;

export const flexinferRegistryError = registryState.error;
export const flexinferRegistryLoading = registryState.loading;
export const flexinferRegistryModels = registryState.value;
export const flexinferRegistryUpdatedAt = registryState.updatedAt;

export const flexinferRouterError = routerState.error;
export const flexinferRouterInfo = routerState.value;
export const flexinferRouterLoading = routerState.loading;
export const flexinferRouterUpdatedAt = routerState.updatedAt;
