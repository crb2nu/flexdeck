/* @vitest-environment jsdom */

import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlexInferModel, InferenceMetrics, LoRAAdapter, RegisteredModel } from '../../lib/types';
import type { IntegrationFetchState } from './controllerIntegration';
import type { ModelsTab } from './useModelsController';

const controllerMocks = vi.hoisted(() => ({
  clearModelIntegrationsCache: vi.fn(),
  createPolling: vi.fn(),
  crdActivate: vi.fn(async () => {}),
  crdModels: [] as FlexInferModel[],
  crdResponse: vi.fn(),
  crdRestart: vi.fn(async () => {}),
  crdScale: vi.fn(async () => {}),
  discover: vi.fn(async () => {}),
  fetchModelIntegrationsBatch: vi.fn(),
  invalidateModelIntegration: vi.fn(),
  registryModels: [] as RegisteredModel[],
  registryResponse: vi.fn(),
  searchCivitAI: vi.fn(async () => ({ models: [] })),
  searchHuggingFace: vi.fn(async () => ({ models: [] })),
}));

vi.mock('../../hooks/createPolling', () => ({
  createPolling: controllerMocks.createPolling,
}));

vi.mock('../../lib/modelIntegration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/modelIntegration')>();
  return {
    ...actual,
    clearModelIntegrationsCache: controllerMocks.clearModelIntegrationsCache,
    fetchModelIntegrationsBatch: controllerMocks.fetchModelIntegrationsBatch,
    invalidateModelIntegration: controllerMocks.invalidateModelIntegration,
  };
});

vi.mock('../../lib/api', () => ({
  modelsApi: {
    crd: controllerMocks.crdResponse,
    crdActivate: controllerMocks.crdActivate,
    crdRestart: controllerMocks.crdRestart,
    crdScale: controllerMocks.crdScale,
    crdWatchSSEUrl: (namespace?: string) =>
      namespace ? `/api/models/crd/watch?namespace=${namespace}` : '/api/models/crd/watch',
    delete: vi.fn(async () => {}),
    discover: controllerMocks.discover,
    list: controllerMocks.registryResponse,
    register: vi.fn(async () => {}),
    searchCivitAI: controllerMocks.searchCivitAI,
    searchHuggingFace: controllerMocks.searchHuggingFace,
    startDownload: vi.fn(async () => {}),
  },
}));

import { useModelsController } from './useModelsController';

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  onerror: (() => void) | null = null;
  readonly close = vi.fn();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  emit(type: string, payload: unknown) {
    const event = { data: JSON.stringify(payload) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  static reset() {
    FakeEventSource.instances = [];
  }
}

function buildModel(name: string, phase: FlexInferModel['status']['phase']): FlexInferModel {
  return {
    name,
    namespace: 'flexinfer-system',
    creationTimestamp: '2026-03-30T00:00:00Z',
    spec: {
      backend: 'vllm',
      source: `hf://${name}`,
    },
    status: {
      phase,
    },
  };
}

function buildMetrics(overrides: Partial<InferenceMetrics> = {}): InferenceMetrics {
  return {
    model: 'alpha',
    observed: true,
    tps: 10,
    p95LatencyMs: 100,
    queueDepth: 0,
    activeConnections: 1,
    errorRate: 0,
    queueWaitP95Ms: 100,
    rejectedRequestsPerSec: 0,
    scaleUps5m: 0,
    activationRetries5m: 0,
    coldStartP95Ms: null,
    idleSeconds: null,
    ...overrides,
  };
}

function buildIntegrationState(
  state: Partial<IntegrationFetchState> & {
    adapters?: LoRAAdapter[];
    metrics?: InferenceMetrics;
  } = {},
) {
  return {
    adapters: state.adapters ?? [],
    inferenceAvailable: state.inferenceAvailable ?? true,
    loraAvailable: state.loraAvailable ?? true,
    metrics: state.metrics,
    throughputAvailable: state.throughputAvailable ?? false,
  };
}

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return () => {
    dispose();
    container.remove();
  };
}

describe('useModelsController', () => {
  let cleanup: () => void = () => undefined;
  let originalEventSource: typeof globalThis.EventSource | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.reset();
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;

    controllerMocks.crdModels = [buildModel('alpha', 'Ready')];
    controllerMocks.registryModels = [
      {
        id: 'alpha',
        name: 'alpha',
        source: 'huggingface',
        source_id: 'hf/alpha',
        source_url: 'https://huggingface.co/hf/alpha',
        type: 'llm',
        description: 'Alpha model',
        tags: [],
        size: 1,
        local_path: '/models/alpha',
        download_status: 'completed',
        download_progress: 100,
        deployment_status: 'deployed',
        replicas: 1,
        created_at: '2026-03-30T00:00:00Z',
        updated_at: '2026-03-30T00:00:00Z',
      },
    ] as RegisteredModel[];

    controllerMocks.crdResponse.mockReset();
    controllerMocks.registryResponse.mockReset();
    controllerMocks.discover.mockReset();
    controllerMocks.fetchModelIntegrationsBatch.mockReset();
    controllerMocks.clearModelIntegrationsCache.mockReset();
    controllerMocks.invalidateModelIntegration.mockReset();
    controllerMocks.crdActivate.mockClear();
    controllerMocks.crdRestart.mockClear();
    controllerMocks.crdScale.mockClear();
    controllerMocks.createPolling.mockClear();

    controllerMocks.crdResponse.mockImplementation(async () => ({
      models: controllerMocks.crdModels,
      namespace: 'flexinfer-system',
      count: controllerMocks.crdModels.length,
    }));
    controllerMocks.registryResponse.mockImplementation(async () => ({
      models: controllerMocks.registryModels,
    }));
    controllerMocks.discover.mockResolvedValue(undefined);
    controllerMocks.createPolling.mockImplementation(() => undefined);
    controllerMocks.fetchModelIntegrationsBatch.mockImplementation(
      async (models: Array<{ namespace: string; name: string }>) =>
        Object.fromEntries(
          models.map(({ namespace, name }) => [
            `${namespace}/${name}`,
            name === 'alpha'
              ? buildIntegrationState({
                  adapters: [
                    {
                      name: 'adapter-a',
                      namespace,
                      modelRef: name,
                      state: 'Loaded',
                      adapterSource: 's3://adapter-a',
                    },
                  ],
                  metrics: buildMetrics({ model: name }),
                })
              : buildIntegrationState({
                  inferenceAvailable: false,
                  loraAvailable: false,
                }),
          ]),
        ),
    );
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
    vi.useRealTimers();
    globalThis.EventSource = originalEventSource as typeof EventSource;
  });

  it('builds controller summaries from CRD and integration data', async () => {
    controllerMocks.crdModels = [
      buildModel('alpha', 'Ready'),
      buildModel('beta', 'Failed'),
    ];

    let controller!: ReturnType<typeof useModelsController>;
    cleanup = mount(() => {
      const [activeTab, setActiveTab] = createSignal<ModelsTab>('controller');
      controller = useModelsController(activeTab, setActiveTab);
      return <div />;
    });

    await vi.runAllTimersAsync();
    await vi.waitFor(() => {
      expect(controller.controllerDataLoading()).toBe(false);
    });

    expect(controller.phaseSummary()).toEqual({ Ready: 1, Failed: 1 });
    expect(controller.integrationSummary()).toEqual({
      inferenceUnavailable: 1,
      loraUnavailable: 1,
    });
    expect(controller.reliabilitySummary()).toEqual({
      healthy: 1,
      degraded: 0,
      partial: 0,
      unknown: 1,
    });
    expect(controller.loraSummary()).toEqual({
      loaded: 1,
      total: 1,
    });
  });

  it('updates controller summaries when SSE model events add a new CRD model', async () => {
    let controller!: ReturnType<typeof useModelsController>;
    cleanup = mount(() => {
      const [activeTab, setActiveTab] = createSignal<ModelsTab>('controller');
      controller = useModelsController(activeTab, setActiveTab);
      return <div />;
    });

    await vi.runAllTimersAsync();
    await vi.waitFor(() => {
      expect(controller.crdModels()).toHaveLength(1);
    });

    const stream = FakeEventSource.instances[0];
    expect(stream?.url).toContain('/api/models/crd/watch');

    stream.emit('model', {
      type: 'ADDED',
      model: buildModel('beta', 'Failed'),
    });

    await vi.runAllTimersAsync();
    await vi.waitFor(() => {
      expect(controller.crdModels()).toHaveLength(2);
    });

    expect(controller.phaseSummary()).toEqual({ Ready: 1, Failed: 1 });
    expect(controller.integrationSummary()).toEqual({
      inferenceUnavailable: 1,
      loraUnavailable: 1,
    });
  });

  it('invalidates model integrations and refetches CRDs after controller actions', async () => {
    let controller!: ReturnType<typeof useModelsController>;
    cleanup = mount(() => {
      const [activeTab, setActiveTab] = createSignal<ModelsTab>('controller');
      controller = useModelsController(activeTab, setActiveTab);
      return <div />;
    });

    await vi.runAllTimersAsync();
    await vi.waitFor(() => {
      expect(controller.crdModels()).toHaveLength(1);
    });

    const model = controller.crdModels()[0];
    controllerMocks.crdResponse.mockClear();

    await controller.handleCRDAction('scale0', model);

    expect(controllerMocks.crdScale).toHaveBeenCalledWith('flexinfer-system', 'alpha', 0);
    expect(controllerMocks.invalidateModelIntegration).toHaveBeenCalledWith('flexinfer-system', 'alpha');
    expect(controllerMocks.crdResponse).toHaveBeenCalledTimes(1);
    expect(controller.crdActionLoading()).toBe(null);
  });
});
