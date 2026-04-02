/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const workbenchMocks = vi.hoisted(() => {
  const healthFeatures = {
    flexinfer_proxy: { enabled: true },
    modelcache: { enabled: true },
  };

  const controllerState = {
    error: '',
    loading: false,
    controllerDataLoading: false,
    crdModels: [
      {
        name: 'alpha',
        namespace: 'flexinfer-system',
        spec: {
          source: 'hf://alpha',
          serverless: { enabled: true },
          gpu: { shared: 1 },
          cache: { strategy: 'shared' },
        },
        status: {
          phase: 'Ready',
          cache: { strategy: 'shared', ready: true, jobPhase: 'Ready' },
        },
      },
    ],
    registryModels: [
      {
        id: 'alpha',
        name: 'alpha',
        source: 'huggingface',
        source_id: 'hf/alpha',
        source_url: 'https://huggingface.co/hf/alpha',
        type: 'llm',
        description: 'alpha',
        tags: [],
        size: 1,
        local_path: '/models/alpha',
        download_status: 'completed',
        download_progress: 100,
        deployment_status: 'deployed',
        replicas: 1,
        created_at: '2026-03-29T00:00:00Z',
        updated_at: '2026-03-29T00:00:00Z',
      },
    ],
    searchResults: [],
    reliabilitySummary: { healthy: 1, degraded: 0, partial: 0, unknown: 0 },
    integrationSummary: { inferenceUnavailable: 0, loraUnavailable: 0 },
    phaseSummary: { Ready: 1, Failed: 0 },
    loraSummary: { loaded: 0, total: 0 },
    inferenceByModel: {},
    loraByModel: {},
    throughputByModel: {},
    integrationByModel: {},
  };

  const storeState = {
    proxyMetrics: {
      requests: {},
      latency: {},
      queue_depth: {},
      active_conn: {},
      scale_ups: {},
      byModel: {},
      totals: {
        modelCount: 0,
        requestsTotal: 0,
        errorsTotal: 0,
        queueDepth: 0,
        activeConnections: 0,
        scaleUps: 0,
        queueRejectedTotal: 0,
        queuedRequestsTotal: 0,
        errorRate: 0,
        parseErrors: 0,
      },
      requestsByStatus: {},
      partial: false,
    },
    proxyHealth: { healthy: true, status: 'Healthy' },
    proxyLoading: false,
    proxyError: '',
    proxyUpdatedAt: Date.now(),
    routerInfo: { healthy: true, modelInfo: [] },
    routerLoading: false,
    routerError: '',
    routerUpdatedAt: Date.now(),
    catalogs: [],
    catalogLoading: false,
    catalogError: '',
    catalogUpdatedAt: Date.now(),
    caches: [],
    cacheLoading: false,
    cacheError: '',
    cacheUpdatedAt: Date.now(),
  };

  return {
    healthFeatures,
    controllerState,
    storeState,
    discoverModels: vi.fn(async () => {}),
    fetchCRDModels: vi.fn(async () => {}),
    fetchRegistryModels: vi.fn(async () => {}),
    handleCRDAction: vi.fn(async () => {}),
    handleDelete: vi.fn(async () => {}),
    handleRegister: vi.fn(async () => {}),
    handleSearch: vi.fn(async () => {}),
    handleStartDownload: vi.fn(async () => {}),
    refreshCaches: vi.fn(async () => {}),
    refreshCatalogs: vi.fn(async () => {}),
    refreshOperationalData: vi.fn(async () => {}),
    refreshProxy: vi.fn(async () => {}),
    refreshRouter: vi.fn(async () => {}),
    setSearchQuery: vi.fn(),
    setSearchSource: vi.fn(),
    startPolling: vi.fn(),
    stopPolling: vi.fn(),
  };
});

vi.mock('../../stores/health', () => ({
  healthStore: {
    features: workbenchMocks.healthFeatures,
  },
}));

vi.mock('../../lib/featureFlags', () => ({
  getFlexInferManagementMode: () => 'hybrid',
}));

vi.mock('../Models/useModelsController', () => ({
  useModelsController: () => ({
    actionLoading: () => null,
    controllerDataLoading: () => workbenchMocks.controllerState.controllerDataLoading,
    crdActionLoading: () => null,
    crdModels: () => workbenchMocks.controllerState.crdModels,
    discoverLoading: () => false,
    discoverModels: workbenchMocks.discoverModels,
    error: () => workbenchMocks.controllerState.error,
    fetchCRDModels: workbenchMocks.fetchCRDModels,
    fetchRegistryModels: workbenchMocks.fetchRegistryModels,
    handleCRDAction: workbenchMocks.handleCRDAction,
    handleDelete: workbenchMocks.handleDelete,
    handleRegister: workbenchMocks.handleRegister,
    handleSearch: workbenchMocks.handleSearch,
    handleStartDownload: workbenchMocks.handleStartDownload,
    inferenceByModel: () => workbenchMocks.controllerState.inferenceByModel,
    integrationByModel: () => workbenchMocks.controllerState.integrationByModel,
    integrationSummary: () => workbenchMocks.controllerState.integrationSummary,
    loading: () => workbenchMocks.controllerState.loading,
    loraByModel: () => workbenchMocks.controllerState.loraByModel,
    loraSummary: () => workbenchMocks.controllerState.loraSummary,
    phaseSummary: () => workbenchMocks.controllerState.phaseSummary,
    refreshModels: vi.fn(async () => {}),
    registryModels: () => workbenchMocks.controllerState.registryModels,
    reliabilitySummary: () => workbenchMocks.controllerState.reliabilitySummary,
    searchQuery: () => '',
    searchResults: () => workbenchMocks.controllerState.searchResults,
    searchSource: () => 'huggingface',
    searching: () => false,
    setSearchQuery: workbenchMocks.setSearchQuery,
    setSearchSource: workbenchMocks.setSearchSource,
    throughputByModel: () => workbenchMocks.controllerState.throughputByModel,
  }),
}));

vi.mock('../../stores/flexinferOperational', () => ({
  flexinferCacheError: () => workbenchMocks.storeState.cacheError,
  flexinferCacheLoading: () => workbenchMocks.storeState.cacheLoading,
  flexinferCacheUpdatedAt: () => workbenchMocks.storeState.cacheUpdatedAt,
  flexinferCaches: () => workbenchMocks.storeState.caches,
  flexinferCatalogError: () => workbenchMocks.storeState.catalogError,
  flexinferCatalogLoading: () => workbenchMocks.storeState.catalogLoading,
  flexinferCatalogUpdatedAt: () => workbenchMocks.storeState.catalogUpdatedAt,
  flexinferCatalogs: () => workbenchMocks.storeState.catalogs,
  flexinferProxyError: () => workbenchMocks.storeState.proxyError,
  flexinferProxyHealth: () => workbenchMocks.storeState.proxyHealth,
  flexinferProxyLoading: () => workbenchMocks.storeState.proxyLoading,
  flexinferProxyMetrics: () => workbenchMocks.storeState.proxyMetrics,
  flexinferProxyUpdatedAt: () => workbenchMocks.storeState.proxyUpdatedAt,
  flexinferRouterError: () => workbenchMocks.storeState.routerError,
  flexinferRouterInfo: () => workbenchMocks.storeState.routerInfo,
  flexinferRouterLoading: () => workbenchMocks.storeState.routerLoading,
  flexinferRouterUpdatedAt: () => workbenchMocks.storeState.routerUpdatedAt,
  refreshFlexInferCaches: workbenchMocks.refreshCaches,
  refreshFlexInferCatalogs: workbenchMocks.refreshCatalogs,
  refreshFlexInferOperationalData: workbenchMocks.refreshOperationalData,
  refreshFlexInferProxy: workbenchMocks.refreshProxy,
  refreshFlexInferRouter: workbenchMocks.refreshRouter,
  startFlexInferOperationalPolling: workbenchMocks.startPolling,
  stopFlexInferOperationalPolling: workbenchMocks.stopPolling,
}));

import Workbench from './Workbench';

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return () => {
    dispose();
    container.remove();
  };
}

function pageText(): string {
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('Workbench', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    workbenchMocks.healthFeatures.flexinfer_proxy.enabled = true;
    workbenchMocks.healthFeatures.modelcache.enabled = true;

    workbenchMocks.controllerState.error = '';
    workbenchMocks.controllerState.loading = false;
    workbenchMocks.controllerState.controllerDataLoading = false;

    workbenchMocks.storeState.proxyError = '';
    workbenchMocks.storeState.proxyLoading = false;
    workbenchMocks.storeState.proxyMetrics.partial = false;
    workbenchMocks.storeState.proxyUpdatedAt = Date.now();
    workbenchMocks.storeState.routerError = '';
    workbenchMocks.storeState.routerLoading = false;
    workbenchMocks.storeState.routerUpdatedAt = Date.now();
    workbenchMocks.storeState.catalogError = '';
    workbenchMocks.storeState.catalogLoading = false;
    workbenchMocks.storeState.catalogUpdatedAt = Date.now();
    workbenchMocks.storeState.cacheError = '';
    workbenchMocks.storeState.cacheLoading = false;
    workbenchMocks.storeState.cacheUpdatedAt = Date.now();

    workbenchMocks.discoverModels.mockClear();
    workbenchMocks.fetchCRDModels.mockClear();
    workbenchMocks.fetchRegistryModels.mockClear();
    workbenchMocks.handleCRDAction.mockClear();
    workbenchMocks.handleDelete.mockClear();
    workbenchMocks.handleRegister.mockClear();
    workbenchMocks.handleSearch.mockClear();
    workbenchMocks.handleStartDownload.mockClear();
    workbenchMocks.refreshCaches.mockClear();
    workbenchMocks.refreshCatalogs.mockClear();
    workbenchMocks.refreshOperationalData.mockClear();
    workbenchMocks.refreshProxy.mockClear();
    workbenchMocks.refreshRouter.mockClear();
    workbenchMocks.setSearchQuery.mockClear();
    workbenchMocks.setSearchSource.mockClear();
    workbenchMocks.startPolling.mockClear();
    workbenchMocks.stopPolling.mockClear();
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  it('renders ready, stale, and partial section states from shared operator data', async () => {
    const now = Date.now();
    workbenchMocks.healthFeatures.modelcache.enabled = false;
    workbenchMocks.storeState.proxyUpdatedAt = now - 20_000;
    workbenchMocks.storeState.routerUpdatedAt = now - 20_000;
    workbenchMocks.storeState.catalogUpdatedAt = now;
    workbenchMocks.storeState.cacheUpdatedAt = 0;

    cleanup = mount(() => <Workbench />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('READY');
    });

    const text = pageText();
    expect(text).toContain('Live FlexInfer operations workbench');
    expect(text).toContain('READY');
    expect(text).toContain('STALE · poll fallback');
    expect(text).toContain('PARTIAL · cache disabled');
  });

  it('surfaces controller errors in both the banner and section state badge', async () => {
    workbenchMocks.controllerState.error = 'offline from controller';

    cleanup = mount(() => <Workbench />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('offline from controller');
    });

    const text = pageText();
    expect(text).toContain('offline from controller');
    expect(text).toContain('OFFLINE · controller issue');
  });

  it('renders disabled telemetry state when proxy features are unavailable', async () => {
    workbenchMocks.healthFeatures.flexinfer_proxy.enabled = false;

    cleanup = mount(() => <Workbench />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('DISABLED · feature disabled');
    });

    const text = pageText();
    expect(text).toContain('Router disabled');
    expect(text).toContain('DISABLED · feature disabled');
  });
});
