import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  operatorStateBadgeClass,
  operatorStateLabel,
  resolveFreshness,
  resolveOperatorState,
  type OperatorState,
} from '../../lib/freshness';
import { healthStore } from '../../stores/health';
import {
  flexinferProxyTotals,
  flexinferSupplyChainSummary,
} from '../../stores/flexinferSurface';
import { getFlexInferManagementMode } from '../../lib/featureFlags';
import type { ModelCache } from '../../lib/types';
import {
  flexinferCacheError,
  flexinferCacheLoading,
  flexinferCacheUpdatedAt,
  flexinferCaches,
  flexinferCatalogError,
  flexinferCatalogLoading,
  flexinferCatalogUpdatedAt,
  flexinferCatalogs,
  flexinferProxyError,
  flexinferProxyHealth,
  flexinferProxyLoading,
  flexinferProxyMetrics,
  flexinferProxyUpdatedAt,
  flexinferRouterError,
  flexinferRouterInfo,
  flexinferRouterLoading,
  flexinferRouterUpdatedAt,
  refreshFlexInferCaches,
  refreshFlexInferCatalogs,
  refreshFlexInferOperationalData,
  refreshFlexInferProxy,
  refreshFlexInferRouter,
  startFlexInferOperationalPolling,
  stopFlexInferOperationalPolling,
} from '../../stores/flexinferOperational';
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
import OperationsSidebarNav from '../shared/OperationsSidebarNav';

type Surface = 'models' | 'admin';
type WorkbenchSectionId = 'overview' | 'control-plane' | 'telemetry' | 'supply-chain' | 'intake';

const workbenchSectionIds: WorkbenchSectionId[] = [
  'overview',
  'control-plane',
  'telemetry',
  'supply-chain',
  'intake',
];

const workbenchSectionHashPrefix = '#flexinfer-';

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

  const [activeSection, setActiveSection] = createSignal<WorkbenchSectionId>('overview');
  const activeTab = createMemo<ModelsTab>(() => (activeSection() === 'control-plane' ? 'controller' : 'proxy'));
  const noopSetActiveTab = () => undefined;
  const controller = useModelsController(activeTab, noopSetActiveTab, {
    refreshOnMount: false,
    autoDiscoverOnMount: false,
    includeThroughputMetrics: false,
  });
  const [controllerUpdatedAt, setControllerUpdatedAt] = createSignal(0);
  const proxyMetrics = flexinferProxyMetrics;
  const proxyHealth = flexinferProxyHealth;
  const proxyLoading = flexinferProxyLoading;
  const proxyError = flexinferProxyError;
  const proxyUpdatedAt = flexinferProxyUpdatedAt;
  const routerInfo = flexinferRouterInfo;
  const routerLoading = flexinferRouterLoading;
  const routerError = flexinferRouterError;
  const routerUpdatedAt = flexinferRouterUpdatedAt;
  const catalogs = flexinferCatalogs;
  const catalogLoading = flexinferCatalogLoading;
  const catalogError = flexinferCatalogError;
  const catalogUpdatedAt = flexinferCatalogUpdatedAt;
  const caches = flexinferCaches;
  const cacheLoading = flexinferCacheLoading;
  const cacheError = flexinferCacheError;
  const cacheUpdatedAt = flexinferCacheUpdatedAt;

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

  const refreshWorkbench = async () => {
    await Promise.all([
      controller.fetchCRDModels(),
      refreshFlexInferOperationalData(),
    ]);
    setControllerUpdatedAt(Date.now());
  };

  onMount(() => {
    const hashSection = readWorkbenchSectionFromHash();
    if (hashSection) {
      setActiveSection(hashSection);
      requestAnimationFrame(() => scrollSectionIntoView(hashSection, 'auto'));
    } else {
      syncWorkbenchSectionHash(activeSection());
    }

    startFlexInferOperationalPolling();
    void refreshWorkbench();

    if (typeof window !== 'undefined') {
      const handleHashChange = () => {
        const nextSection = readWorkbenchSectionFromHash();
        if (nextSection) {
          changeSection(nextSection, { syncHash: false, behavior: 'auto' });
        }
      };

      window.addEventListener('hashchange', handleHashChange);
      onCleanup(() => {
        window.removeEventListener('hashchange', handleHashChange);
      });
    }
  });
  onCleanup(() => {
    stopFlexInferOperationalPolling();
  });

  const scrollSectionIntoView = (
    section: WorkbenchSectionId,
    behavior: ScrollBehavior = 'smooth',
  ) => {
    const target = document.getElementById(section);
    if (!target) return;

    const viewport = resolvePageScrollViewport(target);
    if (viewport) {
      const offset = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop - 12;
      viewport.scrollTo({ top: Math.max(0, offset), left: 0, behavior });
      return;
    }

    if (typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior, block: 'start' });
    }
  };

  const changeSection = (
    section: WorkbenchSectionId,
    options?: { behavior?: ScrollBehavior; syncHash?: boolean }
  ) => {
    setActiveSection(section);
    if (options?.syncHash !== false) {
      syncWorkbenchSectionHash(section);
    }
    requestAnimationFrame(() => {
      scrollSectionIntoView(section, options?.behavior ?? 'smooth');
    });
  };

  const controllerSectionState = createMemo<OperatorState>(() =>
    resolveOperatorState({
      loading: controller.loading() || controller.controllerDataLoading(),
      error: controller.error(),
      lastUpdateMs: controllerUpdatedAt(),
      staleAfterMs: 15_000,
    }),
  );
  const controllerSectionDetail = () => {
    if (controller.error()) return 'controller issue';
    if (controller.loading() || controller.controllerDataLoading()) {
      return controllerUpdatedAt() ? 'background refresh' : 'initial sync';
    }
    if (controllerSectionState() === 'stale') return 'poll lag';
    return undefined;
  };
  const telemetryUpdatedAt = () => Math.max(proxyUpdatedAt(), routerUpdatedAt(), 0);
  const telemetrySectionState = createMemo<OperatorState>(() =>
    resolveOperatorState({
      loading: proxyLoading() || routerLoading(),
      error: proxyError() || routerError(),
      lastUpdateMs: telemetryUpdatedAt(),
      staleAfterMs: 15_000,
      disabled: !proxyEnabled(),
      partial: Boolean(proxyMetrics()?.partial),
    }),
  );
  const telemetrySectionDetail = () => {
    if (!proxyEnabled()) return 'feature disabled';
    if (proxyMetrics()?.partial) return 'partial metrics';
    if (proxyError() || routerError()) return proxyError() && routerError() ? 'upstream errors' : proxyError() ? 'proxy issue' : 'router issue';
    if (proxyLoading() || routerLoading()) return telemetryUpdatedAt() ? 'background refresh' : 'initial sync';
    if (telemetrySectionState() === 'stale') return 'poll fallback';
    return undefined;
  };
  const supplyChainUpdatedAt = () => Math.max(catalogUpdatedAt(), cacheUpdatedAt(), 0);
  const supplyChainSectionState = createMemo<OperatorState>(() =>
    resolveOperatorState({
      loading: catalogLoading() || cacheLoading(),
      error: catalogError() || cacheError(),
      lastUpdateMs: supplyChainUpdatedAt(),
      staleAfterMs: 60_000,
      partial: !modelCacheEnabled(),
    }),
  );
  const supplyChainSectionDetail = () => {
    if (!modelCacheEnabled()) return 'cache disabled';
    if (catalogError() || cacheError()) return catalogError() && cacheError() ? 'upstream errors' : catalogError() ? 'catalog issue' : 'cache issue';
    if (catalogLoading() || cacheLoading()) return supplyChainUpdatedAt() ? 'background refresh' : 'initial sync';
    if (supplyChainSectionState() === 'stale') return 'poll lag';
    return undefined;
  };

  const modelRows = createMemo(() => {
    const items = controller.crdModels().map((model) => {
      const key = `${model.namespace}/${model.name}`;
      const reliability = getReliabilityStatus(controller.inferenceByModel()[key]);
      return {
        model,
        key,
        reliability,
        adapters: controller.loraByModel()[key] || [],
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
  const supplyChainSummary = () => flexinferSupplyChainSummary();
  const proxyTotals = () => flexinferProxyTotals();
  const routerModels = () => routerInfo()?.modelInfo || [];
  const reliabilityHeadline = createMemo(() => {
    const summary = controller.reliabilitySummary();
    if (summary.degraded > 0) return { level: 'degraded' as const, label: `${summary.degraded} degraded` };
    if (summary.partial > 0) return { level: 'partial' as const, label: `${summary.partial} partial` };
    if (summary.unknown > 0) return { level: 'unknown' as const, label: `${summary.unknown} unknown` };
    return { level: 'healthy' as const, label: `${summary.healthy} healthy` };
  });
  const sectionNav = createMemo(() => [
    {
      id: 'overview' as const,
      label: 'Overview',
      eyebrow: 'Cockpit',
      value: freshnessLabel([proxyUpdatedAt(), routerUpdatedAt(), catalogUpdatedAt(), cacheUpdatedAt()]),
      detail: `${controller.crdModels().length} CRDs · ${proxyTotals()?.requestsTotal ?? 0} requests`,
      group: 'Primary',
    },
    {
      id: 'control-plane' as const,
      label: 'Control plane',
      eyebrow: 'CRDs',
      value: `${controller.crdModels().length}`,
      detail: reliabilityHeadline().label,
      group: 'Operations',
    },
    {
      id: 'telemetry' as const,
      label: 'Telemetry',
      eyebrow: 'Proxy + router',
      value: `${proxyTotals()?.queueDepth ?? 0}`,
      detail: `${proxyTotals()?.requestsTotal ?? 0} requests`,
      group: 'Operations',
    },
    {
      id: 'supply-chain' as const,
      label: 'Supply chain',
      eyebrow: 'Catalogs + caches',
      value: `${supplyChainSummary().cacheCount}`,
      detail: `${supplyChainSummary().readyCacheCount} ready caches`,
      group: 'Operations',
    },
    {
      id: 'intake' as const,
      label: 'Intake',
      eyebrow: 'Registry + search',
      value: `${controller.registryModels().length}`,
      detail: `${controller.searchResults().length} staged results`,
      group: 'Operations',
    },
  ]);

  return (
    <div class="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-4 pb-6">
      <div
        class={`glass-panel overflow-hidden border border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.24)] ${
          isAdminSurface()
            ? 'bg-gradient-to-br from-status-warn/10 via-white/5 to-white/3'
            : 'bg-white/5'
        }`}
      >
        <div class="flex flex-col gap-5 p-4 sm:p-5 xl:flex-row xl:items-start xl:justify-between">
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
              <span class="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-text-muted">
                Router {proxyEnabled() ? (routerInfo()?.healthy ? 'healthy' : 'watching') : 'disabled'}
              </span>
            </div>
            <div>
              <h2 class="text-2xl font-semibold tracking-tight text-text-main sm:text-[2rem]">
                Live FlexInfer operations workbench
              </h2>
              <p class="mt-2 max-w-3xl text-sm leading-6 text-text-dim">
                Inspect controller CRDs, inference telemetry, cache pipelines, catalogs, and proxy routing from one operator-focused surface.
              </p>
            </div>
            <div class="flex flex-wrap gap-2 text-[11px] text-text-dim">
              <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                Mode: {managementMode()}
              </span>
              <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                CRDs {controller.crdModels().length}
              </span>
              <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                Registry {controller.registryModels().length}
              </span>
              <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                Catalogs {supplyChainSummary().catalogCount}
              </span>
              <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                Caches {supplyChainSummary().cacheCount}
              </span>
            </div>
          </div>
          <div class="flex w-full flex-col items-start gap-3 xl:max-w-sm xl:items-end">
            <div class="flex w-full flex-wrap gap-2 xl:justify-end">
              <button
                onClick={() => void refreshWorkbench()}
                class="min-h-[40px] rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/15"
              >
                Refresh all
              </button>
              <button
                onClick={() => void controller.discoverModels()}
                disabled={controller.discoverLoading()}
                class="min-h-[40px] rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-white/15 disabled:opacity-50"
              >
                {controller.discoverLoading() ? 'Syncing...' : 'Sync CRDs'}
              </button>
            </div>
            <div class="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-text-dim">
              <div class="font-medium text-text-main">
                {isAdminSurface() ? 'Admin surface' : 'GitOps surface'}
              </div>
              <div class="mt-1 leading-5">
                {isAdminSurface()
                  ? 'Read-write management context. Use the sections below to inspect and patch live models.'
                  : 'Read-first control plane view. The backend is treated as the source of truth.'}
              </div>
            </div>
          </div>
        </div>
        <div class="border-t border-white/5 px-4 py-3 sm:px-5">
          <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Section rail</div>
          <div class="mt-1 text-xs text-text-dim">
            Use the rail below to switch the visible lane and keep the surface focused on one operator task.
          </div>
        </div>
      </div>

      <Show when={controller.error()}>
        <div class="glass-panel border border-status-error/20 p-4 text-sm text-status-error">
          {controller.error()}
        </div>
      </Show>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
        <WorkbenchStatCard
          label="Controller"
          value={`${controller.crdModels().length}`}
          tone="text-text-muted"
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
          value={`${supplyChainSummary().catalogCount}/${supplyChainSummary().catalogModelCount}`}
          tone="text-text-dim"
          note={`${supplyChainSummary().cacheCount} caches · ${supplyChainSummary().readyCacheCount} ready`}
        />
        <WorkbenchStatCard
          label="Freshness"
          value={freshnessLabel([proxyUpdatedAt(), routerUpdatedAt(), catalogUpdatedAt(), cacheUpdatedAt()])}
          tone="text-text-main"
          note={freshnessNote([proxyUpdatedAt(), routerUpdatedAt(), catalogUpdatedAt(), cacheUpdatedAt()])}
        />
      </div>

      <div class="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <OperationsSidebarNav
          title="Workbench sections"
          description="Stay in one operational lane at a time. Overview is the briefing; the other sections are focused triage."
          items={sectionNav()}
          active={activeSection()}
          onChange={(section) => changeSection(section as WorkbenchSectionId)}
        />

        <div class="min-w-0 space-y-4">
          <section id="overview" class={activeSection() === 'overview' ? 'scroll-mt-6 space-y-4 xl:scroll-mt-8' : 'hidden'}>
            <WorkbenchSectionHeader
              kicker="Overview"
              title="Operator briefing"
              subtitle="A compact read on fleet health, request pressure, supply readiness, and the next lane to investigate."
              updatedAt={Math.max(controllerUpdatedAt(), telemetryUpdatedAt(), supplyChainUpdatedAt())}
              state={resolveOperatorState({
                loading: controller.loading() || controller.controllerDataLoading() || proxyLoading() || routerLoading() || catalogLoading() || cacheLoading(),
                error: controller.error() || proxyError() || routerError() || catalogError() || cacheError(),
                lastUpdateMs: Math.max(controllerUpdatedAt(), telemetryUpdatedAt(), supplyChainUpdatedAt()),
                staleAfterMs: 15_000,
                partial: !modelCacheEnabled() || Boolean(proxyMetrics()?.partial),
              })}
              stateDetail={controller.error() || proxyError() || routerError() || catalogError() || cacheError() ? 'multi-surface review' : undefined}
              loading={controller.loading() || controller.controllerDataLoading() || proxyLoading() || routerLoading()}
            />

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
          <WorkbenchStatCard
            label="Controller"
            value={`${controller.crdModels().length}`}
            tone="text-text-muted"
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
            value={`${supplyChainSummary().catalogCount}/${supplyChainSummary().catalogModelCount}`}
            tone="text-text-dim"
            note={`${supplyChainSummary().cacheCount} caches · ${supplyChainSummary().readyCacheCount} ready`}
          />
          <WorkbenchStatCard
            label="Freshness"
            value={freshnessLabel([proxyUpdatedAt(), routerUpdatedAt(), catalogUpdatedAt(), cacheUpdatedAt()])}
            tone="text-text-main"
            note={freshnessNote([proxyUpdatedAt(), routerUpdatedAt(), catalogUpdatedAt(), cacheUpdatedAt()])}
          />
        </div>

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div class="glass-panel p-4">
            <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Recommended next stop</div>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <OverviewFocusCard
                title="Control plane"
                detail="Use this when model phase, reliability, or CRD health is the first question."
                stat={`${controller.crdModels().length} models`}
                tone="text-text-muted"
                onClick={() => setActiveSection('control-plane')}
              />
              <OverviewFocusCard
                title="Telemetry"
                detail="Queue depth, error rate, and router coverage are grouped here for incident triage."
                stat={`${proxyTotals()?.queueDepth ?? 0} queued`}
                tone="text-status-ok"
                onClick={() => setActiveSection('telemetry')}
              />
              <OverviewFocusCard
                title="Supply chain"
                detail="Catalog sync and cache job readiness stay together so release artifacts are easy to read."
                stat={`${supplyChainSummary().readyCacheCount} ready`}
                tone="text-text-dim"
                onClick={() => setActiveSection('supply-chain')}
              />
              <OverviewFocusCard
                title="Intake"
                detail="Registry search, staged candidates, and deployment intake stay isolated from controller triage."
                stat={`${searchResults().length} staged`}
                tone="text-text-main"
                onClick={() => setActiveSection('intake')}
              />
            </div>
          </div>

          <div class="glass-panel overflow-hidden">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Operational notes</div>
            </div>
            <div class="space-y-3 p-4 text-sm text-text-dim">
              <div class="rounded-md border border-white/5 bg-black/20 p-3">
                <div class="font-medium text-text-main">Control plane first</div>
                <div class="mt-1 text-xs">The controller lane leads with phase and reliability so degraded models rise to the top immediately.</div>
              </div>
              <div class="rounded-md border border-white/5 bg-black/20 p-3">
                <div class="font-medium text-text-main">Telemetry</div>
                <div class="mt-1 text-xs">Proxy totals, queue depth, and routing health stay together for fast triage.</div>
              </div>
              <div class="rounded-md border border-white/5 bg-black/20 p-3">
                <div class="font-medium text-text-main">Supply chain</div>
                <div class="mt-1 text-xs">Catalog sync and cache pipeline readiness stay aligned with release artifacts.</div>
              </div>
              <div class="rounded-md border border-white/5 bg-black/20 p-3">
                <div class="font-medium text-text-main">Intake</div>
                <div class="mt-1 text-xs">Registry search and deployment intake stay isolated from control-plane triage.</div>
              </div>
            </div>
          </div>
        </div>
          </section>

          <section id="control-plane" class={activeSection() === 'control-plane' ? 'scroll-mt-6 space-y-4 xl:scroll-mt-8' : 'hidden'}>
        <WorkbenchSectionHeader
          kicker="Controller"
          title="CRD fleet"
          subtitle="Live FlexInfer resources from the controller, prioritized by operational risk."
          updatedAt={controllerUpdatedAt()}
          state={controllerSectionState()}
          stateDetail={controllerSectionDetail()}
          loading={controller.loading() || controller.controllerDataLoading()}
          action={
            <div class="flex flex-wrap gap-2">
              <button
                onClick={() => void controller.fetchCRDModels()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-white/20 hover:text-text-main"
              >
                Reload CRDs
              </button>
              <button
                onClick={() => void controller.fetchRegistryModels()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-white/20 hover:text-text-main"
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
                            <ModelFlag tone={row.model.spec.gpu?.shared ? 'bg-white/10 text-text-muted' : 'bg-white/10 text-text-dim'} label={row.model.spec.gpu?.shared ? `Shared ${row.model.spec.gpu.shared}` : 'Dedicated'} />
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
                              class="rounded-md bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50"
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

          <section id="telemetry" class={activeSection() === 'telemetry' ? 'scroll-mt-6 space-y-4 xl:scroll-mt-8' : 'hidden'}>
        <WorkbenchSectionHeader
          kicker="Telemetry"
          title="Proxy and router health"
          subtitle="FlexInfer proxy metrics, LiteLLM routing, and per-model request pressure."
          updatedAt={telemetryUpdatedAt()}
          state={telemetrySectionState()}
          stateDetail={telemetrySectionDetail()}
          loading={proxyLoading() || routerLoading()}
          action={
            <div class="flex flex-wrap gap-2">
              <button
                onClick={() => void refreshFlexInferProxy()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-white/20 hover:text-text-main"
              >
                Reload proxy
              </button>
              <button
                onClick={() => void refreshFlexInferRouter()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-white/20 hover:text-text-main"
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
              <WorkbenchStatCard label="Models" value={`${proxyTotals()?.modelCount ?? 0}`} tone="text-text-muted" note={proxyEnabled() ? 'live counts from metrics endpoint' : 'disabled'} />
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
                tone="text-text-muted"
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

          <section id="supply-chain" class={activeSection() === 'supply-chain' ? 'scroll-mt-6 space-y-4 xl:scroll-mt-8' : 'hidden'}>
        <WorkbenchSectionHeader
          kicker="Supply chain"
          title="Catalogs and caches"
          subtitle="Track upstream catalogs, cache job phases, and release readiness."
          updatedAt={supplyChainUpdatedAt()}
          state={supplyChainSectionState()}
          stateDetail={supplyChainSectionDetail()}
          loading={catalogLoading() || cacheLoading()}
          action={
            <div class="flex flex-wrap gap-2">
              <button
                onClick={() => void refreshFlexInferCatalogs()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-white/20 hover:text-text-main"
              >
                Reload catalogs
              </button>
              <button
                onClick={() => void refreshFlexInferCaches()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-white/20 hover:text-text-main"
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
                      <span class="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white">
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
              <WorkbenchStatCard label="Ready" value={`${supplyChainSummary().readyCacheCount}`} tone="text-status-ok" note="cache pipelines ready to serve" />
              <WorkbenchStatCard label="Failed" value={`${supplyChainSummary().failedCacheCount}`} tone="text-status-error" note="requires operator follow-up" />
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

          <section id="intake" class={activeSection() === 'intake' ? 'scroll-mt-6 space-y-4 xl:scroll-mt-8' : 'hidden'}>
        <WorkbenchSectionHeader
          kicker="Intake"
          title="Registry search and deployment intake"
          subtitle="Search HuggingFace or CivitAI, then register or download directly into the registry."
          updatedAt={controllerUpdatedAt()}
          state={controllerSectionState()}
          stateDetail={controllerSectionDetail()}
          loading={controller.loading()}
          action={
            <div class="flex flex-wrap gap-2">
              <button
                onClick={() => void controller.handleSearch()}
                disabled={controller.searching() || !controller.searchQuery().trim()}
                class="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/15 disabled:opacity-50"
              >
                {controller.searching() ? 'Searching...' : 'Search'}
              </button>
              <button
                onClick={() => void controller.fetchRegistryModels()}
                class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted hover:border-white/20 hover:text-text-main"
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
                class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-text-main focus:border-white/20 focus:outline-none"
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
                class="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-text-main placeholder:text-text-dim/60 focus:border-white/20 focus:outline-none"
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
                        class="rounded-md bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white disabled:opacity-50"
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
      </div>
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

const OverviewFocusCard: Component<{
  title: string;
  detail: string;
  stat: string;
  tone: string;
  onClick: () => void;
}> = (props) => (
  <button
    type="button"
    onClick={props.onClick}
    class="rounded-2xl border border-white/8 bg-white/5 p-4 text-left transition-colors hover:border-white/15 hover:bg-white/7"
  >
    <div class={`text-sm font-semibold ${props.tone}`}>{props.title}</div>
    <div class="mt-2 text-[11px] leading-5 text-text-dim">{props.detail}</div>
    <div class="mt-4 text-xs font-medium text-text-main">{props.stat}</div>
  </button>
);


const WorkbenchSectionHeader: Component<{
  kicker: string;
  title: string;
  subtitle: string;
  updatedAt: number;
  state: OperatorState;
  stateDetail?: string;
  loading: boolean;
  action?: any;
}> = (props) => (
  <div class="glass-panel flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
    <div class="min-w-0">
      <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">{props.kicker}</div>
      <div class="mt-1 text-lg font-semibold text-text-main">{props.title}</div>
      <div class="mt-1 max-w-3xl text-sm text-text-dim">{props.subtitle}</div>
      <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-dim">
        <span class={`rounded-full px-2.5 py-1 ${operatorStateBadgeClass(props.state)}`}>
          {operatorStateLabel(props.state, props.stateDetail)}
        </span>
        <span class="rounded-full bg-white/5 px-2.5 py-1">
          Updated {props.updatedAt ? new Date(props.updatedAt).toLocaleTimeString() : '—'}
        </span>
        <Show when={props.loading}>
          <span class="rounded-full bg-white/5 px-2.5 py-1 text-text-muted">Refreshing</span>
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
      return 'bg-white/10 text-white';
    case 'Pending':
      return 'bg-status-warn/20 text-status-warn';
    case 'Failed':
      return 'bg-status-error/20 text-status-error';
    case 'Preempted':
      return 'bg-white/10 text-text-muted';
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
      return 'bg-white/10 text-white';
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

function freshnessLabel(values: number[]): string {
  const latest = Math.max(...values, 0);
  if (!latest) return operatorStateLabel('offline');
  return operatorStateLabel(resolveFreshness(latest, 15_000));
}

function freshnessNote(values: number[]): string {
  const latest = Math.max(...values, 0);
  if (!latest) return 'No successful refresh yet.';
  return `Last successful refresh at ${new Date(latest).toLocaleTimeString()}.`;
}

function isWorkbenchSectionId(value: string): value is WorkbenchSectionId {
  return workbenchSectionIds.includes(value as WorkbenchSectionId);
}

function readWorkbenchSectionFromHash(): WorkbenchSectionId | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash;
  if (!hash.startsWith(workbenchSectionHashPrefix)) return null;

  const rawSection = hash.slice(workbenchSectionHashPrefix.length);
  return isWorkbenchSectionId(rawSection) ? rawSection : null;
}

function syncWorkbenchSectionHash(section: WorkbenchSectionId) {
  if (typeof window === 'undefined') return;
  const nextHash = `${workbenchSectionHashPrefix}${section}`;
  if (window.location.hash === nextHash) return;
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${nextHash}`);
}

function resolvePageScrollViewport(target: HTMLElement): HTMLElement | null {
  const nearestViewport = target.closest<HTMLElement>('[data-page-scroll-body]');
  if (nearestViewport) return nearestViewport;
  return document.querySelector<HTMLElement>('[data-page-scroll-body]');
}

export default FlexInferWorkbench;
