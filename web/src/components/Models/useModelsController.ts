import { createEffect, createMemo, createSignal, onCleanup, onMount, type Accessor } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
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
  modelRefKey,
} from '../../lib/modelIntegration';
import {
  flexinferRegistryError,
  flexinferRegistryLoading,
  flexinferRegistryModels,
  refreshFlexInferRegistry,
} from '../../stores/flexinferOperational';
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
  | 'proxy'
  | 'pipelines';

interface UseModelsControllerOptions {
  refreshOnMount?: boolean;
  autoDiscoverOnMount?: boolean;
  includeThroughputMetrics?: boolean;
}

export function useModelsController(
  activeTab: Accessor<ModelsTab>,
  setActiveTab: (tab: ModelsTab) => void,
  options: UseModelsControllerOptions = {},
) {
  const refreshOnMount = options.refreshOnMount ?? true;
  const autoDiscoverOnMount = options.autoDiscoverOnMount ?? true;
  const includeThroughputMetrics = options.includeThroughputMetrics ?? true;
  const [localError, setLocalError] = createSignal('');
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);
  const [discoverLoading, setDiscoverLoading] = createSignal(false);
  const [crdActionLoading, setCrdActionLoading] = createSignal<string | null>(null);
  const [controllerDataLoading, setControllerDataLoading] = createSignal(false);
  const [controllerUpdatedAt, setControllerUpdatedAt] = createSignal(0);

  const [crdModels, setCrdModels] = createSignal<FlexInferModel[]>([]);
  const [inferenceByModel, setInferenceByModel] = createSignal<Record<string, InferenceMetrics>>({});
  const [loraByModel, setLoraByModel] = createSignal<Record<string, LoRAAdapter[]>>({});
  const [throughputByModel, setThroughputByModel] = createSignal<Record<string, LiteLLMModelThroughput>>({});
  const [integrationByModel, setIntegrationByModel] = createSignal<Record<string, IntegrationFetchState>>({});

  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchSource, setSearchSource] = createSignal<'huggingface' | 'civitai'>('huggingface');
  const [searchResults, setSearchResults] = createSignal<RegisteredModel[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [crdNamespace, setCrdNamespace] = createSignal('');

  let controllerRefreshToken = 0;
  const loading = flexinferRegistryLoading;
  const registryModels = flexinferRegistryModels;
  const error = () => localError() || flexinferRegistryError();

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
      { concurrency: 4, includeThroughput: includeThroughputMetrics },
    );

    for (const model of models) {
      const key = modelRefKey(model.namespace, model.name);
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
      setControllerUpdatedAt(Date.now());
    } catch (err) {
      console.warn('CRD fetch failed, falling back to registry:', err);
    }
  };

  const fetchRegistryModels = async () => {
    setLocalError('');
    await refreshFlexInferRegistry();
  };

  const refreshModels = async () => {
    await fetchCRDModels();
  };

  const discoverModels = async () => {
    setDiscoverLoading(true);
    try {
      await modelsApi.discover(crdNamespace() || undefined);
      clearModelIntegrationsCache();
      setLocalError('');
      await refreshModels();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Discovery failed');
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
      setLocalError('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Search failed');
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
      setLocalError('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStartDownload = async (id: string) => {
    setActionLoading(id);
    try {
      await modelsApi.startDownload(id);
      await fetchRegistryModels();
      setLocalError('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Download failed');
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
      setLocalError('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Delete failed');
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
      setLocalError('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setCrdActionLoading(null);
    }
  };

  onMount(() => {
    if (refreshOnMount) {
      void refreshModels();
    }
    if (autoDiscoverOnMount) {
      void discoverModels();
    }
  });

  createPolling('models-refresh', async () => { await fetchCRDModels(); }, 15000, true, !refreshOnMount);

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
          setControllerUpdatedAt(Date.now());
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
      const key = modelRefKey(model.namespace, model.name);
      const status = getReliabilityStatus(inferenceByModel()[key]);
      counts[status.level] += 1;
    }
    return counts;
  });

  const loraSummary = createMemo(() => {
    let loaded = 0;
    let total = 0;
    for (const model of crdModels()) {
      const key = modelRefKey(model.namespace, model.name);
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
      .map((model) => integrationByModel()[modelRefKey(model.namespace, model.name)])
      .filter((state): state is IntegrationFetchState => state != null);
    return summarizeIntegrationCoverage(states);
  });

  return {
    actionLoading,
    controllerDataLoading,
    controllerUpdatedAt,
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
