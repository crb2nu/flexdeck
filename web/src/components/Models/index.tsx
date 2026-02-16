import { Component, createSignal, createEffect, onCleanup, For, Show, Switch, Match, createMemo, ErrorBoundary, lazy, Suspense } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { RegisteredModel, ModelSearchResult, FlexInferModel, FlexInferModelListResponse } from '../../lib/types';
import { modelsApi } from '../../lib/api';
import GPUMetricsPanel from './GPUMetricsPanel';
import ModelGPUTable from './ModelGPUTable';

const LiteLLMRouterPanel = lazy(() => import('./LiteLLMRouterPanel'));
const ModelComparison = lazy(() => import('./ModelComparison'));
const ModelEventsTimeline = lazy(() => import('./ModelEventsTimeline'));
const InferenceTab = lazy(() => import('./InferenceTab'));
const CatalogTab = lazy(() => import('./CatalogTab'));

type Tab = 'controller' | 'registry' | 'search' | 'router' | 'compare' | 'inference' | 'catalog';

const Models: Component = () => {
  const [activeTab, setActiveTab] = createSignal<Tab>('controller');
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);
  const [discoverLoading, setDiscoverLoading] = createSignal(false);
  const [crdActionLoading, setCrdActionLoading] = createSignal<string | null>(null);

  // CRD models from flexinfer-system (the real controller state)
  const [crdModels, setCrdModels] = createStore<FlexInferModel[]>([]);

  // Registry models (flexdeck's internal model registry)
  const [registryModels, setRegistryModels] = createStore<RegisteredModel[]>([]);

  // Search state
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchSource, setSearchSource] = createSignal<'huggingface' | 'civitai'>('huggingface');
  const [searchResults, setSearchResults] = createStore<RegisteredModel[]>([]);
  const [searching, setSearching] = createSignal(false);

  // Fetch CRD models directly from flexinfer-system
  const fetchCRDModels = async () => {
    try {
      const data: FlexInferModelListResponse = await modelsApi.crd('flexinfer-system');
      setCrdModels(data.models || []);
    } catch (err) {
      // CRD might not be installed — fall back silently
      console.warn('CRD fetch failed, falling back to registry:', err);
    }
  };

  // Fetch registry models
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

  // Trigger K8s discovery from flexinfer-system namespace
  const discoverModels = async () => {
    setDiscoverLoading(true);
    try {
      await modelsApi.discover('flexinfer-system');
      await Promise.all([fetchCRDModels(), fetchRegistryModels()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setDiscoverLoading(false);
    }
  };

  // Search models
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

  // CRD mutation actions
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
      await fetchCRDModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setCrdActionLoading(null);
    }
  };

  createEffect(() => {
    // Initial load — fetch both CRDs and registry
    Promise.all([fetchCRDModels(), fetchRegistryModels()]).finally(() => setLoading(false));
    // Also trigger discovery to sync registry
    discoverModels();
    const interval = setInterval(() => {
      fetchCRDModels();
      fetchRegistryModels();
    }, 15000);
    onCleanup(() => clearInterval(interval));
  });

  // SSE for real-time CRD model phase changes
  createEffect(() => {
    if (activeTab() !== 'controller') return;

    let es: EventSource | null = null;
    try {
      es = new EventSource(modelsApi.crdWatchSSEUrl('flexinfer-system'));
      es.addEventListener('model', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data);
          if (!event?.model) return;
          const incoming = event.model as FlexInferModel;
          setCrdModels((prev) => {
            const idx = prev.findIndex(m => m.name === incoming.name && m.namespace === incoming.namespace);
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
        } catch { /* ignore parse errors */ }
      });
      es.onerror = () => {
        // SSE disconnected — polling fallback handles it
        es?.close();
      };
    } catch { /* EventSource not supported — polling fallback */ }

    onCleanup(() => es?.close());
  });

  // Phase summary for header
  const phaseSummary = createMemo(() => {
    const counts: Record<string, number> = {};
    crdModels.forEach(m => {
      const phase = m.status?.phase || 'Unknown';
      counts[phase] = (counts[phase] || 0) + 1;
    });
    return counts;
  });

  return (
    <div class="flex h-full flex-col gap-4">
      {/* Header */}
      <div class="glass-panel px-4 py-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <h2 class="text-lg font-medium text-text-main">AI Models</h2>
            <div class="flex gap-1 rounded-md bg-white/5 p-1">
              <TabButton active={activeTab() === 'controller'} onClick={() => setActiveTab('controller')} label="Controller" count={crdModels.length} color="neon-cyan" />
              <TabButton active={activeTab() === 'registry'} onClick={() => setActiveTab('registry')} label="Registry" count={registryModels.length} color="neon-purple" />
              <TabButton active={activeTab() === 'search'} onClick={() => setActiveTab('search')} label="Search" color="status-ok" />
              <TabButton active={activeTab() === 'router'} onClick={() => setActiveTab('router')} label="Router" color="neon-cyan" />
              <TabButton active={activeTab() === 'compare'} onClick={() => setActiveTab('compare')} label="Compare" color="neon-purple" />
              <TabButton active={activeTab() === 'inference'} onClick={() => setActiveTab('inference')} label="Inference" color="status-ok" />
              <TabButton active={activeTab() === 'catalog'} onClick={() => setActiveTab('catalog')} label="Catalog" color="blue-400" />
            </div>
          </div>
          <div class="flex items-center gap-3">
            {/* Phase summary pills */}
            <Show when={activeTab() === 'controller' && crdModels.length > 0}>
              <div class="hidden items-center gap-1.5 sm:flex">
                <For each={Object.entries(phaseSummary())}>
                  {([phase, count]) => (
                    <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getPhaseClasses(phase)}`}>
                      {count} {phase}
                    </span>
                  )}
                </For>
              </div>
            </Show>
            <button
              onClick={() => discoverModels()}
              disabled={discoverLoading()}
              class="rounded-md bg-neon-purple/20 px-3 py-1.5 text-sm font-medium text-neon-purple transition-colors hover:bg-neon-purple/30 disabled:opacity-50"
            >
              {discoverLoading() ? 'Syncing...' : '⎈ Sync'}
            </button>
            <button
              onClick={() => { fetchCRDModels(); fetchRegistryModels(); }}
              disabled={loading()}
              class="rounded-md bg-neon-cyan/20 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      <Show when={error()}>
        <div class="glass-panel p-4 text-sm text-status-error">{error()}</div>
      </Show>

      <ErrorBoundary fallback={(err) => (
        <div class="glass-panel p-4 text-sm text-status-error border border-status-error/20">
          Rendering error: {err.message}
        </div>
      )}>
      <Switch>
        {/* Controller (CRD) Tab */}
        <Match when={activeTab() === 'controller'}>
          <Show
            when={!loading() || crdModels.length > 0}
            fallback={<LoadingState message="Querying flexinfer-system Model CRDs..." />}
          >
            <Show
              when={crdModels.length > 0}
              fallback={<EmptyState icon="⎈" title="No Model CRDs Found" subtitle="Apply Model CRDs to flexinfer-system namespace, then click Sync." />}
            >
              <ModelGPUTable />
              <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <For each={crdModels}>
                  {(model) => (
                    <CRDModelCard
                      model={model}
                      actionLoading={crdActionLoading()}
                      onActivate={() => handleCRDAction('activate', model)}
                      onScaleToZero={() => handleCRDAction('scale0', model)}
                      onRestart={() => handleCRDAction('restart', model)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Match>

        {/* Registry Tab */}
        <Match when={activeTab() === 'registry'}>
          <Show
            when={registryModels.length > 0}
            fallback={<EmptyState icon="📦" title="No Models in Registry" subtitle="Sync from flexinfer-system or search HuggingFace/CivitAI." />}
          >
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <For each={registryModels}>
                {(model) => (
                  <RegistryModelCard
                    model={model}
                    actionLoading={actionLoading()}
                    onDownload={() => handleStartDownload(model.id)}
                    onDelete={() => handleDelete(model.id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Match>

        {/* Search Tab */}
        <Match when={activeTab() === 'search'}>
          <div class="glass-panel p-4">
            <div class="flex gap-3">
              <select
                value={searchSource()}
                onChange={(e) => setSearchSource(e.target.value as 'huggingface' | 'civitai')}
                class="rounded-md bg-white/10 px-3 py-2 text-sm text-text-main"
              >
                <option value="huggingface">HuggingFace</option>
                <option value="civitai">CivitAI</option>
              </select>
              <input
                type="text"
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search models..."
                class="flex-1 rounded-md bg-white/10 px-4 py-2 text-sm text-text-main placeholder-text-dim focus:outline-none focus:ring-1 focus:ring-neon-cyan"
              />
              <button
                onClick={() => handleSearch()}
                disabled={searching() || !searchQuery().trim()}
                class="rounded-md bg-neon-cyan/20 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
              >
                {searching() ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>
          <Show when={searchResults.length > 0}>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <For each={searchResults}>
                {(model) => (
                  <SearchResultCard
                    model={model}
                    actionLoading={actionLoading()}
                    onRegister={() => handleRegister(model.source, model.source_id)}
                  />
                )}
              </For>
            </div>
          </Show>
        </Match>

        {/* Router Tab */}
        <Match when={activeTab() === 'router'}>
          <ErrorBoundary fallback={(err) => <div class="glass-panel p-4 text-status-error text-sm">Router panel error: {err.message}</div>}>
            <Suspense fallback={<div class="glass-panel p-4 text-text-dim animate-pulse">Loading router...</div>}>
              <LiteLLMRouterPanel />
            </Suspense>
          </ErrorBoundary>
        </Match>

        {/* Compare Tab */}
        <Match when={activeTab() === 'compare'}>
          <ErrorBoundary fallback={(err) => <div class="glass-panel p-4 text-status-error text-sm">Compare error: {err.message}</div>}>
            <Suspense fallback={<div class="glass-panel p-4 text-text-dim animate-pulse">Loading comparison...</div>}>
              <ModelComparison />
            </Suspense>
          </ErrorBoundary>
        </Match>

        {/* Inference Tab */}
        <Match when={activeTab() === 'inference'}>
          <ErrorBoundary fallback={(err) => <div class="glass-panel p-4 text-status-error text-sm">Inference error: {err.message}</div>}>
            <Suspense fallback={<div class="glass-panel p-4 text-text-dim animate-pulse">Loading inference metrics...</div>}>
              <InferenceTab />
            </Suspense>
          </ErrorBoundary>
        </Match>

        {/* Catalog Tab */}
        <Match when={activeTab() === 'catalog'}>
          <ErrorBoundary fallback={(err) => <div class="glass-panel p-4 text-status-error text-sm">Catalog error: {err.message}</div>}>
            <Suspense fallback={<div class="glass-panel p-4 text-text-dim animate-pulse">Loading catalogs...</div>}>
              <CatalogTab />
            </Suspense>
          </ErrorBoundary>
        </Match>
      </Switch>
      </ErrorBoundary>
    </div>
  );
};

// ─── Subcomponents ───

const TabButton: Component<{
  active: boolean; onClick: () => void; label: string; count?: number; color: string;
}> = (props) => (
  <button
    onClick={() => props.onClick()}
    class={`rounded px-3 py-1 text-sm transition-colors ${
      props.active
        ? `bg-${props.color}/20 text-${props.color}`
        : 'text-text-dim hover:text-text-main'
    }`}
  >
    {props.label}
    <Show when={props.count != null && props.count > 0}>
      <span class="ml-1.5 text-[10px] opacity-60">{props.count}</span>
    </Show>
  </button>
);

const LoadingState: Component<{ message: string }> = (props) => (
  <div class="glass-panel flex flex-1 items-center justify-center">
    <div class="text-center">
      <div class="mb-4 text-4xl animate-pulse text-neon-cyan">⬡</div>
      <p class="text-text-dim">{props.message}</p>
    </div>
  </div>
);

const EmptyState: Component<{ icon: string; title: string; subtitle: string }> = (props) => (
  <div class="glass-panel flex flex-1 items-center justify-center">
    <div class="text-center">
      <div class="mb-4 text-6xl text-neon-purple/30">{props.icon}</div>
      <h3 class="mb-2 text-xl font-medium text-text-main">{props.title}</h3>
      <p class="text-text-dim">{props.subtitle}</p>
    </div>
  </div>
);

// ─── Phase helpers ───

function getPhaseClasses(phase: string): string {
  switch (phase) {
    case 'Ready': return 'bg-status-ok/20 text-status-ok';
    case 'Loading': return 'bg-neon-cyan/20 text-neon-cyan';
    case 'Pending': return 'bg-status-warn/20 text-status-warn';
    case 'Idle': return 'bg-white/10 text-text-dim';
    case 'Preempted': return 'bg-neon-purple/20 text-neon-purple';
    case 'Failed': return 'bg-status-error/20 text-status-error';
    default: return 'bg-white/10 text-text-dim';
  }
}

function getPhaseIcon(phase?: string): string {
  switch (phase) {
    case 'Ready': return '●';
    case 'Loading': return '◐';
    case 'Pending': return '◔';
    case 'Idle': return '○';
    case 'Preempted': return '⊘';
    case 'Failed': return '✕';
    default: return '?';
  }
}

// ─── CRD Model Card (the rich controller card) ───

const CRDModelCard: Component<{
  model: FlexInferModel;
  actionLoading: string | null;
  onActivate: () => void;
  onScaleToZero: () => void;
  onRestart: () => void;
}> = (props) => {
  const [showEvents, setShowEvents] = createSignal(false);
  const phase = () => props.model.status?.phase || 'Unknown';
  const gpu = () => props.model.status?.gpu;
  const metrics = () => props.model.status?.metrics;
  const shared = () => props.model.status?.sharedGroup;
  const cache = () => props.model.status?.cache;
  const kvCache = () => props.model.status?.kvCache;
  const serverless = () => props.model.spec?.serverless;
  const litellm = () => props.model.spec?.litellm;
  const gpuSpec = () => props.model.spec?.gpu;

  const isReady = () => phase() === 'Ready';
  const isLoading = () => phase() === 'Loading' || phase() === 'Pending';
  const isIdle = () => phase() === 'Idle' || phase() === 'Preempted';
  const actionKey = () => `${props.model.namespace}/${props.model.name}`;

  return (
    <div class={`glass-panel p-4 transition-all duration-200 hover:-translate-y-0.5 ${
      isReady() ? 'ring-1 ring-status-ok/20' :
      phase() === 'Failed' ? 'ring-1 ring-status-error/20' :
      phase() === 'Preempted' ? 'ring-1 ring-neon-purple/20' : ''
    }`}>
      {/* Header: Name + Phase + Health Dot */}
      <div class="mb-3 flex items-start justify-between">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class={`h-2 w-2 rounded-full flex-shrink-0 ${
              isReady() ? 'bg-status-ok' :
              phase() === 'Failed' ? 'bg-status-error' :
              isLoading() ? 'bg-status-warn animate-pulse' :
              'bg-white/20'
            }`} />
            <h3 class="font-medium text-text-main truncate">{props.model.name}</h3>
          </div>
          <div class="mt-0.5 flex items-center gap-2 ml-4">
            <span class="text-[10px] font-mono text-text-dim">{props.model.namespace}</span>
            <span class="text-[10px] font-mono text-text-dim opacity-50">{props.model.spec.backend}</span>
          </div>
        </div>
        <div class={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${getPhaseClasses(phase())}`}>
          <span class={isLoading() ? 'animate-pulse' : ''}>{getPhaseIcon(phase())}</span>
          {phase()}
        </div>
      </div>

      {/* Source */}
      <div class="mb-3 rounded-md bg-white/5 px-3 py-1.5 text-xs text-text-dim font-mono truncate">
        {props.model.spec.source}
      </div>

      {/* Info grid */}
      <div class="mb-3 space-y-1.5 text-sm">
        {/* GPU Allocation */}
        <Show when={gpu()}>
          <div class="rounded-md bg-neon-purple/5 p-2 space-y-1">
            <div class="text-[10px] font-medium text-neon-purple uppercase tracking-wider">GPU Allocated</div>
            <div class="flex justify-between text-xs">
              <span class="text-text-dim">Node</span>
              <span class="text-text-muted font-mono">{gpu()!.node}</span>
            </div>
            <Show when={gpu()!.vendor}>
              <div class="flex justify-between text-xs">
                <span class="text-text-dim">Vendor</span>
                <span class="text-neon-purple font-mono">{gpu()!.vendor}</span>
              </div>
            </Show>
            <Show when={gpu()!.architecture}>
              <div class="flex justify-between text-xs">
                <span class="text-text-dim">Arch</span>
                <span class="text-text-muted font-mono">{gpu()!.architecture}</span>
              </div>
            </Show>
            <Show when={gpu()!.memoryMB}>
              <div class="flex justify-between text-xs">
                <span class="text-text-dim">VRAM</span>
                <span class="text-text-muted font-mono">{(gpu()!.memoryMB! / 1024).toFixed(1)} GB</span>
              </div>
            </Show>
          </div>
        </Show>

        {/* GPU Metrics from Prometheus */}
        <Show when={isReady() && gpu()?.node}>
          <GPUMetricsPanel node={gpu()!.node!} vendor={gpu()?.vendor} />
        </Show>

        {/* Runtime Metrics */}
        <Show when={metrics() && (metrics()!.tokensPerSecond || metrics()!.avgLatencyMs)}>
          <div class="rounded-md bg-status-ok/5 p-2 space-y-1">
            <div class="text-[10px] font-medium text-status-ok uppercase tracking-wider">Performance</div>
            <Show when={metrics()!.tokensPerSecond}>
              <div class="flex justify-between text-xs">
                <span class="text-text-dim">Throughput</span>
                <span class="text-status-ok font-mono font-medium">{metrics()!.tokensPerSecond} tok/s</span>
              </div>
            </Show>
            <Show when={metrics()!.avgLatencyMs}>
              <div class="flex justify-between text-xs">
                <span class="text-text-dim">Latency</span>
                <span class="text-text-muted font-mono">{metrics()!.avgLatencyMs} ms</span>
              </div>
            </Show>
            <Show when={metrics()!.loadTimeSeconds}>
              <div class="flex justify-between text-xs">
                <span class="text-text-dim">Load Time</span>
                <span class="text-text-muted font-mono">{metrics()!.loadTimeSeconds}s</span>
              </div>
            </Show>
          </div>
        </Show>

        {/* GPU Spec (from spec, not status) */}
        <Show when={!gpu() && gpuSpec()}>
          <div class="flex justify-between text-xs">
            <span class="text-text-dim">GPU Vendor</span>
            <span class="text-text-muted font-mono">{gpuSpec()!.vendor || 'auto'}</span>
          </div>
          <Show when={gpuSpec()!.count}>
            <div class="flex justify-between text-xs">
              <span class="text-text-dim">GPU Count</span>
              <span class="text-text-muted">{gpuSpec()!.count}</span>
            </div>
          </Show>
        </Show>

        {/* Shared GPU Group */}
        <Show when={gpuSpec()?.shared || shared()}>
          <div class="rounded-md bg-neon-cyan/5 p-2 space-y-1">
            <div class="text-[10px] font-medium text-neon-cyan uppercase tracking-wider">Shared GPU</div>
            <div class="flex justify-between text-xs">
              <span class="text-text-dim">Group</span>
              <span class="text-neon-cyan font-mono">{gpuSpec()?.shared || shared()?.groupName}</span>
            </div>
            <Show when={gpuSpec()?.priority != null}>
              <div class="flex justify-between text-xs">
                <span class="text-text-dim">Priority</span>
                <span class="text-text-muted">{gpuSpec()!.priority}</span>
              </div>
            </Show>
            <Show when={shared()?.state}>
              <div class="flex justify-between text-xs">
                <span class="text-text-dim">State</span>
                <span class={`font-medium ${
                  shared()!.state === 'Active' ? 'text-status-ok' :
                  shared()!.state === 'Queued' ? 'text-status-warn' :
                  'text-neon-purple'
                }`}>{shared()!.state}</span>
              </div>
            </Show>
            <Show when={shared()?.preemptedBy}>
              <div class="flex justify-between text-xs">
                <span class="text-text-dim">Preempted by</span>
                <span class="text-status-error font-mono">{shared()!.preemptedBy}</span>
              </div>
            </Show>
          </div>
        </Show>

        {/* KV-Cache Pressure */}
        <Show when={kvCache()}>
          <div class={`rounded-md p-2 space-y-1 ${
            kvCache()!.pressure ? 'bg-status-error/10' : 'bg-white/5'
          }`}>
            <div class="flex items-center justify-between">
              <div class="text-[10px] font-medium text-text-dim uppercase tracking-wider">KV-Cache</div>
              <Show when={kvCache()!.pressure}>
                <span class="rounded-full bg-status-error/20 px-2 py-0.5 text-[10px] text-status-error font-medium animate-pulse">
                  PRESSURE
                </span>
              </Show>
            </div>
            <Show when={kvCache()!.utilization}>
              <div class="flex items-center gap-2">
                <div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    class={`h-full rounded-full transition-all ${
                      kvCache()!.pressure ? 'bg-status-error' : 'bg-neon-cyan'
                    }`}
                    style={{ width: `${parseFloat(kvCache()!.utilization!) * 100}%` }}
                  />
                </div>
                <span class="text-xs text-text-muted font-mono">
                  {(parseFloat(kvCache()!.utilization!) * 100).toFixed(0)}%
                </span>
              </div>
            </Show>
          </div>
        </Show>

        {/* Cache Status */}
        <Show when={cache()}>
          <div class="flex justify-between text-xs">
            <span class="text-text-dim">Cache</span>
            <div class="flex items-center gap-1.5">
              <span class={`h-1.5 w-1.5 rounded-full ${
                cache()!.ready ? 'bg-status-ok' : 'bg-status-warn animate-pulse'
              }`} />
              <span class="text-text-muted">
                {cache()!.strategy || 'default'}
                {cache()!.jobPhase ? ` (${cache()!.jobPhase})` : ''}
              </span>
            </div>
          </div>
        </Show>

        {/* Serverless Config */}
        <Show when={serverless()}>
          <div class="flex justify-between text-xs">
            <span class="text-text-dim">Serverless</span>
            <span class="text-text-muted">
              {serverless()!.enabled !== false ? '✓' : '✕'}
              {serverless()!.idleTimeout ? ` (idle: ${serverless()!.idleTimeout})` : ''}
            </span>
          </div>
        </Show>

        {/* LiteLLM Integration */}
        <Show when={litellm() && litellm()!.enabled !== false}>
          <div class="flex justify-between text-xs">
            <span class="text-text-dim">LiteLLM</span>
            <span class="text-neon-cyan font-mono truncate max-w-[160px]">
              {litellm()!.servedModelName || props.model.name}
            </span>
          </div>
          <Show when={litellm()!.aliases && litellm()!.aliases!.length > 0}>
            <div class="flex justify-between text-xs">
              <span class="text-text-dim">Aliases</span>
              <span class="text-text-muted font-mono truncate max-w-[160px]">
                {litellm()!.aliases!.join(', ')}
              </span>
            </div>
          </Show>
        </Show>

        {/* Service Labels */}
        <Show when={props.model.spec.serviceLabels && props.model.spec.serviceLabels.length > 0}>
          <div class="flex flex-wrap gap-1 mt-1">
            <For each={props.model.spec.serviceLabels}>
              {(label) => (
                <span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-text-dim">{label}</span>
              )}
            </For>
          </div>
        </Show>

        {/* Endpoint */}
        <Show when={props.model.status?.endpoint}>
          <div class="flex justify-between text-xs">
            <span class="text-text-dim">Endpoint</span>
            <span class="text-text-muted font-mono truncate max-w-[180px]">{props.model.status!.endpoint}</span>
          </div>
        </Show>
      </div>

      {/* Conditions (collapsed) */}
      <Show when={props.model.status?.conditions && props.model.status.conditions.length > 0}>
        <div class="mt-2 border-t border-white/5 pt-2">
          <div class="flex flex-wrap gap-1.5">
            <For each={props.model.status!.conditions}>
              {(cond) => (
                <span
                  class={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                    cond.status === 'True' ? 'bg-status-ok/10 text-status-ok' :
                    cond.status === 'False' ? 'bg-status-error/10 text-status-error' :
                    'bg-white/5 text-text-dim'
                  }`}
                  title={cond.message || cond.reason || ''}
                >
                  {cond.type}
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Action Bar */}
      <div class="mt-3 flex gap-2 border-t border-white/5 pt-3">
        <Show when={isIdle()}>
          <button
            onClick={() => props.onActivate()}
            disabled={props.actionLoading?.startsWith(actionKey())}
            class="flex-1 rounded-md bg-status-ok/20 px-3 py-1.5 text-xs font-medium text-status-ok transition-colors hover:bg-status-ok/30 disabled:opacity-50"
          >
            {props.actionLoading === `${actionKey()}/activate` ? 'Activating...' : 'Activate'}
          </button>
        </Show>
        <Show when={isReady() || isLoading()}>
          <button
            onClick={() => props.onScaleToZero()}
            disabled={props.actionLoading?.startsWith(actionKey())}
            class="flex-1 rounded-md bg-status-warn/20 px-3 py-1.5 text-xs font-medium text-status-warn transition-colors hover:bg-status-warn/30 disabled:opacity-50"
          >
            {props.actionLoading === `${actionKey()}/scale0` ? 'Scaling...' : 'Scale to 0'}
          </button>
        </Show>
        <button
          onClick={() => props.onRestart()}
          disabled={props.actionLoading?.startsWith(actionKey())}
          class="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-white/20 disabled:opacity-50"
        >
          {props.actionLoading === `${actionKey()}/restart` ? '...' : 'Restart'}
        </button>
        <button
          onClick={() => setShowEvents(!showEvents())}
          class={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            showEvents()
              ? 'bg-neon-cyan/20 text-neon-cyan'
              : 'bg-white/10 text-text-muted hover:bg-white/20'
          }`}
        >
          Events
        </button>
      </div>

      {/* Events Timeline */}
      <Show when={showEvents()}>
        <Suspense fallback={<div class="py-2 text-xs text-text-dim animate-pulse">Loading events...</div>}>
          <ModelEventsTimeline namespace={props.model.namespace} name={props.model.name} />
        </Suspense>
      </Show>
    </div>
  );
};

// ─── Registry Model Card ───

const RegistryModelCard: Component<{
  model: RegisteredModel;
  actionLoading: string | null;
  onDownload: () => void;
  onDelete: () => void;
}> = (props) => {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'deployed': case 'completed': return 'text-status-ok';
      case 'pending': case 'downloading': return 'text-status-warn';
      case 'stopped': case 'none': return 'text-text-dim';
      default: return 'text-status-error';
    }
  };

  return (
    <div class="glass-panel p-4">
      <div class="mb-3 flex items-start justify-between">
        <div class="flex-1 min-w-0">
          <h3 class="font-medium text-text-main truncate">{props.model.name}</h3>
          <p class="text-xs text-text-dim truncate">{props.model.source_id || props.model.id}</p>
        </div>
        <span class={`ml-2 rounded-full px-2 py-0.5 text-xs flex-shrink-0 ${
          props.model.source === 'huggingface' ? 'bg-yellow-500/20 text-yellow-400' :
          props.model.source === 'local' ? 'bg-neon-purple/20 text-neon-purple' :
          'bg-blue-500/20 text-blue-400'
        }`}>
          {props.model.source === 'huggingface' ? '🤗 HF' : props.model.source === 'local' ? '⎈ Local' : '🎨 Civit'}
        </span>
      </div>

      <p class="mb-3 text-xs text-text-dim line-clamp-2">{props.model.description || 'No description'}</p>

      <div class="mb-3 space-y-1 text-xs">
        <div class="flex justify-between">
          <span class="text-text-dim">Type</span>
          <span class="text-text-muted capitalize">{props.model.type}</span>
        </div>
        <Show when={props.model.deployment_status !== 'none'}>
          <div class="flex justify-between">
            <span class="text-text-dim">Status</span>
            <span class={getStatusColor(props.model.deployment_status)}>
              {props.model.deployment_status}
            </span>
          </div>
        </Show>
        <Show when={props.model.metadata?.parameters}>
          <div class="flex justify-between">
            <span class="text-text-dim">Params</span>
            <span class="text-text-muted font-mono">{props.model.metadata!.parameters}</span>
          </div>
        </Show>
      </div>

      <Show when={props.model.download_status === 'downloading'}>
        <div class="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
          <div class="h-full bg-neon-cyan transition-all" style={{ width: `${props.model.download_progress}%` }} />
        </div>
      </Show>

      <div class="flex gap-2">
        <Show when={props.model.download_status === 'pending' || props.model.download_status === 'failed'}>
          <button
            onClick={() => props.onDownload()}
            disabled={props.actionLoading === props.model.id}
            class="flex-1 rounded-md bg-neon-cyan/20 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
          >
            Download
          </button>
        </Show>
        <button
          onClick={() => props.onDelete()}
          disabled={props.actionLoading === props.model.id}
          class="rounded-md bg-status-error/20 px-3 py-1.5 text-sm font-medium text-status-error transition-colors hover:bg-status-error/30 disabled:opacity-50"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

// ─── Search Result Card ───

const SearchResultCard: Component<{
  model: RegisteredModel;
  actionLoading: string | null;
  onRegister: () => void;
}> = (props) => {
  const formatSize = (bytes: number) => {
    if (!bytes) return 'Unknown';
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  return (
    <div class="glass-panel p-4">
      <div class="mb-3 flex items-start justify-between">
        <div class="flex-1 min-w-0">
          <h3 class="font-medium text-text-main truncate">{props.model.name}</h3>
          <p class="text-xs text-text-dim truncate">{props.model.source_id}</p>
        </div>
        <span class={`ml-2 rounded-full px-2 py-0.5 text-xs ${
          props.model.source === 'huggingface' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
        }`}>
          {props.model.source === 'huggingface' ? '🤗 HF' : '🎨 Civit'}
        </span>
      </div>
      <p class="mb-3 text-xs text-text-dim line-clamp-2">{props.model.description || 'No description'}</p>
      <div class="mb-3 flex flex-wrap gap-1">
        <For each={(props.model.tags || []).slice(0, 4)}>
          {(tag) => <span class="rounded-full bg-white/10 px-2 py-0.5 text-xs text-text-dim">{tag}</span>}
        </For>
      </div>
      <div class="mb-3 flex justify-between text-xs">
        <span class="text-text-dim">Size: {formatSize(props.model.size)}</span>
        <span class="text-text-dim capitalize">{props.model.type}</span>
      </div>
      <button
        onClick={() => props.onRegister()}
        disabled={props.actionLoading === props.model.source_id}
        class="w-full rounded-md bg-status-ok/20 px-3 py-1.5 text-sm font-medium text-status-ok transition-colors hover:bg-status-ok/30 disabled:opacity-50"
      >
        {props.actionLoading === props.model.source_id ? 'Adding...' : 'Add to Registry'}
      </button>
    </div>
  );
};

export default Models;
