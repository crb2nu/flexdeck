import { Component, For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { resolveFreshness } from '../../lib/freshness';
import { healthStore } from '../../stores/health';
import { getFlexInferManagementMode } from '../../lib/featureFlags';
import { modelsApi, flexinferProxyApi, litellm } from '../../lib/api';
import type {
  FlexInferProxyMetricsResponse,
  LiteLLMRouterResponse,
  ModelCache,
  ModelCatalogEntry,
} from '../../lib/types';
import {
  getReliabilityClasses,
  getReliabilityStatus,
} from '../Models/controllerIntegration';
import {
  useModelsController,
  type ModelsTab,
} from '../Models/useModelsController';
import {
  activeConnectionsForModel,
  errorRateForModel as proxyErrorRateForModel,
  hasProxyMetricsForModel,
  queueDepthForModel,
  requestsForModel,
} from '../Models/inferenceMetrics';

type Surface = 'models' | 'admin';

interface FlexInferProxyHealth {
  healthy?: boolean;
  status?: string;
  mode?: string;
  partial?: boolean;
  message?: string;
}

interface WorkbenchProps {
  surface?: Surface;
}

const controlPlaneOrder: Record<string, number> = {
  Failed: 0,
  Preempted: 1,
  Pending: 2,
  Loading: 3,
  Idle: 4,
  Ready: 5,
};

const FlexInferWorkbench: Component<WorkbenchProps> = (props) => {
  const surface = () => props.surface ?? 'models';
  const isAdminSurface = () => surface() === 'admin';
  const managementMode = () => getFlexInferManagementMode(healthStore.features || {});
  const proxyEnabled = () => healthStore.features?.flexinfer_proxy?.enabled ?? false;
  const modelCacheEnabled = () => healthStore.features?.modelcache?.enabled ?? false;

  const [activeTab] = createSignal<ModelsTab>('controller');
  const noopSetActiveTab = () => undefined;
  const controller = useModelsController(activeTab, noopSetActiveTab);

  const [proxyMetrics, setProxyMetrics] = createSignal<FlexInferProxyMetricsResponse | null>(null);
  const [proxyHealth, setProxyHealth] = createSignal<FlexInferProxyHealth | null>(null);
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
  const [controllerUpdatedAt, setControllerUpdatedAt] = createSignal(0);

  const proxyHealthClass = () => {
    if (!proxyEnabled()) return 'bg-white/10 text-text-dim';
    if (proxyError()) return 'bg-status-error/20 text-status-error';
    if (proxyHealth()?.healthy === false || proxyHealth()?.status === 'error') {
      return 'bg-status-error/20 text-status-error';
    }
    if (resolveFreshness(proxyUpdatedAt(), 15_000) === 'stale') {
      return 'bg-status-warn/20 text-status-warn';
    }
    return 'bg-status-ok/20 text-status-ok';
  };

  const proxyHealthLabel = () => {
    if (!proxyEnabled()) return 'Disabled';
    if (proxyError()) return 'Offline';
    if (proxyHealth()?.healthy === false) return proxyHealth()?.status || 'Degraded';
    return proxyHealth()?.status || 'Healthy';
  };

  const proxyHealthTone = () => {
    if (!proxyEnabled()) return 'text-text-dim';
    if (proxyError()) return 'text-status-error';
    if (proxyHealth()?.healthy === false || proxyHealth()?.status === 'error') return 'text-status-error';
    if (resolveFreshness(proxyUpdatedAt(), 15_000) === 'stale') return 'text-status-warn';
    return 'text-status-ok';
  };

  const refreshProxy = async () => {
    if (!proxyEnabled()) {
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
    } else if (metricsResult.status === 'rejected') {
      setProxyError(metricsResult.reason instanceof Error ? metricsResult.reason.message : 'Failed to fetch proxy metrics');
      setProxyMetrics(null);
    }

    setProxyLoading(false);
  };

  const refreshRouter = async () => {
    if (!proxyEnabled()) {
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
  };

  const refreshCatalogs = async () => {
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
  };

  const refreshCaches = async () => {
    if (!modelCacheEnabled()) {
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
  };

  const refreshWorkbench = async () => {
    await Promise.all([
      controller.fetchCRDModels(),
      controller.fetchRegistryModels(),
      refreshProxy(),
      refreshRouter(),
      refreshCatalogs(),
      refreshCaches(),
    ]);
    setControllerUpdatedAt(Date.now());
  };

  onMount(() => {
    void refreshWorkbench();
  });

  createPolling('flexinfer-workbench-proxy', refreshProxy, 15_000, proxyEnabled);
  createPolling('flexinfer-workbench-router', refreshRouter, 30_000, proxyEnabled);
  createPolling('flexinfer-workbench-catalogs', refreshCatalogs, 60_000);
  createPolling('flexinfer-workbench-caches', refreshCaches, 30_000, modelCacheEnabled);

  const modelRows = createMemo(() => {
    const items = controller.crdModels().map((model) => {
      const key = `${model.namespace}/${model.name}`;
      const reliability = getReliabilityStatus(controller.inferenceByModel()[key]);
      return {
        model,
        key,
        reliability,
        adapters: controller.loraByModel()[key] || [],
        throughput: controller.throughputByModel()[key],
        integrationState: controller.integrationByModel()[key],
      };
    });

    return items.sort((a, b) => {
      const aRank = controlPlaneOrder[a.model.status?.phase || 'Unknown'] ?? 99;
      const bRank = controlPlaneOrder[b.model.status?.phase || 'Unknown'] ?? 99;
      if (aRank !== bRank) return aRank - bRank;
      return `${a.model.namespace}/${a.model.name}`.localeCompare(`${b.model.namespace}/${b.model.name}`);
    });
  });

  const proxyModelRows = createMemo(() => {
    const metrics = proxyMetrics();
    if (!metrics?.byModel) return [];
    return Object.entries(metrics.byModel)
      .filter(([name]) => name !== '_total')
      .sort(([, left], [, right]) => {
        const leftScore = (left.queueDepth || 0) * 10 + (left.errorsTotal || 0);
        const rightScore = (right.queueDepth || 0) * 10 + (right.errorsTotal || 0);
        if (leftScore !== rightScore) return rightScore - leftScore;
        return 0;
      });
  });

  const registryRows = createMemo(() => controller.registryModels().slice().sort((a, b) => a.name.localeCompare(b.name)));
  const searchResults = () => controller.searchResults();
  const cachedReady = () => caches().filter((cache) => cache.status?.phase === 'Ready').length;
  const cachedFailed = () => caches().filter((cache) => cache.status?.phase === 'Failed').length;
  const catalogModelCount = () => catalogs().reduce((sum, catalog) => sum + (catalog.models?.length || 0), 0);
  const proxyTotals = () => proxyMetrics()?.totals;
  const routerModels = () => routerInfo()?.modelInfo || [];
  const reliabilityHeadline = createMemo(() => {
    const summary = controller.reliabilitySummary();
    if (summary.degraded > 0) return { level: 'degraded' as const, label: `${summary.degraded} degraded` };
    if (summary.partial > 0) return { level: 'partial' as const, label: `${summary.partial} partial` };
    if (summary.unknown > 0) return { level: 'unknown' as const, label: `${summary.unknown} unknown` };
    return { level: 'healthy' as const, label: `${summary.healthy} healthy` };
  });

  const sections = [
    { id: 'control-plane', label: 'Control plane' },
    { id: 'telemetry', label: 'Telemetry' },
    { id: 'supply-chain', label: 'Supply chain' },
    { id: 'intake', label: 'Intake' },
  ];

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div class="flex flex-col gap-4">
      <div
        class={`glass-panel overflow-hidden border border-white/10 ${
          isAdminSurface()
            ? 'bg-gradient-to-br from-status-warn/10 via-white/5 to-neon-purple/10'
            : 'bg-gradient-to-br from-neon-cyan/10 via-white/5 to-neon-purple/10'
        }`}
      >
        <div class="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div class="min-w-0 space-y-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">
                FlexInfer Workbench
              </span>
              <span class={`rounded-full px-2.5 py-1 text-[10px] font-medium ${proxyHealthClass()}`}>
                Proxy {proxyHealthLabel()}
              </span>
              <span class={`rounded-full px-2.5 py-1 text-[10px] font-medium ${getReliabilityClasses(reliabilityHeadline().level)}`}>
                {reliabilityHeadline().label}
              </span>
              <span class="rounded-full bg-neon-purple/20 px-2.5 py-1 text-[10px] font-medium text-neon-purple">
                Router {proxyEnabled() ? (routerInfo()?.healthy ? 'healthy' : 'watching') : 'disabled'}
              </span>
            </div>
            <div>
              <h2 class="text-2xl font-semibold text-text-main">
                Live FlexInfer operations workbench
              </h2>
              <p class="mt-1 max-w-3xl text-sm text-text-dim">
                Inspect controller CRDs, inference telemetry, cache pipelines, catalogs, and proxy routing from one operator-focused surface.
              </p>
            </div>
            <div class="flex flex-wrap gap-2 text-[11px] text-text-dim">
              <span class="rounded-full bg-white/5 px-2.5 py-1">
                Mode: {managementMode()}
              </span>
              <span class="rounded-full bg-white/5 px-2.5 py-1">
                CRDs {controller.crdModels().length}
              </span>
              <span class="rounded-full bg-white/5 px-2.5 py-1">
                Registry {controller.registryModels().length}
              </span>
              <span class="rounded-full bg-white/5 px-2.5 py-1">
                Catalogs {catalogs().length}
              </span>
              <span class="rounded-full bg-white/5 px-2.5 py-1">
                Caches {caches().length}
              </span>
            </div>
          </div>
          <div class="flex flex-col items-start gap-2 lg:items-end">
            <div class="flex flex-wrap gap-2">
              <button
                onClick={() => void refreshWorkbench()}
                class="rounded-md bg-neon-cyan/20 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30"
              >
                Refresh all
              </button>
              <button
                onClick={() => void controller.discoverModels()}
                disabled={controller.discoverLoading()}
                class="rounded-md bg-neon-purple/20 px-3 py-1.5 text-sm font-medium text-neon-purple transition-colors hover:bg-neon-purple/30 disabled:opacity-50"
              >
                {controller.discoverLoading() ? 'Syncing...' : 'Sync CRDs'}
              </button>
            </div>
            <div class="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-text-dim">
              <div class="font-medium text-text-main">
                {isAdminSurface() ? 'Admin surface' : 'GitOps surface'}
              </div>
              <div class="mt-1 max-w-sm">
                {isAdminSurface()
                  ? 'Read-write management context. Use the sections below to inspect and patch live models.'
                  : 'Read-first control plane view. The backend is treated as the source of truth.'}
              </div>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 border-t border-white/5 px-5 py-3">
          <For each={sections}>
            {(section) => (
              <button
                onClick={() => jumpTo(section.id)}
                class="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] font-medium text-text-muted transition-colors hover:border-neon-cyan/30 hover:text-text-main"
              >
                {section.label}
              </button>
            )}
          </For>
        </div>
      </div>

      <Show when={controller.error()}>
        <div class="glass-panel border border-status-error/20 p-4 text-sm text-status-error">
          {controller.error()}
        </div>
      </Show>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <WorkbenchStatCard
          label="Controller"
          value={`${controller.crdModels().length}`}
          tone="text-neon-cyan"
          note={`${controller.phaseSummary().Ready || 0} ready · ${controller.phaseSummary().Failed || 0} failed`}
        />
        <WorkbenchStatCard
          label="Telemetry"
          value={proxyTotals()?.requestsTotal != null ? proxyTotals()!.requestsTotal.toLocaleString() : '—'}
          tone="text-status-ok"
          note={`${((proxyTotals()?.errorRate ?? 0) * 100).toFixed(2)}% errors · ${proxyTotals()?.queueDepth ?? 0} queued`}
        />
        <WorkbenchStatCard
          label="Supply chain"
          value={`${catalogs().length}/${catalogModelCount()}`}
          tone="text-neon-purple"
          note={`${caches().length} caches · ${cachedReady()} ready`}
        />
        <WorkbenchStatCard
          label="Freshness"
          value={freshnessLabel([proxyUpdatedAt(), routerUpdatedAt(), catalogUpdatedAt(), cacheUpdatedAt()])}
          tone="text-text-main"
          note={freshnessNote([proxyUpdatedAt(), routerUpdatedAt(), catalogUpdatedAt(), cacheUpdatedAt()])}
        />
      </div>

      <section id="control-plane" class="space-y-4">
        <WorkbenchSectionHeader
          kicker="Controller"
          title="CRD fleet"
          subtitle="Live FlexInfer resources from the controller, prioritized by operational risk."
          updatedAt={controllerUpdatedAt()}
          freshness={controller.loading() ? 'offline' : resolveFreshness(controllerUpdatedAt(), 15_000)}
          loading={controller.loading() || controller.controllerDataLoading()}
          action={
            <div class="flex flex-wrap gap-2">
              <button
                onClick={() => void controller.fetchCRDModels()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-neon-cyan/30 hover:text-text-main"
              >
                Reload CRDs
              </button>
              <button
                onClick={() => void controller.fetchRegistryModels()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-neon-cyan/30 hover:text-text-main"
              >
                Reload registry
              </button>
            </div>
          }
        />

        <Show when={modelRows().length > 0} fallback={<WorkbenchEmpty message="No FlexInfer CRDs found yet." />}>
          <div class="glass-panel overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-white/5 text-left text-text-dim">
                    <th class="px-4 py-3 font-medium">Model</th>
                    <th class="px-4 py-3 font-medium">Phase</th>
                    <th class="px-4 py-3 font-medium">Signals</th>
                    <th class="px-4 py-3 font-medium">Telemetry</th>
                    <th class="px-4 py-3 font-medium">Cache</th>
                    <th class="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={modelRows()}>
                    {(row) => (
                      <tr class="border-b border-white/5 hover:bg-white/5">
                        <td class="px-4 py-3">
                          <div class="font-medium text-text-main">{row.model.name}</div>
                          <div class="font-mono text-[10px] text-text-dim">{row.model.namespace}</div>
                          <div class="mt-1 max-w-[20rem] truncate font-mono text-[10px] text-text-dim">
                            {row.model.spec.source}
                          </div>
                        </td>
                        <td class="px-4 py-3">
                          <span class={`rounded-full px-2.5 py-1 text-[10px] font-medium ${phaseTone(row.model.status?.phase)}`}>
                            {row.model.status?.phase || 'Unknown'}
                          </span>
                          <div class={`mt-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${getReliabilityClasses(row.reliability.level)}`}>
                            {row.reliability.label}
                          </div>
                        </td>
                        <td class="px-4 py-3">
                          <div class="flex flex-wrap gap-1.5">
                            <ModelFlag tone={row.model.spec.serverless?.enabled === false ? 'bg-white/10 text-text-dim' : 'bg-status-ok/20 text-status-ok'} label={row.model.spec.serverless ? 'Serverless' : 'Static'} />
                            <ModelFlag tone={row.model.spec.gpu?.shared ? 'bg-neon-purple/20 text-neon-purple' : 'bg-white/10 text-text-dim'} label={row.model.spec.gpu?.shared ? `Shared ${row.model.spec.gpu.shared}` : 'Dedicated'} />
                            <ModelFlag tone={row.adapters.length > 0 ? 'bg-status-ok/20 text-status-ok' : 'bg-white/10 text-text-dim'} label={row.adapters.length > 0 ? `${row.adapters.length} LoRA` : 'No LoRA'} />
                          </div>
                          <div class="mt-2 text-[10px] text-text-dim">
                            {row.integrationState?.inferenceAvailable ? 'Inference' : 'No inference'} · {row.integrationState?.throughputAvailable ? 'throughput live' : 'throughput absent'}
                          </div>
                        </td>
                        <td class="px-4 py-3">
                          <Show
                            when={hasProxyMetricsForModel(proxyMetrics(), row.model.name)}
                            fallback={<div class="font-mono text-[10px] text-text-dim">No proxy series yet</div>}
                          >
                            <div class="space-y-1 font-mono text-[10px] text-text-dim">
                              <div>Req {requestsForModel(proxyMetrics(), row.model.name).toFixed(0)}</div>
                              <div>Queue {queueDepthForModel(proxyMetrics(), row.model.name).toFixed(0)}</div>
                              <div>Conn {activeConnectionsForModel(proxyMetrics(), row.model.name).toFixed(0)}</div>
                              <div>Error {(proxyErrorRateForModel(proxyMetrics(), row.model.name) * 100).toFixed(2)}%</div>
                            </div>
                          </Show>
                        </td>
                        <td class="px-4 py-3">
                          <div class="space-y-1 font-mono text-[10px] text-text-dim">
                            <div>{row.model.status?.cache?.strategy || row.model.spec.cache?.strategy || 'none'}</div>
                            <div>{row.model.status?.cache?.jobPhase || row.model.status?.cache?.ready ? 'ready' : 'pending'}</div>
                          </div>
                        </td>
                        <td class="px-4 py-3">
                          <div class="flex flex-wrap gap-1.5">
                            <button
                              onClick={() => void controller.handleCRDAction('activate', row.model)}
                              disabled={controller.crdActionLoading() === `${row.model.namespace}/${row.model.name}/activate`}
                              class="rounded-md bg-neon-cyan/20 px-2.5 py-1 text-[10px] font-medium text-neon-cyan disabled:opacity-50"
                            >
                              Activate
                            </button>
                            <button
                              onClick={() => void controller.handleCRDAction('restart', row.model)}
                              disabled={controller.crdActionLoading() === `${row.model.namespace}/${row.model.name}/restart`}
                              class="rounded-md bg-white/10 px-2.5 py-1 text-[10px] font-medium text-text-muted disabled:opacity-50"
                            >
                              Restart
                            </button>
                            <button
                              onClick={() => void controller.handleCRDAction('scale0', row.model)}
                              disabled={controller.crdActionLoading() === `${row.model.namespace}/${row.model.name}/scale0`}
                              class="rounded-md bg-status-warn/20 px-2.5 py-1 text-[10px] font-medium text-status-warn disabled:opacity-50"
                            >
                              Scale 0
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </Show>
      </section>

      <section id="telemetry" class="space-y-4">
        <WorkbenchSectionHeader
          kicker="Telemetry"
          title="Proxy and router health"
          subtitle="FlexInfer proxy metrics, LiteLLM routing, and per-model request pressure."
          updatedAt={proxyUpdatedAt() || routerUpdatedAt()}
          freshness={resolveFreshness(proxyUpdatedAt() || routerUpdatedAt(), 15_000)}
          loading={proxyLoading() || routerLoading()}
          action={
            <div class="flex flex-wrap gap-2">
              <button
                onClick={() => void refreshProxy()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-neon-cyan/30 hover:text-text-main"
              >
                Reload proxy
              </button>
              <button
                onClick={() => void refreshRouter()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-neon-cyan/30 hover:text-text-main"
              >
                Reload router
              </button>
            </div>
          }
        />

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div class="glass-panel p-4">
            <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Proxy snapshot</div>
            <div class="mt-3 grid grid-cols-2 gap-3">
              <WorkbenchStatCard label="Health" value={proxyHealthLabel()} tone={proxyHealthTone()} note={proxyHealth()?.message || proxyHealth()?.mode || 'FlexInfer proxy'} />
              <WorkbenchStatCard label="Models" value={`${proxyTotals()?.modelCount ?? 0}`} tone="text-neon-cyan" note={proxyEnabled() ? 'live counts from metrics endpoint' : 'disabled'} />
            </div>
            <div class="mt-4 grid grid-cols-2 gap-3 text-xs">
              <MiniMetric label="Requests" value={`${proxyTotals()?.requestsTotal?.toLocaleString() || '0'}`} />
              <MiniMetric label="Errors" value={`${((proxyTotals()?.errorRate ?? 0) * 100).toFixed(2)}%`} />
              <MiniMetric label="Queue depth" value={`${proxyTotals()?.queueDepth ?? 0}`} />
              <MiniMetric label="Active conns" value={`${proxyTotals()?.activeConnections ?? 0}`} />
            </div>
            <Show when={proxyMetrics()?.partial}>
              <div class="mt-3 rounded-md border border-status-warn/20 bg-status-warn/10 px-3 py-2 text-[11px] text-status-warn">
                Proxy metrics are partial. One or more upstream lines could not be parsed.
              </div>
            </Show>
            <Show when={proxyError()}>
              <div class="mt-3 rounded-md border border-status-error/20 bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
                {proxyError()}
              </div>
            </Show>
          </div>

          <div class="glass-panel overflow-hidden xl:col-span-2">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Per-model telemetry</div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-white/5 text-left text-text-dim">
                    <th class="px-4 py-3 font-medium">Model</th>
                    <th class="px-4 py-3 font-medium text-right">Requests</th>
                    <th class="px-4 py-3 font-medium text-right">Queue</th>
                    <th class="px-4 py-3 font-medium text-right">Connections</th>
                    <th class="px-4 py-3 font-medium text-right">Error %</th>
                  </tr>
                </thead>
                <tbody>
                  <For
                    each={proxyModelRows()}
                    fallback={
                      <tr>
                        <td class="px-4 py-5 text-center text-text-dim" colSpan={5}>
                          No proxy metrics available yet.
                        </td>
                      </tr>
                    }
                  >
                    {([name, metrics]) => (
                      <tr class="border-b border-white/5 hover:bg-white/5">
                        <td class="px-4 py-3 font-mono text-text-main">{name}</td>
                        <td class="px-4 py-3 text-right font-mono text-text-muted">{metrics.requestsTotal.toFixed(0)}</td>
                        <td class="px-4 py-3 text-right font-mono text-text-muted">{metrics.queueDepth.toFixed(0)}</td>
                        <td class="px-4 py-3 text-right font-mono text-text-muted">{metrics.activeConnections.toFixed(0)}</td>
                        <td class={`px-4 py-3 text-right font-mono ${metrics.errorsTotal > 0 ? 'text-status-warn' : 'text-text-muted'}`}>
                          {((proxyErrorRateForModel(proxyMetrics(), name) || 0) * 100).toFixed(2)}%
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div class="glass-panel overflow-hidden">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Router table</div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-white/5 text-left text-text-dim">
                    <th class="px-4 py-3 font-medium">Model</th>
                    <th class="px-4 py-3 font-medium">Backend</th>
                    <th class="px-4 py-3 font-medium text-right">RPM</th>
                    <th class="px-4 py-3 font-medium text-right">Max tokens</th>
                  </tr>
                </thead>
                <tbody>
                  <For
                    each={routerModels()}
                    fallback={
                      <tr>
                        <td class="px-4 py-5 text-center text-text-dim" colSpan={4}>
                          No router mapping available.
                        </td>
                      </tr>
                    }
                  >
                    {(entry) => (
                      <tr class="border-b border-white/5 hover:bg-white/5">
                        <td class="px-4 py-3 font-mono text-text-main">{entry.model_name}</td>
                        <td class="px-4 py-3 font-mono text-text-dim">{entry.litellm_params?.api_base || entry.litellm_params?.model || '—'}</td>
                        <td class="px-4 py-3 text-right font-mono text-text-muted">{entry.litellm_params?.rpm || '—'}</td>
                        <td class="px-4 py-3 text-right font-mono text-text-muted">{entry.model_info?.max_tokens?.toLocaleString() || '—'}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <Show when={routerError()}>
              <div class="border-t border-white/5 px-4 py-3 text-[11px] text-status-error">{routerError()}</div>
            </Show>
          </div>

          <div class="glass-panel p-4">
            <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Model detail coverage</div>
            <div class="mt-3 grid grid-cols-2 gap-3">
              <WorkbenchStatCard
                label="Inference unavailable"
                value={`${controller.integrationSummary().inferenceUnavailable}`}
                tone="text-status-warn"
                note="CRDs with missing inference telemetry"
              />
              <WorkbenchStatCard
                label="LoRA unavailable"
                value={`${controller.integrationSummary().loraUnavailable}`}
                tone="text-status-warn"
                note="CRDs without adapter details"
              />
              <WorkbenchStatCard
                label="Healthy"
                value={`${controller.reliabilitySummary().healthy}`}
                tone="text-status-ok"
                note="Models inside nominal bounds"
              />
              <WorkbenchStatCard
                label="Partial"
                value={`${controller.reliabilitySummary().partial}`}
                tone="text-neon-cyan"
                note="Telemetry is present but incomplete"
              />
            </div>
            <Show when={routerInfo()?.healthy === false || proxyHealth()?.healthy === false}>
              <div class="mt-3 rounded-md border border-status-warn/20 bg-status-warn/10 px-3 py-2 text-[11px] text-status-warn">
                One or more FlexInfer control-plane surfaces are degraded. Use the sections above to isolate the break.
              </div>
            </Show>
          </div>
        </div>
      </section>

      <section id="supply-chain" class="space-y-4">
        <WorkbenchSectionHeader
          kicker="Supply chain"
          title="Catalogs and caches"
          subtitle="Track upstream catalogs, cache job phases, and release readiness."
          updatedAt={catalogUpdatedAt() || cacheUpdatedAt()}
          freshness={resolveFreshness(catalogUpdatedAt() || cacheUpdatedAt(), 60_000)}
          loading={catalogLoading() || cacheLoading()}
          action={
            <div class="flex flex-wrap gap-2">
              <button
                onClick={() => void refreshCatalogs()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-neon-purple/30 hover:text-text-main"
              >
                Reload catalogs
              </button>
              <button
                onClick={() => void refreshCaches()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-neon-purple/30 hover:text-text-main"
              >
                Reload caches
              </button>
            </div>
          }
        />

        <Show when={catalogError()}>
          <div class="glass-panel border border-status-error/20 p-4 text-sm text-status-error">
            {catalogError()}
          </div>
        </Show>

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div class="glass-panel overflow-hidden">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Catalogs</div>
            </div>
            <div class="divide-y divide-white/5">
              <For
                each={catalogs()}
                fallback={<div class="px-4 py-6 text-center text-sm text-text-dim">No catalogs found.</div>}
              >
                {(catalog) => (
                  <div class="px-4 py-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="font-medium text-text-main">{catalog.name}</div>
                        <div class="mt-0.5 text-[10px] font-mono text-text-dim">
                          {catalog.namespace} · {catalog.source}
                        </div>
                      </div>
                      <span class="rounded-full bg-neon-cyan/20 px-2.5 py-1 text-[10px] font-medium text-neon-cyan">
                        {catalog.models?.length || 0} models
                      </span>
                    </div>
                    <div class="mt-2 text-[11px] text-text-dim">
                      Last sync {new Date(catalog.lastSyncTime).toLocaleString()}
                    </div>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                      <For each={(catalog.models || []).slice(0, 4)}>
                        {(model) => (
                          <span class="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-text-dim">
                            {model.name}
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>

          <div class="glass-panel overflow-hidden">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Cache jobs</div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-white/5 text-left text-text-dim">
                    <th class="px-4 py-3 font-medium">Cache</th>
                    <th class="px-4 py-3 font-medium">Phase</th>
                    <th class="px-4 py-3 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  <For
                    each={caches()}
                    fallback={
                      <tr>
                        <td class="px-4 py-5 text-center text-text-dim" colSpan={3}>
                          No cache pipelines found.
                        </td>
                      </tr>
                    }
                  >
                    {(cache) => (
                      <tr class="border-b border-white/5 hover:bg-white/5">
                        <td class="px-4 py-3">
                          <div class="font-medium text-text-main">{cache.name}</div>
                          <div class="font-mono text-[10px] text-text-dim">{cache.namespace}</div>
                        </td>
                        <td class="px-4 py-3">
                          <span class={`rounded-full px-2.5 py-1 text-[10px] font-medium ${cachePhaseTone(cache.status?.phase)}`}>
                            {cache.status?.phase || 'Unknown'}
                          </span>
                          <Show when={cacheProgressSummary(cache)}>
                            {(summary) => (
                              <div class="mt-2 max-w-xs text-[10px] font-mono text-text-dim">
                                {summary()}
                              </div>
                            )}
                          </Show>
                        </td>
                        <td class="px-4 py-3 font-mono text-[10px] text-text-dim">
                          {cache.spec?.source}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <div class="grid grid-cols-2 gap-3 border-t border-white/5 p-4">
              <WorkbenchStatCard label="Ready" value={`${cachedReady()}`} tone="text-status-ok" note="cache pipelines ready to serve" />
              <WorkbenchStatCard label="Failed" value={`${cachedFailed()}`} tone="text-status-error" note="requires operator follow-up" />
            </div>
            <Show when={!modelCacheEnabled()}>
              <div class="border-t border-white/5 px-4 py-3 text-[11px] text-text-dim">
                Model cache features are disabled in the current cluster health state.
              </div>
            </Show>
            <Show when={cacheError()}>
              <div class="border-t border-white/5 px-4 py-3 text-[11px] text-status-error">{cacheError()}</div>
            </Show>
          </div>
        </div>
      </section>

      <section id="intake" class="space-y-4">
        <WorkbenchSectionHeader
          kicker="Intake"
          title="Registry search and deployment intake"
          subtitle="Search HuggingFace or CivitAI, then register or download directly into the registry."
          updatedAt={controllerUpdatedAt()}
          freshness={controller.loading() ? 'offline' : resolveFreshness(controllerUpdatedAt(), 15_000)}
          loading={controller.loading()}
          action={
            <div class="flex flex-wrap gap-2">
              <button
                onClick={() => void controller.handleSearch()}
                disabled={controller.searching() || !controller.searchQuery().trim()}
                class="rounded-md bg-neon-cyan/20 px-3 py-1.5 text-xs font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
              >
                {controller.searching() ? 'Searching...' : 'Search'}
              </button>
              <button
                onClick={() => void controller.fetchRegistryModels()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-neon-cyan/30 hover:text-text-main"
              >
                Reload registry
              </button>
            </div>
          }
        />

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div class="glass-panel p-4 xl:col-span-1">
            <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Search</div>
            <div class="mt-3 space-y-3">
              <select
                value={controller.searchSource()}
                onChange={(e) => controller.setSearchSource(e.currentTarget.value as 'huggingface' | 'civitai')}
                class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-text-main focus:border-neon-cyan/50 focus:outline-none"
              >
                <option value="huggingface">HuggingFace</option>
                <option value="civitai">CivitAI</option>
              </select>
              <input
                type="text"
                value={controller.searchQuery()}
                onInput={(e) => controller.setSearchQuery(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && void controller.handleSearch()}
                placeholder="Search models..."
                class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-text-main placeholder:text-text-dim/60 focus:border-neon-cyan/50 focus:outline-none"
              />
              <div class="text-[11px] text-text-dim">
                Search results remain actionable even when the controller is degraded.
              </div>
            </div>
          </div>

          <div class="glass-panel overflow-hidden xl:col-span-2">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Search results</div>
            </div>
            <div class="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
              <For
                each={searchResults()}
                fallback={<div class="rounded-md border border-white/5 bg-black/20 p-4 text-sm text-text-dim md:col-span-2">Run a search to populate intake candidates.</div>}
              >
                {(model) => (
                  <div class="rounded-md border border-white/5 bg-black/20 p-3">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="font-medium text-text-main">{model.name}</div>
                        <div class="mt-0.5 text-[10px] font-mono text-text-dim">{model.source} · {model.source_id}</div>
                      </div>
                      <button
                        onClick={() => void controller.handleRegister(model.source, model.source_id)}
                        disabled={controller.actionLoading() === model.source_id}
                        class="rounded-md bg-neon-cyan/20 px-2.5 py-1 text-[10px] font-medium text-neon-cyan disabled:opacity-50"
                      >
                        {controller.actionLoading() === model.source_id ? '...' : 'Register'}
                      </button>
                    </div>
                    <div class="mt-2 text-[11px] text-text-dim line-clamp-2">
                      {model.description || 'No description provided.'}
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div class="glass-panel overflow-hidden">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Registry models</div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-white/5 text-left text-text-dim">
                    <th class="px-4 py-3 font-medium">Model</th>
                    <th class="px-4 py-3 font-medium">Status</th>
                    <th class="px-4 py-3 font-medium text-right">Replicas</th>
                    <th class="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <For
                    each={registryRows()}
                    fallback={
                      <tr>
                        <td class="px-4 py-5 text-center text-text-dim" colSpan={4}>
                          No registry models found.
                        </td>
                      </tr>
                    }
                  >
                    {(model) => (
                      <tr class="border-b border-white/5 hover:bg-white/5">
                        <td class="px-4 py-3">
                          <div class="font-medium text-text-main">{model.name}</div>
                          <div class="font-mono text-[10px] text-text-dim">{model.source}</div>
                        </td>
                        <td class="px-4 py-3">
                          <span class="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-text-dim">
                            {model.download_status}
                          </span>
                        </td>
                        <td class="px-4 py-3 text-right font-mono text-text-muted">{model.replicas}</td>
                        <td class="px-4 py-3">
                          <div class="flex flex-wrap gap-1.5">
                            <button
                              onClick={() => void controller.handleStartDownload(model.id)}
                              disabled={controller.actionLoading() === model.id}
                              class="rounded-md bg-status-ok/20 px-2.5 py-1 text-[10px] font-medium text-status-ok disabled:opacity-50"
                            >
                              Download
                            </button>
                            <button
                              onClick={() => void controller.handleDelete(model.id)}
                              disabled={controller.actionLoading() === model.id}
                              class="rounded-md bg-status-warn/20 px-2.5 py-1 text-[10px] font-medium text-status-warn disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>

          <div class="glass-panel overflow-hidden">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Operational notes</div>
            </div>
            <div class="space-y-3 p-4 text-sm text-text-dim">
              <div class="rounded-md border border-white/5 bg-black/20 p-3">
                <div class="font-medium text-text-main">Control plane</div>
                <div class="mt-1 text-xs">Controller data is refreshed continuously and highlighted by phase and reliability first.</div>
              </div>
              <div class="rounded-md border border-white/5 bg-black/20 p-3">
                <div class="font-medium text-text-main">Proxy telemetry</div>
                <div class="mt-1 text-xs">Queue depth, request totals, and routing health are surfaced together to shorten triage.</div>
              </div>
              <div class="rounded-md border border-white/5 bg-black/20 p-3">
                <div class="font-medium text-text-main">Cache pipeline</div>
                <div class="mt-1 text-xs">Ablation, quantization, finetune, and publishing stages are treated as release artifacts.</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const WorkbenchStatCard: Component<{ label: string; value: string; tone: string; note: string }> = (props) => (
  <div class="glass-panel p-4">
    <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">{props.label}</div>
    <div class={`mt-2 text-2xl font-semibold ${props.tone}`}>{props.value}</div>
    <div class="mt-1 text-xs text-text-dim">{props.note}</div>
  </div>
);

const WorkbenchSectionHeader: Component<{
  kicker: string;
  title: string;
  subtitle: string;
  updatedAt: number;
  freshness: string;
  loading: boolean;
  action?: any;
}> = (props) => (
  <div class="glass-panel flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
    <div class="min-w-0">
      <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">{props.kicker}</div>
      <div class="mt-1 text-lg font-semibold text-text-main">{props.title}</div>
      <div class="mt-1 max-w-3xl text-sm text-text-dim">{props.subtitle}</div>
      <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-dim">
        <span class={`rounded-full px-2.5 py-1 ${freshnessTone(props.freshness)}`}>{props.freshness}</span>
        <span class="rounded-full bg-white/5 px-2.5 py-1">
          Updated {props.updatedAt ? new Date(props.updatedAt).toLocaleTimeString() : '—'}
        </span>
        <Show when={props.loading}>
          <span class="rounded-full bg-white/5 px-2.5 py-1 text-neon-cyan">Refreshing</span>
        </Show>
      </div>
    </div>
    <Show when={props.action}>
      <div class="shrink-0">{props.action}</div>
    </Show>
  </div>
);

const WorkbenchEmpty: Component<{ message: string }> = (props) => (
  <div class="glass-panel p-6 text-center text-sm text-text-dim">{props.message}</div>
);

const ModelFlag: Component<{ tone: string; label: string }> = (props) => (
  <span class={`rounded-full px-2.5 py-1 text-[10px] font-medium ${props.tone}`}>{props.label}</span>
);

const MiniMetric: Component<{ label: string; value: string }> = (props) => (
  <div class="rounded-md border border-white/5 bg-black/20 px-3 py-2">
    <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">{props.label}</div>
    <div class="mt-1 font-mono text-sm text-text-main">{props.value}</div>
  </div>
);

function phaseTone(phase?: string): string {
  switch (phase) {
    case 'Ready':
      return 'bg-status-ok/20 text-status-ok';
    case 'Loading':
      return 'bg-neon-cyan/20 text-neon-cyan';
    case 'Pending':
      return 'bg-status-warn/20 text-status-warn';
    case 'Failed':
      return 'bg-status-error/20 text-status-error';
    case 'Preempted':
      return 'bg-neon-purple/20 text-neon-purple';
    default:
      return 'bg-white/10 text-text-dim';
  }
}

function cachePhaseTone(phase?: string): string {
  switch (phase) {
    case 'Ready':
      return 'bg-status-ok/20 text-status-ok';
    case 'Failed':
      return 'bg-status-error/20 text-status-error';
    case 'Publishing':
    case 'Quantizing':
    case 'Finetuning':
      return 'bg-neon-cyan/20 text-neon-cyan';
    default:
      return 'bg-white/10 text-text-dim';
  }
}

function cacheProgressSummary(cache: ModelCache): string | null {
  const activeStatus = activeCachePhaseStatus(cache);
  if (!activeStatus) return null;

  const parts: string[] = [];
  if (activeStatus.progress != null) parts.push(`${activeStatus.progress}%`);
  if (activeStatus.progressDetail) parts.push(activeStatus.progressDetail);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function activeCachePhaseStatus(cache: ModelCache) {
  switch (cache.status?.phase) {
    case 'Abliterating':
      return cache.status?.abliteration;
    case 'Finetuning':
      return cache.status?.finetune;
    case 'Quantizing':
      return cache.status?.quantization;
    case 'Publishing':
      return cache.status?.publish;
    default:
      return null;
  }
}

function freshnessTone(state: string): string {
  switch (state) {
    case 'live':
      return 'bg-status-ok/20 text-status-ok';
    case 'stale':
      return 'bg-status-warn/20 text-status-warn';
    default:
      return 'bg-white/10 text-text-dim';
  }
}

function freshnessLabel(values: number[]): string {
  const latest = Math.max(...values, 0);
  if (!latest) return 'offline';
  return resolveFreshness(latest, 15_000) === 'live' ? 'live' : 'stale';
}

function freshnessNote(values: number[]): string {
  const latest = Math.max(...values, 0);
  if (!latest) return 'No successful refresh yet.';
  return `Last successful refresh at ${new Date(latest).toLocaleTimeString()}.`;
}

export default FlexInferWorkbench;
