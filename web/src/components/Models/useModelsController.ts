import { createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor } from 'solid-js';
import type {
  RegisteredModel,
  ModelSearchResult,
  FlexInferModel,
  FlexInferModelListResponse,
  InferenceMetrics,
  LoRAAdapter,
} from '../../lib/types';
import type { LiteLLMModelThroughput } from '../../lib/api/infrastructure';
import { modelsApi } from '../../lib/api';
import {
  clearModelIntegrationsCache,
  fetchModelIntegrationsBatch,
  invalidateModelIntegration,
} from '../../lib/modelIntegration';
import {
  getReliabilityStatus,
  type IntegrationFetchState,
  summarizeIntegrationCoverage,
  summarizeLoRA,
} from './controllerIntegration';

export type ModelsTab =
  | 'controller'
  | 'registry'
  | 'search'
  | 'router'
  | 'compare'
  | 'inference'
  | 'catalog'
  | 'proxy';

export function useModelsController(activeTab: Accessor<ModelsTab>, setActiveTab: (tab: ModelsTab) => void) {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);
  const [discoverLoading, setDiscoverLoading] = createSignal(false);
  const [crdActionLoading, setCrdActionLoading] = createSignal<string | null>(null);
  const [controllerDataLoading, setControllerDataLoading] = createSignal(false);

  const [crdModels, setCrdModels] = createSignal<FlexInferModel[]>([]);
  const [inferenceByModel, setInferenceByModel] = createSignal<Record<string, InferenceMetrics>>({});
  const [loraByModel, setLoraByModel] = createSignal<Record<string, LoRAAdapter[]>>({});
  const [throughputByModel, setThroughputByModel] = createSignal<Record<string, LiteLLMModelThroughput>>({});
  const [integrationByModel, setIntegrationByModel] = createSignal<Record<string, IntegrationFetchState>>({});
  const [registryModels, setRegistryModels] = createSignal<RegisteredModel[]>([]);

  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchSource, setSearchSource] = createSignal<'huggingface' | 'civitai'>('huggingface');
  const [searchResults, setSearchResults] = createSignal<RegisteredModel[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [crdNamespace, setCrdNamespace] = createSignal('');

  let controllerRefreshToken = 0;

  const modelKey = (namespace: string, name: string) => `${namespace}/${name}`;

  const refreshControllerIntegrations = async (models: FlexInferModel[]) => {
    const token = ++controllerRefreshToken;
    if (models.length === 0) {
      setInferenceByModel({});
      setLoraByModel({});
      setThroughputByModel({});
      setIntegrationByModel({});
      setControllerDataLoading(false);
      return;
    }

    setControllerDataLoading(true);
    const nextInference: Record<string, InferenceMetrics> = {};
    const nextLoRA: Record<string, LoRAAdapter[]> = {};
    const nextThroughput: Record<string, LiteLLMModelThroughput> = {};
    const nextIntegration: Record<string, IntegrationFetchState> = {};

    const integrationData = await fetchModelIntegrationsBatch(
      models.map((model) => ({ namespace: model.namespace, name: model.name })),
      { concurrency: 4 },
    );

    for (const model of models) {
      const key = modelKey(model.namespace, model.name);
      const integration = integrationData[key];
      if (!integration) continue;
      nextIntegration[key] = {
        inferenceAvailable: integration.inferenceAvailable,
        loraAvailable: integration.loraAvailable,
        throughputAvailable: integration.throughputAvailable,
      };
      if (integration.metrics) nextInference[key] = integration.metrics;
      if (integration.throughput) nextThroughput[key] = integration.throughput;
      nextLoRA[key] = integration.adapters;
    }

    if (token !== controllerRefreshToken) return;
    setInferenceByModel(nextInference);
    setLoraByModel(nextLoRA);
    setThroughputByModel(nextThroughput);
    setIntegrationByModel(nextIntegration);
    setControllerDataLoading(false);
  };

  const fetchCRDModels = async () => {
    try {
      const data: FlexInferModelListResponse = await modelsApi.crd();
      setCrdModels(data.models || []);
      if (data.namespace) setCrdNamespace(data.namespace);
    } catch (err) {
      console.warn('CRD fetch failed, falling back to registry:', err);
    }
  };

  const fetchRegistryModels = async () => {
    try {
      const data = await modelsApi.list();
      setRegistryModels(data.models || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setLoading(false);
    }
  };

  const refreshModels = async () => {
    await Promise.all([fetchCRDModels(), fetchRegistryModels()]);
  };

  const discoverModels = async () => {
    setDiscoverLoading(true);
    try {
      await modelsApi.discover(crdNamespace() || undefined);
      clearModelIntegrationsCache();
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setDiscoverLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery().trim()) return;
    setSearching(true);
    try {
      const data: ModelSearchResult = searchSource() === 'huggingface'
        ? await modelsApi.searchHuggingFace(searchQuery(), '', 20)
        : await modelsApi.searchCivitAI(searchQuery(), '', 20);
      setSearchResults(data.models || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const handleRegister = async (source: string, sourceId: string) => {
    setActionLoading(sourceId);
    try {
      await modelsApi.register(source, sourceId);
      await fetchRegistryModels();
      setActiveTab('registry');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartDownload = async (id: string) => {
    setActionLoading(id);
    try {
      await modelsApi.startDownload(id);
      await fetchRegistryModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this model from registry?')) return;
    setActionLoading(id);
    try {
      await modelsApi.delete(id);
      await fetchRegistryModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCRDAction = async (action: 'activate' | 'scale0' | 'restart', model: FlexInferModel) => {
    const key = `${model.namespace}/${model.name}/${action}`;
    setCrdActionLoading(key);
    try {
      if (action === 'activate') {
        await modelsApi.crdActivate(model.namespace, model.name);
      } else if (action === 'scale0') {
        await modelsApi.crdScale(model.namespace, model.name, 0);
      } else {
        await modelsApi.crdRestart(model.namespace, model.name);
      }
      invalidateModelIntegration(model.namespace, model.name);
      await fetchCRDModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setCrdActionLoading(null);
    }
  };

  onMount(() => {
    void refreshModels().finally(() => setLoading(false));
    void discoverModels();
    const interval = setInterval(() => {
      void refreshModels();
    }, 15000);
    onCleanup(() => clearInterval(interval));
  });

  createEffect(() => {
    if (activeTab() !== 'controller') return;

    let es: EventSource | null = null;
    try {
      es = new EventSource(modelsApi.crdWatchSSEUrl(crdNamespace() || undefined));
      es.addEventListener('model', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data);
          if (!event?.model) return;
          const incoming = event.model as FlexInferModel;
          setCrdModels((prev) => {
            const idx = prev.findIndex((model) => model.name === incoming.name && model.namespace === incoming.namespace);
            if (event.type === 'DELETED') {
              return idx >= 0 ? [...prev.slice(0, idx), ...prev.slice(idx + 1)] : prev;
            }
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = incoming;
              return updated;
            }
            return [...prev, incoming];
          });
        } catch {
          // ignore parse errors
        }
      });
      es.onerror = () => {
        es?.close();
      };
    } catch {
      // EventSource not supported
    }

    onCleanup(() => es?.close());
  });

  createEffect(() => {
    if (activeTab() !== 'controller') return;
    const snapshot = [...crdModels()];
    let timer: ReturnType<typeof setTimeout> | undefined;
    timer = setTimeout(() => {
      void refreshControllerIntegrations(snapshot);
    }, 250);
    onCleanup(() => {
      if (timer) clearTimeout(timer);
    });
  });

  const phaseSummary = createMemo(() => {
    const counts: Record<string, number> = {};
    for (const model of crdModels()) {
      const phase = model.status?.phase || 'Unknown';
      counts[phase] = (counts[phase] || 0) + 1;
    }
    return counts;
  });

  const reliabilitySummary = createMemo(() => {
    const counts: Record<string, number> = { healthy: 0, degraded: 0, partial: 0, unknown: 0 };
    for (const model of crdModels()) {
      const key = modelKey(model.namespace, model.name);
      const status = getReliabilityStatus(inferenceByModel()[key]);
      counts[status.level] += 1;
    }
    return counts;
  });

  const loraSummary = createMemo(() => {
    let loaded = 0;
    let total = 0;
    for (const model of crdModels()) {
      const key = modelKey(model.namespace, model.name);
      const summary = summarizeLoRA(loraByModel()[key]);
      loaded += summary.loaded;
      total += summary.total;
    }
    return { loaded, total };
  });

  const integrationSummary = createMemo(() => {
    if (controllerDataLoading() && Object.keys(integrationByModel()).length === 0) {
      return { inferenceUnavailable: 0, loraUnavailable: 0 };
    }
    const states = crdModels()
      .map((model) => integrationByModel()[modelKey(model.namespace, model.name)])
      .filter((state): state is IntegrationFetchState => state != null);
    return summarizeIntegrationCoverage(states);
  });

  return {
    actionLoading,
    controllerDataLoading,
    crdActionLoading,
    crdModels,
    discoverLoading,
    discoverModels,
    error,
    fetchCRDModels,
    fetchRegistryModels,
    handleCRDAction,
    handleDelete,
    handleRegister,
    handleSearch,
    handleStartDownload,
    inferenceByModel,
    integrationByModel,
    integrationSummary,
    loading,
    loraByModel,
    loraSummary,
    phaseSummary,
    refreshModels,
    registryModels,
    reliabilitySummary,
    searchQuery,
    searchResults,
    searchSource,
    searching,
    setSearchQuery,
    setSearchSource,
    throughputByModel,
  };
}
