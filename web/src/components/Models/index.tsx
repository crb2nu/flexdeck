import { Component, createSignal, For, Show, Switch, Match, createMemo, ErrorBoundary, lazy, Suspense } from 'solid-js';
import type {
  RegisteredModel,
  FlexInferModel,
  InferenceMetrics,
  LoRAAdapter,
} from '../../lib/types';
import type { LiteLLMModelThroughput } from '../../lib/api/infrastructure';
import GPUMetricsPanel from './GPUMetricsPanel';
import ModelGPUTable from './ModelGPUTable';
import { PageScrollBody, TabBar, LoadingState, EmptyState } from '../shared';
import type { TabDef } from '../shared';
import {
  getReliabilityClasses,
  getReliabilityStatus,
  type IntegrationFetchState,
  summarizeLoRA,
} from './controllerIntegration';
import { useModelsController, type ModelsTab } from './useModelsController';
import { healthStore } from '../../stores/health';

const LiteLLMRouterPanel = lazy(() => import('./LiteLLMRouterPanel'));
const ModelComparison = lazy(() => import('./ModelComparison'));
const ModelEventsTimeline = lazy(() => import('./ModelEventsTimeline'));
const InferenceTab = lazy(() => import('./InferenceTab'));
const CatalogTab = lazy(() => import('./CatalogTab'));
const ProxyTab = lazy(() => import('./ProxyTab'));
const PipelinesTab = lazy(() => import('./PipelinesTab'));

const Models: Component = () => {
  const [activeTab, setActiveTab] = createSignal<ModelsTab>('controller');
  const {
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
    registryModels,
    reliabilitySummary,
    searchQuery,
    searchResults,
    searchSource,
    searching,
    setSearchQuery,
    setSearchSource,
    throughputByModel,
  } = useModelsController(activeTab, setActiveTab);

  const modelKey = (namespace: string, name: string) => `${namespace}/${name}`;

  const tabs = createMemo<TabDef<ModelsTab>[]>(() => {
    const base: TabDef<ModelsTab>[] = [
      { id: 'controller', label: 'Controller', count: () => crdModels().length, color: 'neon-cyan' },
      { id: 'registry', label: 'Registry', count: () => registryModels().length, color: 'neon-purple' },
      { id: 'search', label: 'Search', color: 'status-ok' },
      { id: 'router', label: 'Router', color: 'neon-cyan' },
      { id: 'compare', label: 'Compare', color: 'neon-purple' },
      { id: 'inference', label: 'Inference', color: 'status-ok' },
      { id: 'catalog', label: 'Catalog', color: 'blue-400' },
    ];
    if (healthStore.features?.flexinfer_proxy?.enabled) {
      base.push({ id: 'proxy', label: 'Proxy', color: 'status-ok' });
    }
    if (healthStore.features?.modelcache?.enabled) {
      base.push({ id: 'pipelines', label: 'Pipelines', color: 'neon-purple' });
    }
    return base;
  });

  return (
    <div class="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div class="glass-panel px-4 py-3">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <h2 class="text-lg font-medium text-text-main">AI Models</h2>
            <TabBar<ModelsTab>
              tabs={tabs()}
              active={activeTab()}
              onChange={setActiveTab}
              size="sm"
              class="p-1"
            />
          </div>
          <div class="flex flex-wrap items-center gap-2 sm:gap-3">
            {/* Phase summary pills */}
            <Show when={activeTab() === 'controller' && crdModels().length > 0}>
              <div class="hidden flex-col gap-1 sm:flex">
                <div class="flex items-center gap-1.5">
                  <For each={Object.entries(phaseSummary())}>
                    {([phase, count]) => (
                      <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getPhaseClasses(phase)}`}>
                        {count} {phase}
                      </span>
                    )}
                  </For>
                </div>
                <div class="flex items-center gap-1.5">
                  <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getReliabilityClasses('healthy')}`}>
                    {reliabilitySummary().healthy} healthy
                  </span>
                  <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getReliabilityClasses('degraded')}`}>
                    {reliabilitySummary().degraded} degraded
                  </span>
                  <Show when={reliabilitySummary().partial > 0}>
                    <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getReliabilityClasses('partial')}`}>
                      {reliabilitySummary().partial} partial
                    </span>
                  </Show>
                  <span class="rounded-full bg-neon-purple/20 px-2 py-0.5 text-[10px] font-medium text-neon-purple">
                    LoRA {loraSummary().loaded}/{loraSummary().total}
                  </span>
                  <Show when={integrationSummary().inferenceUnavailable > 0}>
                    <span class="rounded-full bg-status-warn/20 px-2 py-0.5 text-[10px] font-medium text-status-warn">
                      {integrationSummary().inferenceUnavailable} inference unavailable
                    </span>
                  </Show>
                  <Show when={integrationSummary().loraUnavailable > 0}>
                    <span class="rounded-full bg-status-warn/20 px-2 py-0.5 text-[10px] font-medium text-status-warn">
                      {integrationSummary().loraUnavailable} LoRA unavailable
                    </span>
                  </Show>
                </div>
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

      <PageScrollBody contentClass="gap-4">
        <ErrorBoundary fallback={(err) => (
          <div class="glass-panel p-4 text-sm text-status-error border border-status-error/20">
            Rendering error: {err.message}
          </div>
        )}>
          <Switch>
            {/* Controller (CRD) Tab */}
            <Match when={activeTab() === 'controller'}>
              <Show
                when={!loading() || crdModels().length > 0}
                fallback={<LoadingState message="Querying Model CRDs..." />}
              >
                <Show
                  when={crdModels().length > 0}
                  fallback={<EmptyState icon="⎈" title="No Model CRDs Found" subtitle="Apply Model CRDs to your AI namespace, then click Sync." />}
                >
                  <div class="flex flex-col gap-4">
                    <ModelGPUTable />
                    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                      <For each={crdModels()}>
                        {(model) => (
                          <CRDModelCard
                            model={model}
                            inference={inferenceByModel()[modelKey(model.namespace, model.name)]}
                            adapters={loraByModel()[modelKey(model.namespace, model.name)]}
                            throughput={throughputByModel()[modelKey(model.namespace, model.name)]}
                            integrationState={integrationByModel()[modelKey(model.namespace, model.name)]}
                            integrationLoading={controllerDataLoading()}
                            actionLoading={crdActionLoading()}
                            onActivate={() => handleCRDAction('activate', model)}
                            onScaleToZero={() => handleCRDAction('scale0', model)}
                            onRestart={() => handleCRDAction('restart', model)}
                          />
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </Show>
            </Match>

            {/* Registry Tab */}
            <Match when={activeTab() === 'registry'}>
              <Show
                when={registryModels().length > 0}
                fallback={<EmptyState icon="📦" title="No Models in Registry" subtitle="Sync from K8s or search HuggingFace/CivitAI." />}
              >
                <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <For each={registryModels()}>
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
              <div class="flex flex-col gap-4">
                <div class="glass-panel p-4">
                  <div class="flex flex-col gap-3 sm:flex-row">
                    <select
                      value={searchSource()}
                      onChange={(e) => setSearchSource(e.currentTarget.value as 'huggingface' | 'civitai')}
                      class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main sm:w-auto"
                    >
                      <option value="huggingface">HuggingFace</option>
                      <option value="civitai">CivitAI</option>
                    </select>
                    <input
                      type="text"
                      value={searchQuery()}
                      onInput={(e) => setSearchQuery(e.currentTarget.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      placeholder="Search models..."
                      class="flex-1 min-w-0 rounded-md bg-white/10 px-4 py-2 text-sm text-text-main placeholder-text-dim focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                    />
                    <button
                      onClick={() => handleSearch()}
                      disabled={searching() || !searchQuery().trim()}
                      class="w-full rounded-md bg-neon-cyan/20 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50 sm:w-auto"
                    >
                      {searching() ? 'Searching...' : 'Search'}
                    </button>
                  </div>
                </div>
                <Show when={searchResults().length > 0}>
                  <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <For each={searchResults()}>
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
              </div>
            </Match>

            {/* Router Tab */}
            <Match when={activeTab() === 'router'}>
              <ErrorBoundary fallback={(err) => <div class="glass-panel p-4 text-status-error text-sm">Router panel error: {err.message}</div>}>
                <Suspense fallback={<LoadingState variant="inline" size="sm" message="Loading router..." />}>
                  <LiteLLMRouterPanel />
                </Suspense>
              </ErrorBoundary>
            </Match>

            {/* Compare Tab */}
            <Match when={activeTab() === 'compare'}>
              <ErrorBoundary fallback={(err) => <div class="glass-panel p-4 text-status-error text-sm">Compare error: {err.message}</div>}>
                <Suspense fallback={<LoadingState variant="inline" size="sm" message="Loading comparison..." />}>
                  <ModelComparison />
                </Suspense>
              </ErrorBoundary>
            </Match>

            {/* Inference Tab */}
            <Match when={activeTab() === 'inference'}>
              <ErrorBoundary fallback={(err) => <div class="glass-panel p-4 text-status-error text-sm">Inference error: {err.message}</div>}>
                <Suspense fallback={<LoadingState variant="inline" size="sm" message="Loading inference metrics..." />}>
                  <InferenceTab />
                </Suspense>
              </ErrorBoundary>
            </Match>

            {/* Catalog Tab */}
            <Match when={activeTab() === 'catalog'}>
              <ErrorBoundary fallback={(err) => <div class="glass-panel p-4 text-status-error text-sm">Catalog error: {err.message}</div>}>
                <Suspense fallback={<LoadingState variant="inline" size="sm" message="Loading catalogs..." />}>
                  <CatalogTab />
                </Suspense>
              </ErrorBoundary>
            </Match>

            {/* Proxy Tab */}
            <Match when={activeTab() === 'proxy'}>
              <ErrorBoundary fallback={(err) => <div class="glass-panel p-4 text-status-error text-sm">Proxy error: {err.message}</div>}>
                <Suspense fallback={<LoadingState variant="inline" size="sm" message="Loading proxy metrics..." />}>
                  <ProxyTab />
                </Suspense>
              </ErrorBoundary>
            </Match>

            {/* Pipelines Tab */}
            <Match when={activeTab() === 'pipelines'}>
              <ErrorBoundary fallback={(err) => <div class="glass-panel p-4 text-status-error text-sm">Pipelines error: {err.message}</div>}>
                <Suspense fallback={<LoadingState variant="inline" size="sm" message="Loading pipelines..." />}>
                  <PipelinesTab />
                </Suspense>
              </ErrorBoundary>
            </Match>
          </Switch>
        </ErrorBoundary>
      </PageScrollBody>
    </div>
  );
};

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
  inference?: InferenceMetrics;
  adapters?: LoRAAdapter[];
  throughput?: LiteLLMModelThroughput;
  integrationState?: IntegrationFetchState;
  integrationLoading: boolean;
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
  const reliability = createMemo(() => getReliabilityStatus(props.inference));
  const lora = createMemo(() => summarizeLoRA(props.adapters));

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
        <div class="flex flex-col items-end gap-1">
          <div class={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${getPhaseClasses(phase())}`}>
            <span class={isLoading() ? 'animate-pulse' : ''}>{getPhaseIcon(phase())}</span>
            {phase()}
          </div>
          <div class={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${getReliabilityClasses(reliability().level)}`}>
            {reliability().label}
          </div>
        </div>
      </div>

      {/* Feature badges */}
      <div class="mb-2 flex flex-wrap gap-1">
        <Show when={serverless()?.enabled !== false && serverless()}>
          <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            phase() === 'Idle' ? 'bg-white/10 text-text-dim' : 'bg-status-ok/20 text-status-ok'
          }`}>
            Serverless{serverless()?.idleTimeout ? ` ${serverless()!.idleTimeout}` : ''}
          </span>
        </Show>
        <Show when={cache()}>
          <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            cache()!.ready ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-status-warn/20 text-status-warn'
          }`}>
            {cache()!.strategy || 'Cache'}{cache()!.ready ? '' : ' ...'}
          </span>
        </Show>
        <Show when={gpuSpec()?.shared}>
          <span class="rounded-full bg-neon-purple/20 px-2 py-0.5 text-[10px] font-medium text-neon-purple">
            Shared: {gpuSpec()!.shared}
          </span>
        </Show>
        <Show when={kvCache()}>
          <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            kvCache()!.pressure ? 'bg-status-error/20 text-status-error animate-pulse' : 'bg-white/10 text-text-dim'
          }`}>
            KV {kvCache()!.utilization ? `${(parseFloat(kvCache()!.utilization!) * 100).toFixed(0)}%` : '-'}
          </span>
        </Show>
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

        {/* Inference Reliability Metrics (Prometheus-derived) */}
        <Show when={props.inference}>
          <div class={`rounded-md p-2 space-y-1 ${
            reliability().level === 'degraded'
              ? 'bg-status-error/10'
              : reliability().level === 'partial'
                ? 'bg-status-warn/10'
                : 'bg-white/5'
          }`}>
            <div class="flex items-center justify-between">
              <div class="text-[10px] font-medium text-text-dim uppercase tracking-wider">Inference Reliability</div>
              <Show when={props.inference?.partial}>
                <span class="rounded-full bg-status-warn/20 px-2 py-0.5 text-[10px] font-medium text-status-warn">
                  partial
                </span>
              </Show>
            </div>
            <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div class="flex justify-between gap-2">
                <span class="text-text-dim">Error %</span>
                <span class="font-mono text-text-muted">{((props.inference?.errorRate ?? 0) * 100).toFixed(2)}%</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-dim">Queue p95</span>
                <span class="font-mono text-text-muted">{(props.inference?.queueWaitP95Ms ?? 0).toFixed(0)} ms</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-dim">Rejected/s</span>
                <span class="font-mono text-text-muted">{(props.inference?.rejectedRequestsPerSec ?? 0).toFixed(3)}</span>
              </div>
              <div class="flex justify-between gap-2">
                <span class="text-text-dim">Retries 5m</span>
                <span class="font-mono text-text-muted">{(props.inference?.activationRetries5m ?? 0).toFixed(2)}</span>
              </div>
            </div>
          </div>
        </Show>

        <Show when={props.integrationLoading && !props.inference}>
          <div class="text-[10px] text-text-dim animate-pulse">Loading inference metrics...</div>
        </Show>
        <Show when={!props.integrationLoading && props.integrationState && !props.integrationState.inferenceAvailable}>
          <div class="text-[10px] text-status-warn">
            Inference telemetry unavailable for this model.
          </div>
        </Show>

        {/* LiteLLM Throughput Metrics */}
        <Show when={props.throughput}>
          {(() => {
            const tp = () => props.throughput!;
            const sparkline = () => tp().sparkline || [];
            const trendIcon = () => tp().trend === 'up' ? '↑' : tp().trend === 'down' ? '↓' : '→';
            const trendColor = () => tp().trend === 'up' ? 'text-status-ok' : tp().trend === 'down' ? 'text-status-error' : 'text-text-dim';

            // Mini sparkline SVG
            const SparklineSVG = () => {
              const data = sparkline();
              if (data.length < 2) return null;
              const max = Math.max(...data, 0.001);
              const w = 120;
              const h = 24;
              const points = data.map((v, i) =>
                `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 2)}`
              ).join(' ');
              return (
                <svg width={w} height={h} class="opacity-80">
                  <polyline
                    points={points}
                    fill="none"
                    stroke="var(--neon-cyan, #22d3ee)"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              );
            };

            return (
              <div class="rounded-md bg-neon-cyan/5 p-2 space-y-1.5">
                <div class="flex items-center justify-between">
                  <div class="text-[10px] font-medium text-neon-cyan uppercase tracking-wider">LiteLLM Throughput</div>
                  <span class={`text-xs font-medium ${trendColor()}`}>{trendIcon()}</span>
                </div>
                <Show when={sparkline().length >= 2}>
                  <SparklineSVG />
                </Show>
                <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div class="flex justify-between gap-2">
                    <span class="text-text-dim">tok/s (1m)</span>
                    <span class="font-mono text-neon-cyan font-medium">{tp().tok_per_sec_1m.toFixed(1)}</span>
                  </div>
                  <div class="flex justify-between gap-2">
                    <span class="text-text-dim">tok/s (5m)</span>
                    <span class="font-mono text-text-muted">{tp().tok_per_sec_5m.toFixed(1)}</span>
                  </div>
                  <div class="flex justify-between gap-2">
                    <span class="text-text-dim">req/min</span>
                    <span class="font-mono text-text-muted">{tp().requests_per_min.toFixed(1)}</span>
                  </div>
                  <div class="flex justify-between gap-2">
                    <span class="text-text-dim">latency</span>
                    <span class="font-mono text-text-muted">{tp().avg_latency_ms.toFixed(0)} ms</span>
                  </div>
                </div>
              </div>
            );
          })()}
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
            <Show when={shared()?.queuePosition != null && shared()!.queuePosition! > 0}>
              <div class="flex justify-between text-xs">
                <span class="text-text-dim">Queue Pos</span>
                <span class="text-text-muted font-mono">{shared()!.queuePosition}</span>
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

        {/* LoRA Adapter Integration */}
        <Show when={props.adapters && props.adapters.length > 0}>
          <div class="rounded-md bg-neon-purple/5 p-2 space-y-1">
            <div class="flex items-center justify-between">
              <div class="text-[10px] font-medium text-neon-purple uppercase tracking-wider">LoRA Adapters</div>
              <div class="text-[10px] text-text-dim">
                {lora().loaded}/{lora().total} loaded
              </div>
            </div>
            <div class="flex flex-wrap gap-1">
              <For each={(props.adapters || []).slice(0, 4)}>
                {(adapter) => (
                  <span
                    class={`rounded-full px-2 py-0.5 text-[10px] ${
                      adapter.state === 'Loaded'
                        ? 'bg-status-ok/20 text-status-ok'
                        : adapter.state === 'Pending'
                          ? 'bg-status-warn/20 text-status-warn'
                          : 'bg-neon-purple/20 text-neon-purple'
                    }`}
                    title={adapter.adapterSource}
                  >
                    {adapter.name}
                  </span>
                )}
              </For>
              <Show when={(props.adapters || []).length > 4}>
                <span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-text-dim">
                  +{(props.adapters || []).length - 4}
                </span>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={props.integrationLoading && (!props.adapters || props.adapters.length === 0)}>
          <div class="text-[10px] text-text-dim animate-pulse">Loading LoRA adapters...</div>
        </Show>
        <Show when={!props.integrationLoading && props.integrationState && !props.integrationState.loraAvailable}>
          <div class="text-[10px] text-status-warn">LoRA adapter status unavailable for this model.</div>
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
      <div class="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
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
          class="flex-1 rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-white/20 disabled:opacity-50 sm:flex-none"
        >
          {props.actionLoading === `${actionKey()}/restart` ? '...' : 'Restart'}
        </button>
        <button
          onClick={() => setShowEvents(!showEvents())}
          class={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none ${
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
