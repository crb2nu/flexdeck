import { batch, createSignal } from 'solid-js';
import { modelsApi, flexinferProxyApi, litellm } from '../lib/api';
import {
  clearAsyncValueState,
  completeAsyncValueState,
  createAsyncValueState,
  failAsyncValueState,
  resetAsyncValueState,
  startAsyncValueState,
} from '../lib/asyncState';
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

const REGISTRY_POLL_ID = 'flexinfer-registry-models';
const PROXY_POLL_ID = 'flexinfer-proxy-metrics';
const ROUTER_POLL_ID = 'flexinfer-router-info';
const CATALOG_POLL_ID = 'flexinfer-catalogs';
const CACHE_POLL_ID = 'flexinfer-caches';

const registryState = createAsyncValueState<RegisteredModel[]>([]);
const proxyMetricsState = createAsyncValueState<FlexInferProxyMetricsResponse | null>(null);
const proxyHealthState = createSignal<FlexInferProxyHealthState | null>(null);
const routerState = createAsyncValueState<LiteLLMRouterResponse | null>(null);
const catalogState = createAsyncValueState<ModelCatalogEntry[]>([]);
const cacheState = createAsyncValueState<ModelCache[]>([]);

let pollingConsumers = 0;

export function __resetFlexInferOperationalStoreForTests(): void {
  pollingConsumers = 0;
  pollingScheduler.unregister(REGISTRY_POLL_ID);
  pollingScheduler.unregister(PROXY_POLL_ID);
  pollingScheduler.unregister(ROUTER_POLL_ID);
  pollingScheduler.unregister(CATALOG_POLL_ID);
  pollingScheduler.unregister(CACHE_POLL_ID);

  batch(() => {
    resetAsyncValueState(registryState, []);
    resetAsyncValueState(proxyMetricsState, null);
    resetAsyncValueState(routerState, null);
    resetAsyncValueState(catalogState, []);
    resetAsyncValueState(cacheState, []);
    proxyHealthState[1](null);
  });
}

export async function refreshFlexInferRegistry(): Promise<void> {
  startAsyncValueState(registryState);
  try {
    const data = await modelsApi.list();
    completeAsyncValueState(registryState, data.models || []);
  } catch (err) {
    failAsyncValueState(registryState, err instanceof Error ? err.message : 'Failed to fetch models');
  }
}

export async function refreshFlexInferProxy(): Promise<void> {
  if (!healthStore.features?.flexinfer_proxy?.enabled) {
    batch(() => {
      clearAsyncValueState(proxyMetricsState, null);
      proxyHealthState[1](null);
    });
    return;
  }

  startAsyncValueState(proxyMetricsState);
  const [healthResult, metricsResult] = await Promise.allSettled([
    flexinferProxyApi.health(),
    flexinferProxyApi.metrics(),
  ]);

  batch(() => {
    proxyHealthState[1](healthResult.status === 'fulfilled' ? healthResult.value : null);

    if (metricsResult.status === 'fulfilled') {
      completeAsyncValueState(proxyMetricsState, metricsResult.value);
    } else {
      failAsyncValueState(
        proxyMetricsState,
        metricsResult.reason instanceof Error
          ? metricsResult.reason.message
          : 'Failed to fetch proxy metrics',
      );
    }
  });
}

export async function refreshFlexInferRouter(): Promise<void> {
  if (!healthStore.features?.flexinfer_proxy?.enabled) {
    clearAsyncValueState(routerState, null);
    return;
  }

  startAsyncValueState(routerState);
  try {
    const data = await litellm.router();
    completeAsyncValueState(routerState, data);
  } catch (err) {
    failAsyncValueState(routerState, err instanceof Error ? err.message : 'Failed to fetch router info');
  }
}

export async function refreshFlexInferCatalogs(): Promise<void> {
  startAsyncValueState(catalogState);
  try {
    const data = await modelsApi.catalogs();
    completeAsyncValueState(catalogState, data.catalogs || []);
  } catch (err) {
    failAsyncValueState(catalogState, err instanceof Error ? err.message : 'Failed to fetch catalogs');
  }
}

export async function refreshFlexInferCaches(): Promise<void> {
  if (!healthStore.features?.modelcache?.enabled) {
    clearAsyncValueState(cacheState, []);
    return;
  }

  startAsyncValueState(cacheState);
  try {
    const data = await modelsApi.cacheList();
    completeAsyncValueState(cacheState, data.caches || []);
  } catch (err) {
    failAsyncValueState(cacheState, err instanceof Error ? err.message : 'Failed to fetch caches');
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
