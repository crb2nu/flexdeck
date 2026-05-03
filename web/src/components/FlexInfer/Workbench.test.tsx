/* @vitest-environment jsdom */

import { HashRouter, Route } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PageScrollBody from '../shared/PageScrollBody';

const workbenchMocks = vi.hoisted(() => {
  const healthFeatures = {
    flexinfer_proxy: { enabled: true },
    modelcache: { enabled: true },
  };

  type MockModelStatus = {
    phase?: string;
    loadingSubstage?: string;
    message?: string;
    loadingProgressAt?: string;
    cache?: {
      strategy?: string;
      ready?: boolean;
      jobPhase?: string;
    };
  };
  type MockCache = {
    name: string;
    namespace: string;
    creationTimestamp: string;
    spec: { source: string };
    status: { phase?: 'Pending' | 'Initializing' | 'Provisioning' | 'Abliterating' | 'Finetuning' | 'Quantizing' | 'Publishing' | 'Ready' | 'Failed' };
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
    ] as Array<{
      name: string;
      namespace: string;
      spec: {
        source: string;
        serverless?: { enabled?: boolean };
        gpu?: { shared?: number };
        cache?: { strategy?: string };
      };
      status: MockModelStatus;
    }>,
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
    phaseSummary: { Ready: 1, Failed: 0 } as Record<string, number>,
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
    caches: [] as MockCache[],
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
  const RouteShell = () => <PageScrollBody>{factory()}</PageScrollBody>;
  const dispose = render(() => (
    <HashRouter>
      <Route path="/flexinfer" component={RouteShell} />
      <Route path="/models" component={RouteShell} />
    </HashRouter>
  ), container);
  return () => {
    dispose();
    container.remove();
  };
}

function pageText(): string {
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function findSidebarItem(sectionId: string): HTMLElement {
  const item = document.querySelector(`[data-operations-nav-id="${sectionId}"]`) as HTMLElement | null;
  expect(item).toBeTruthy();
  return item!;
}

function sectionClass(id: string): string {
  const section = document.getElementById(id);
  expect(section).toBeTruthy();
  return section!.className;
}

describe('Workbench', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    workbenchMocks.healthFeatures.flexinfer_proxy.enabled = true;
    workbenchMocks.healthFeatures.modelcache.enabled = true;
    window.history.replaceState({}, '', '/#/models');

    workbenchMocks.controllerState.error = '';
    workbenchMocks.controllerState.loading = false;
    workbenchMocks.controllerState.controllerDataLoading = false;
    workbenchMocks.controllerState.crdModels = [
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
    ];
    workbenchMocks.controllerState.phaseSummary = { Ready: 1, Failed: 0 };

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
    workbenchMocks.storeState.catalogs = [];
    workbenchMocks.storeState.cacheError = '';
    workbenchMocks.storeState.cacheLoading = false;
    workbenchMocks.storeState.cacheUpdatedAt = Date.now();
    workbenchMocks.storeState.caches = [];

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
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/#/models');
  });

  it('switches the visible lane from the sidebar rail without losing the current route', async () => {
    cleanup = mount(() => <Workbench />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Operator briefing');
    });

    expect(workbenchMocks.startPolling).toHaveBeenCalledWith(false);
    expect(workbenchMocks.fetchCRDModels).toHaveBeenCalledTimes(1);
    expect(workbenchMocks.refreshOperationalData).toHaveBeenCalledTimes(1);
    expect(findSidebarItem('overview').tagName).toBe('A');
    expect(findSidebarItem('overview').getAttribute('aria-current')).toBe('page');
    expect(findSidebarItem('telemetry').getAttribute('aria-current')).toBeNull();
    expect(sectionClass('overview')).not.toContain('hidden');
    expect(sectionClass('telemetry')).toContain('hidden');

    findSidebarItem('telemetry').click();

    await vi.waitFor(() => {
      expect(sectionClass('telemetry')).not.toContain('hidden');
    });

    expect(findSidebarItem('telemetry').getAttribute('aria-current')).toBe('page');
    expect(findSidebarItem('overview').getAttribute('aria-current')).toBeNull();
    expect(sectionClass('overview')).toContain('hidden');
    expect(window.location.hash).toBe('#/models?section=telemetry');

    findSidebarItem('intake').click();
    await vi.waitFor(() => {
      expect(sectionClass('intake')).not.toContain('hidden');
    });
    expect(window.location.hash).toBe('#/models?section=intake');
  });

  it('opens the section from router search params on first render', async () => {
    window.history.replaceState({}, '', '/#/models?section=supply-chain');

    cleanup = mount(() => <Workbench />);

    await vi.waitFor(() => {
      expect(sectionClass('supply-chain')).not.toContain('hidden');
    });

    expect(findSidebarItem('supply-chain').getAttribute('aria-current')).toBe('page');
    expect(sectionClass('overview')).toContain('hidden');
  });

  it('uses the same route-safe section flow from the overview cards', async () => {
    cleanup = mount(() => <Workbench />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Operator briefing');
    });

    const telemetryCard = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Telemetry'),
    ) as HTMLButtonElement | undefined;
    expect(telemetryCard).toBeTruthy();
    telemetryCard!.click();

    await vi.waitFor(() => {
      expect(sectionClass('telemetry')).not.toContain('hidden');
    });

    expect(window.location.hash).toBe('#/models?section=telemetry');
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
    expect(text).toContain('FlexInfer Workbench');
    expect(text).toContain('Operator briefing');
    expect(text).toContain('PARTIAL · cache disabled');
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
    expect(text).toContain('Proxy Disabled');
    expect(text).toContain('DISABLED · feature disabled');
    expect(text).toContain('telemetry off · 1 CRDs');
    expect(text).toContain('flexinfer proxy disabled');
    expect(text).toContain('Telemetrydisabled');
  });

  it('summarizes partial operations from failed caches and controller queues', async () => {
    workbenchMocks.healthFeatures.flexinfer_proxy.enabled = false;
    workbenchMocks.controllerState.crdModels = [
      ...workbenchMocks.controllerState.crdModels,
      {
        name: 'idle-model',
        namespace: 'flexinfer-system',
        spec: { source: 'hf://idle', serverless: { enabled: true }, gpu: { shared: 1 }, cache: { strategy: 'shared' } },
        status: { phase: 'Idle', cache: { strategy: 'shared', ready: true, jobPhase: 'Ready' } },
      },
      {
        name: 'preempted-model',
        namespace: 'flexinfer-system',
        spec: { source: 'hf://preempted', serverless: { enabled: true }, gpu: { shared: 1 }, cache: { strategy: 'shared' } },
        status: { phase: 'Preempted', cache: { strategy: 'shared', ready: true, jobPhase: 'Ready' } },
      },
      {
        name: 'pending-model',
        namespace: 'flexinfer-system',
        spec: { source: 'hf://pending', serverless: { enabled: true }, gpu: { shared: 1 }, cache: { strategy: 'shared' } },
        status: { phase: 'Pending', cache: { strategy: 'shared', ready: false, jobPhase: 'Pending' } },
      },
    ];
    workbenchMocks.controllerState.phaseSummary = { Ready: 1, Idle: 1, Preempted: 1, Pending: 1, Failed: 0 };
    workbenchMocks.storeState.caches = [
      {
        name: 'cache-ready',
        namespace: 'flexinfer-system',
        creationTimestamp: '2026-05-03T00:00:00Z',
        spec: { source: 'hf://ready' },
        status: { phase: 'Ready' },
      },
      {
        name: 'cache-failed',
        namespace: 'flexinfer-system',
        creationTimestamp: '2026-05-03T00:00:00Z',
        spec: { source: 'hf://failed' },
        status: { phase: 'Failed' },
      },
    ];

    cleanup = mount(() => <Workbench />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('PARTIAL · 1 failed caches · proxy disabled');
    });

    const text = pageText();
    expect(text).toContain('telemetry off · 4 CRDs');
    expect(text).toContain('1 ready · 1 idle · 1 preempted · 1 pending');
    expect(text).toContain('flexinfer proxy disabled');
    expect(text).toContain('Supply chain1/22 caches · 1 ready · 1 failed · no catalogs');
    expect(text).toContain('Supply chain1 failed');

    findSidebarItem('telemetry').click();
    await vi.waitFor(() => {
      expect(sectionClass('telemetry')).not.toContain('hidden');
    });
    expect(pageText()).toContain('DISABLED · feature disabled');

    findSidebarItem('supply-chain').click();
    await vi.waitFor(() => {
      expect(sectionClass('supply-chain')).not.toContain('hidden');
    });
    expect(pageText()).toContain('PARTIAL · 1 failed caches');
    expect(pageText()).toContain('cache-failed');
  });

  it('renders loading phase detail with stalled progress context', async () => {
    workbenchMocks.controllerState.crdModels[0].status = {
      phase: 'Loading',
      loadingSubstage: 'LoadingWeights',
      message: 'loading weights (31/34 shards, 141.75s/it)',
      loadingProgressAt: new Date(Date.now() - 130_000).toISOString(),
      cache: { strategy: 'shared', ready: false, jobPhase: 'Pending' },
    };
    workbenchMocks.controllerState.phaseSummary = { Loading: 1, Failed: 0 };

    cleanup = mount(() => <Workbench />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Loading weights');
    });

    const text = pageText();
    expect(text).toContain('Model weights are being loaded into the runtime');
    expect(text).toContain('loading weights (31/34 shards, 141.75s/it)');
    expect(text).toContain('stalled');
    expect(text).toContain('No progress for');
  });

  it('keeps loading phase detail visible while substage fields are warming up', async () => {
    workbenchMocks.controllerState.crdModels[0].status = {
      phase: 'Loading',
      cache: { strategy: 'shared', ready: false, jobPhase: 'Pending' },
    };
    workbenchMocks.controllerState.phaseSummary = { Loading: 1, Failed: 0 };

    cleanup = mount(() => <Workbench />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Loading detail');
    });

    const text = pageText();
    expect(text).toContain('Controller has not reported a substage yet');
    expect(text).not.toContain('stalled');
  });
});
