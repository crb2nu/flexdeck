import { createSignal } from 'solid-js';
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

const REGISTRY_POLL_ID = 'flexinfer-registry-models';
const PROXY_POLL_ID = 'flexinfer-proxy-metrics';
const ROUTER_POLL_ID = 'flexinfer-router-info';
const CATALOG_POLL_ID = 'flexinfer-catalogs';
const CACHE_POLL_ID = 'flexinfer-caches';

const [registryModels, setRegistryModels] = createSignal<RegisteredModel[]>([]);
const [registryLoading, setRegistryLoading] = createSignal(true);
const [registryError, setRegistryError] = createSignal('');
const [registryUpdatedAt, setRegistryUpdatedAt] = createSignal(0);

const [proxyMetrics, setProxyMetrics] = createSignal<FlexInferProxyMetricsResponse | null>(null);
const [proxyHealth, setProxyHealth] = createSignal<FlexInferProxyHealthState | null>(null);
const [proxyLoading, setProxyLoading] = createSignal(true);
const [proxyError, setProxyError] = createSignal('');
const [proxyUpdatedAt, setProxyUpdatedAt] = createSignal(0);

const [routerInfo, setRouterInfo] = createSignal<LiteLLMRouterResponse | null>(null);
const [routerLoading, setRouterLoading] = createSignal(true);
const [routerError, setRouterError] = createSignal('');
const [routerUpdatedAt, setRouterUpdatedAt] = createSignal(0);

const [catalogs, setCatalogs] = createSignal<ModelCatalogEntry[]>([]);
const [catalogLoading, setCatalogLoading] = createSignal(true);
const [catalogError, setCatalogError] = createSignal('');
const [catalogUpdatedAt, setCatalogUpdatedAt] = createSignal(0);

const [caches, setCaches] = createSignal<ModelCache[]>([]);
const [cacheLoading, setCacheLoading] = createSignal(true);
const [cacheError, setCacheError] = createSignal('');
const [cacheUpdatedAt, setCacheUpdatedAt] = createSignal(0);

let pollingConsumers = 0;

export function __resetFlexInferOperationalStoreForTests(): void {
  pollingConsumers = 0;
  pollingScheduler.unregister(REGISTRY_POLL_ID);
  pollingScheduler.unregister(PROXY_POLL_ID);
  pollingScheduler.unregister(ROUTER_POLL_ID);
  pollingScheduler.unregister(CATALOG_POLL_ID);
  pollingScheduler.unregister(CACHE_POLL_ID);

  setRegistryModels([]);
  setRegistryLoading(true);
  setRegistryError('');
  setRegistryUpdatedAt(0);

  setProxyMetrics(null);
  setProxyHealth(null);
  setProxyLoading(true);
  setProxyError('');
  setProxyUpdatedAt(0);

  setRouterInfo(null);
  setRouterLoading(true);
  setRouterError('');
  setRouterUpdatedAt(0);

  setCatalogs([]);
  setCatalogLoading(true);
  setCatalogError('');
  setCatalogUpdatedAt(0);

  setCaches([]);
  setCacheLoading(true);
  setCacheError('');
  setCacheUpdatedAt(0);
}

export async function refreshFlexInferRegistry(): Promise<void> {
  setRegistryLoading(true);
  try {
    const data = await modelsApi.list();
    setRegistryModels(data.models || []);
    setRegistryError('');
    setRegistryUpdatedAt(Date.now());
  } catch (err) {
    setRegistryError(err instanceof Error ? err.message : 'Failed to fetch models');
  } finally {
    setRegistryLoading(false);
  }
}

export async function refreshFlexInferProxy(): Promise<void> {
  if (!healthStore.features?.flexinfer_proxy?.enabled) {
    setProxyMetrics(null);
    setProxyHealth(null);
    setProxyError('');
    setProxyLoading(false);
    return;
  }

  setProxyLoading(true);
  const [healthResult, metricsResult] = await Promise.allSettled([
    flexinferProxyApi.health(),
    flexinferProxyApi.metrics(),
  ]);

  if (healthResult.status === 'fulfilled') {
    setProxyHealth(healthResult.value);
  } else {
    setProxyHealth(null);
  }

  if (metricsResult.status === 'fulfilled') {
    setProxyMetrics(metricsResult.value);
    setProxyError('');
    setProxyUpdatedAt(Date.now());
  } else {
    setProxyMetrics(null);
    setProxyError(
      metricsResult.reason instanceof Error
        ? metricsResult.reason.message
        : 'Failed to fetch proxy metrics',
    );
  }

  setProxyLoading(false);
}

export async function refreshFlexInferRouter(): Promise<void> {
  if (!healthStore.features?.flexinfer_proxy?.enabled) {
    setRouterInfo(null);
    setRouterError('');
    setRouterLoading(false);
    return;
  }

  setRouterLoading(true);
  try {
    const data = await litellm.router();
    setRouterInfo(data);
    setRouterError('');
    setRouterUpdatedAt(Date.now());
  } catch (err) {
    setRouterInfo(null);
    setRouterError(err instanceof Error ? err.message : 'Failed to fetch router info');
  } finally {
    setRouterLoading(false);
  }
}

export async function refreshFlexInferCatalogs(): Promise<void> {
  setCatalogLoading(true);
  try {
    const data = await modelsApi.catalogs();
    setCatalogs(data.catalogs || []);
    setCatalogError('');
    setCatalogUpdatedAt(Date.now());
  } catch (err) {
    setCatalogError(err instanceof Error ? err.message : 'Failed to fetch catalogs');
  } finally {
    setCatalogLoading(false);
  }
}

export async function refreshFlexInferCaches(): Promise<void> {
  if (!healthStore.features?.modelcache?.enabled) {
    setCaches([]);
    setCacheError('');
    setCacheLoading(false);
    return;
  }

  setCacheLoading(true);
  try {
    const data = await modelsApi.cacheList();
    setCaches(data.caches || []);
    setCacheError('');
    setCacheUpdatedAt(Date.now());
  } catch (err) {
    setCacheError(err instanceof Error ? err.message : 'Failed to fetch caches');
  } finally {
    setCacheLoading(false);
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

export {
  cacheError as flexinferCacheError,
  cacheLoading as flexinferCacheLoading,
  cacheUpdatedAt as flexinferCacheUpdatedAt,
  caches as flexinferCaches,
  catalogError as flexinferCatalogError,
  catalogLoading as flexinferCatalogLoading,
  catalogs as flexinferCatalogs,
  catalogUpdatedAt as flexinferCatalogUpdatedAt,
  proxyError as flexinferProxyError,
  proxyHealth as flexinferProxyHealth,
  proxyLoading as flexinferProxyLoading,
  proxyMetrics as flexinferProxyMetrics,
  proxyUpdatedAt as flexinferProxyUpdatedAt,
  registryError as flexinferRegistryError,
  registryLoading as flexinferRegistryLoading,
  registryModels as flexinferRegistryModels,
  registryUpdatedAt as flexinferRegistryUpdatedAt,
  routerError as flexinferRouterError,
  routerInfo as flexinferRouterInfo,
  routerLoading as flexinferRouterLoading,
  routerUpdatedAt as flexinferRouterUpdatedAt,
};
