import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cacheListMock,
  catalogsMock,
  healthStoreMock,
  listMock,
  metricsMock,
  pollingRegisterMock,
  pollingUnregisterMock,
  proxyHealthMock,
  routerMock,
} = vi.hoisted(() => ({
  cacheListMock: vi.fn(),
  catalogsMock: vi.fn(),
  healthStoreMock: {
    features: {
      flexinfer_proxy: { enabled: true },
      modelcache: { enabled: true },
    },
  },
  listMock: vi.fn(),
  metricsMock: vi.fn(),
  pollingRegisterMock: vi.fn(),
  pollingUnregisterMock: vi.fn(),
  proxyHealthMock: vi.fn(),
  routerMock: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  modelsApi: {
    cacheList: cacheListMock,
    catalogs: catalogsMock,
    list: listMock,
  },
  flexinferProxyApi: {
    health: proxyHealthMock,
    metrics: metricsMock,
  },
  litellm: {
    router: routerMock,
  },
}));

vi.mock('../lib/polling', () => ({
  pollingScheduler: {
    register: pollingRegisterMock,
    unregister: pollingUnregisterMock,
  },
}));

vi.mock('./health', () => ({
  healthStore: healthStoreMock,
}));

import {
  __resetFlexInferOperationalStoreForTests,
  flexinferProxyError,
  flexinferProxyHealth,
  flexinferProxyLoading,
  flexinferProxyMetrics,
  flexinferRegistryError,
  flexinferRegistryLoading,
  flexinferRegistryModels,
  flexinferRegistryUpdatedAt,
  refreshFlexInferProxy,
  refreshFlexInferRegistry,
  startFlexInferOperationalPolling,
  stopFlexInferOperationalPolling,
} from './flexinferOperational';

describe('flexinferOperational', () => {
  beforeEach(() => {
    __resetFlexInferOperationalStoreForTests();
    listMock.mockReset();
    catalogsMock.mockReset();
    cacheListMock.mockReset();
    proxyHealthMock.mockReset();
    metricsMock.mockReset();
    routerMock.mockReset();
    pollingRegisterMock.mockReset();
    pollingUnregisterMock.mockReset();

    healthStoreMock.features.flexinfer_proxy.enabled = true;
    healthStoreMock.features.modelcache.enabled = true;
  });

  it('refreshes registry models through the shared store', async () => {
    listMock.mockResolvedValue({
      models: [{
        id: 'alpha',
        name: 'alpha',
        source: 'huggingface',
        source_id: 'hf/alpha',
        source_url: 'https://huggingface.co/hf/alpha',
        type: 'llm',
        description: 'alpha model',
        tags: [],
        size: 1,
        local_path: '/models/alpha',
        download_status: 'completed',
        download_progress: 100,
        deployment_status: 'deployed',
        replicas: 1,
        created_at: '2026-03-29T00:00:00Z',
        updated_at: '2026-03-29T00:00:00Z',
      }],
    });

    await refreshFlexInferRegistry();

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(flexinferRegistryLoading()).toBe(false);
    expect(flexinferRegistryError()).toBe('');
    expect(flexinferRegistryModels()).toEqual([
      {
        id: 'alpha',
        name: 'alpha',
        source: 'huggingface',
        source_id: 'hf/alpha',
        source_url: 'https://huggingface.co/hf/alpha',
        type: 'llm',
        description: 'alpha model',
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
    ]);
    expect(flexinferRegistryUpdatedAt()).toBeGreaterThan(0);
  });

  it('clears proxy state when the proxy feature is disabled', async () => {
    proxyHealthMock.mockResolvedValue({ healthy: true, status: 'ok' });
    metricsMock.mockResolvedValue({
      requests: {},
      latency: {},
      queue_depth: {},
      active_conn: {},
      scale_ups: {},
      byModel: {},
      totals: {
        requestsPerSecond: 0,
        avgLatencyMs: 0,
        queueDepth: 0,
        activeConnections: 0,
      },
      requestsByStatus: {},
      partial: false,
    });

    await refreshFlexInferProxy();

    healthStoreMock.features.flexinfer_proxy.enabled = false;
    await refreshFlexInferProxy();

    expect(flexinferProxyLoading()).toBe(false);
    expect(flexinferProxyError()).toBe('');
    expect(flexinferProxyHealth()).toBeNull();
    expect(flexinferProxyMetrics()).toBeNull();
  });

  it('reference-counts shared polling registration across consumers', () => {
    startFlexInferOperationalPolling();
    startFlexInferOperationalPolling();

    expect(pollingRegisterMock).toHaveBeenCalledTimes(5);
    expect(pollingRegisterMock.mock.calls.map((call) => call[3])).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);

    stopFlexInferOperationalPolling();
    expect(pollingUnregisterMock).not.toHaveBeenCalled();

    stopFlexInferOperationalPolling();
    expect(pollingUnregisterMock).toHaveBeenCalledTimes(5);
    expect(pollingUnregisterMock.mock.calls.map(([id]) => id)).toEqual([
      'flexinfer-registry-models',
      'flexinfer-proxy-metrics',
      'flexinfer-router-info',
      'flexinfer-catalogs',
      'flexinfer-caches',
    ]);
  });

  it('can suppress immediate poll fires when a surface performs an explicit initial refresh', () => {
    startFlexInferOperationalPolling(false);

    expect(pollingRegisterMock).toHaveBeenCalledTimes(5);
    expect(pollingRegisterMock.mock.calls.map((call) => call[3])).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
