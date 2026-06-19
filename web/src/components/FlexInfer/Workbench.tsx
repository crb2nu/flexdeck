import { useLocation, useSearchParams } from '@solidjs/router';
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
import type {
  FlexInferModel,
  FlexInferModelStatus,
  FlexInferProxyModelMetrics,
  InferenceMetrics,
  ModelCache,
} from '../../lib/types';
import { formatDuration } from '../../lib/format';
import type { LiteLLMModelThroughput } from '../../lib/api/infrastructure';
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
  hasObservedInferenceMetrics,
  type ReliabilityStatus,
} from '../Models/controllerIntegration';
import {
  useModelsController,
  type ModelsTab,
} from '../Models/useModelsController';
import {
  activeConnectionsForModel,
  errorRateForModel as proxyErrorRateForModel,
  findProxyMetricModel,
  hasProxyMetricsForModel,
  proxyMetricsForModel,
  queueDepthForModel,
  requestsForModel,
} from '../Models/inferenceMetrics';
import OperationsSidebarNav from '../shared/OperationsSidebarNav';
import Button from '../shared/Button';
import PageHeader from '../shared/PageHeader';
import ModelTelemetryPanel from './ModelTelemetryPanel';
import ModelTelemetryDrawer from './ModelTelemetryDrawer';
import { stableListByKey } from '../../lib/stableList';
import { classifySeverity, SEVERITY_TIER_RANK, type SeverityInput, type SeverityTier } from './severity';

type Surface = 'models' | 'admin';
type WorkbenchSectionId = 'overview' | 'control-plane' | 'telemetry' | 'supply-chain' | 'intake';

const workbenchSectionIds: WorkbenchSectionId[] = [
  'overview',
  'control-plane',
  'telemetry',
  'supply-chain',
  'intake',
];

interface WorkbenchProps {
  surface?: Surface;
}

const FlexInferWorkbench: Component<WorkbenchProps> = (_props) => {
  const managementMode = () => getFlexInferManagementMode(healthStore.features || {});
  const proxyEnabled = () => healthStore.features?.flexinfer_proxy?.enabled ?? false;
  const modelCacheEnabled = () => healthStore.features?.modelcache?.enabled ?? false;
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams<{ section?: string }>();
  const activeSection = createMemo<WorkbenchSectionId>(() =>
    readWorkbenchSectionFromQueryValue(searchParams.section) ?? 'overview',
  );
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

  const refreshWorkbench = async () => {
    await Promise.all([
      controller.fetchCRDModels(),
      refreshFlexInferOperationalData(),
    ]);
    setControllerUpdatedAt(Date.now());
  };

  onMount(() => {
    startFlexInferOperationalPolling(false);
    void refreshWorkbench();
  });
  onCleanup(() => {
    stopFlexInferOperationalPolling();
  });

  const changeSection = (section: WorkbenchSectionId) => {
    setSearchParams(
      { section: section === 'overview' ? undefined : section },
      { replace: true },
    );
  };

  const supplyChainSummary = () => flexinferSupplyChainSummary();
  const proxyTotals = () => flexinferProxyTotals();
  const routerModels = () => routerInfo()?.modelInfo || [];
  const failedCacheCount = () => supplyChainSummary().failedCacheCount;
  const phaseCount = (phase: string) => controller.phaseSummary()[phase] || 0;
  const failedControllerCount = () => phaseCount('Failed');
  const controllerPhaseNote = () => {
    const phases = [
      ['Ready', 'ready'],
      ['Failed', 'failed'],
      ['Idle', 'idle'],
      ['Preempted', 'preempted'],
      ['Pending', 'pending'],
      ['Loading', 'loading'],
    ]
      .map(([phase, label]) => {
        const count = phaseCount(phase);
        return count > 0 ? `${count} ${label}` : null;
      })
      .filter((part): part is string => Boolean(part));

    return phases.length > 0 ? phases.join(' · ') : 'No CRD phase data';
  };
  const telemetryStatValue = () => {
    if (!proxyEnabled()) return 'off';
    return proxyTotals()?.requestsTotal != null ? proxyTotals()!.requestsTotal.toLocaleString() : '-';
  };
  const telemetryStatTone = () => {
    if (!proxyEnabled()) return 'text-text-dim';
    if (proxyError() || routerError()) return 'text-status-error';
    if (proxyMetrics()?.partial) return 'text-status-warn';
    return 'text-status-ok';
  };
  const telemetryStatNote = () => {
    if (!proxyEnabled()) return 'flexinfer proxy disabled';
    if (proxyError() || routerError()) return proxyError() || routerError() || 'telemetry issue';
    return `${((proxyTotals()?.errorRate ?? 0) * 100).toFixed(2)}% errors · ${proxyTotals()?.queueDepth ?? 0} queued`;
  };
  const telemetryFocusStat = () => (!proxyEnabled() ? 'disabled' : `${proxyTotals()?.queueDepth ?? 0} queued`);
  const supplyChainStatValue = () => {
    if (supplyChainSummary().catalogCount === 0) {
      return `${supplyChainSummary().readyCacheCount}/${supplyChainSummary().cacheCount}`;
    }
    return `${supplyChainSummary().catalogCount}/${supplyChainSummary().catalogModelCount}`;
  };
  const supplyChainStatTone = () => {
    if (failedCacheCount() > 0) return 'text-status-error';
    if (supplyChainSummary().readyCacheCount > 0) return 'text-status-ok';
    return 'text-text-dim';
  };
  const supplyChainStatNote = () => {
    const parts = [
      `${supplyChainSummary().cacheCount} caches`,
      `${supplyChainSummary().readyCacheCount} ready`,
    ];
    if (failedCacheCount() > 0) parts.push(`${failedCacheCount()} failed`);
    if (supplyChainSummary().catalogCount === 0) parts.push('no catalogs');
    return parts.join(' · ');
  };
  const supplyChainFocusStat = () => (failedCacheCount() > 0 ? `${failedCacheCount()} failed` : `${supplyChainSummary().readyCacheCount} ready`);
  const supplyChainSectionPartialDetail = () => {
    if (failedCacheCount() > 0) return `${failedCacheCount()} failed caches`;
    if (!modelCacheEnabled()) return 'cache disabled';
    if (supplyChainSummary().catalogCount === 0 && supplyChainSummary().cacheCount > 0) return 'no catalogs';
    return undefined;
  };
  const controllerSectionPartialDetail = () => (failedControllerCount() > 0 ? `${failedControllerCount()} failed CRDs` : undefined);
  const overviewStateDetail = () => {
    const parts: string[] = [];
    if (failedCacheCount() > 0) parts.push(`${failedCacheCount()} failed caches`);
    if (failedControllerCount() > 0) parts.push(`${failedControllerCount()} failed CRDs`);
    if (!proxyEnabled()) parts.push('proxy disabled');
    if (!modelCacheEnabled()) parts.push('cache disabled');
    if (proxyMetrics()?.partial) parts.push('partial telemetry');
    return parts.length > 0 ? parts.join(' · ') : undefined;
  };

  const controllerSectionState = createMemo<OperatorState>(() =>
    resolveOperatorState({
      loading: controller.loading() || controller.controllerDataLoading(),
      error: controller.error(),
      lastUpdateMs: controllerUpdatedAt(),
      staleAfterMs: 15_000,
      partial: failedControllerCount() > 0,
    }),
  );
  const controllerSectionDetail = () => {
    if (controller.error()) return 'controller issue';
    if (controllerSectionPartialDetail()) return controllerSectionPartialDetail();
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
      partial: !modelCacheEnabled() || failedCacheCount() > 0,
    }),
  );
  const supplyChainSectionDetail = () => {
    if (supplyChainSectionPartialDetail()) return supplyChainSectionPartialDetail();
    if (!modelCacheEnabled()) return 'cache disabled';
    if (catalogError() || cacheError()) return catalogError() && cacheError() ? 'upstream errors' : catalogError() ? 'catalog issue' : 'cache issue';
    if (catalogLoading() || cacheLoading()) return supplyChainUpdatedAt() ? 'background refresh' : 'initial sync';
    if (supplyChainSectionState() === 'stale') return 'poll lag';
    return undefined;
  };
  const overviewState = createMemo<OperatorState>(() =>
    resolveOperatorState({
      loading: controller.loading() || controller.controllerDataLoading() || proxyLoading() || routerLoading() || catalogLoading() || cacheLoading(),
      error: controller.error() || proxyError() || routerError() || catalogError() || cacheError(),
      lastUpdateMs: Math.max(controllerUpdatedAt(), telemetryUpdatedAt(), supplyChainUpdatedAt()),
      staleAfterMs: 15_000,
      partial: Boolean(overviewStateDetail()),
    }),
  );
  const headerStateSummary = () => {
    const telemetry = proxyEnabled() ? `${proxyTotals()?.queueDepth ?? 0} queued` : 'telemetry off';
    return `${telemetry} · ${controller.crdModels().length} CRDs`;
  };

  const modelRows = createMemo(() => {
    const currentProxyMetrics = proxyMetrics();
    const items = controller.crdModels().map((model) => {
      const key = `${model.namespace}/${model.name}`;
      const inferenceMetrics = controller.inferenceByModel()[key];
      const proxyMetricName = findProxyMetricModel(currentProxyMetrics, proxyMetricCandidates(model));
      const reliability = modelOperationalStatus(
        model,
        inferenceMetrics,
        proxyMetricsForModel(currentProxyMetrics, proxyMetricName),
      );
      const metricName = proxyMetricName || model.name;
      const sharedGroup = model.status?.sharedGroup;
      const severityInput: SeverityInput = {
        phase: model.status?.phase,
        reliability: reliability.level,
        stalled: isStalledLoad(model.status),
        queueDepth: queueDepthForModel(currentProxyMetrics, metricName),
        errorRate: proxyErrorRateForModel(currentProxyMetrics, metricName),
        requests: requestsForModel(currentProxyMetrics, metricName),
        preempted: Boolean(sharedGroup?.preemptedBy) || sharedGroup?.state === 'Preempted',
      };
      // Triage ordering: worst-first by severity (RA-1). Replaces the old
      // phase-only rank so a Ready-but-saturated or idle-with-traffic model
      // surfaces above a quietly-healthy one. See ./severity.ts.
      const severity = classifySeverity(severityInput);
      return {
        model,
        key,
        reliability,
        inferenceMetrics,
        proxyMetricName,
        throughput: controller.throughputByModel()[key],
        adapters: controller.loraByModel()[key] || [],
        integrationState: controller.integrationByModel()[key],
        severity: severity.score,
        severityTier: severity.tier,
      };
    });

    return items.sort((a, b) => {
      // Sort by COARSE tier, not the fine score: within a tier, live metric
      // jitter (queue/error) must NOT reorder rows every 15s poll — that churns
      // the DOM and reads as flicker. A stable name tiebreak keeps row order
      // fixed until a model genuinely changes tier.
      const at = SEVERITY_TIER_RANK[a.severityTier];
      const bt = SEVERITY_TIER_RANK[b.severityTier];
      if (at !== bt) return at - bt;
      return `${a.model.namespace}/${a.model.name}`.localeCompare(`${b.model.namespace}/${b.model.name}`);
    });
  });

  // Telemetry drill-in: which proxy model (if any) has its detail drawer open,
  // and a reverse map from proxy metric name -> CRD coordinates so the drawer
  // can fetch the richer Prometheus per-model inference series.
  const [selectedTelemetryModel, setSelectedTelemetryModel] = createSignal<string | null>(null);
  const proxyModelToCrd = createMemo(() => {
    const map = new Map<string, { namespace: string; name: string }>();
    for (const row of modelRows()) {
      const coords = { namespace: row.model.namespace, name: row.model.name };
      map.set(row.proxyMetricName || row.model.name, coords);
      map.set(row.model.name, coords);
    }
    return map;
  });

  // ----- Fleet Pulse Rail (Region A) data -----
  // GPU pools grouped from spec.gpu.shared, colored by the worst severity tier
  // in the pool — surfaces contention without a separate page.
  const gpuPools = createMemo(() => {
    const pools = new Map<string, { name: string; count: number; worstRank: number; worstTier: SeverityTier }>();
    for (const row of modelRows()) {
      const name = row.model.spec?.gpu?.shared || 'dedicated';
      const rank = SEVERITY_TIER_RANK[row.severityTier];
      const existing = pools.get(name);
      if (!existing) {
        pools.set(name, { name, count: 1, worstRank: rank, worstTier: row.severityTier });
      } else {
        existing.count += 1;
        if (rank < existing.worstRank) {
          existing.worstRank = rank;
          existing.worstTier = row.severityTier;
        }
      }
    }
    return [...pools.values()].sort(
      (a, b) => a.worstRank - b.worstRank || b.count - a.count || a.name.localeCompare(b.name),
    );
  });

  // Phase distribution segments for the fleet micro-bar.
  const phaseSegments = createMemo(() => {
    const order: Array<{ phase: string; class: string }> = [
      { phase: 'Failed', class: 'bg-sem-crit' },
      { phase: 'Preempted', class: 'bg-sem-warn' },
      { phase: 'Pending', class: 'bg-sem-warn/70' },
      { phase: 'Loading', class: 'bg-viz-1/70' },
      { phase: 'Idle', class: 'bg-white/20' },
      { phase: 'Ready', class: 'bg-sem-ok' },
    ];
    const total = modelRows().length || 1;
    return order
      .map((s) => ({ ...s, count: phaseCount(s.phase), pct: (phaseCount(s.phase) / total) * 100 }))
      .filter((s) => s.count > 0);
  });

  // Worst-of fleet verdict for the rail headline.
  const fleetVerdict = createMemo<{ tier: 'critical' | 'degraded' | 'healthy'; label: string; summary: string }>(() => {
    const failed = phaseCount('Failed');
    const preempted = phaseCount('Preempted');
    const degraded = controller.reliabilitySummary().degraded;
    const queue = proxyTotals()?.queueDepth ?? 0;
    const failedCaches = failedCacheCount();
    const parts: string[] = [];
    if (failed) parts.push(`${failed} failed`);
    if (degraded) parts.push(`${degraded} degraded`);
    if (preempted) parts.push(`${preempted} preempted`);
    if (failedCaches) parts.push(`${failedCaches} cache${failedCaches > 1 ? 's' : ''} failed`);
    if (queue >= 100) parts.push(`${queue} queued`);
    const summary = parts.length ? parts.join(' · ') : 'all systems nominal';
    if (failed > 0 || failedCaches > 0) return { tier: 'critical', label: 'Critical', summary };
    if (degraded > 0 || preempted > 0 || queue >= 100) return { tier: 'degraded', label: 'Degraded', summary };
    return { tier: 'healthy', label: 'Healthy', summary };
  });

  const registryRows = createMemo(() => controller.registryModels().slice().sort((a, b) => a.name.localeCompare(b.name)));
  const searchResults = () => controller.searchResults();

  // Stabilize list identity so <For> keeps DOM rows across 15s polling refreshes.
  // Reuse the row ref unless a STRUCTURAL field changes — volatile per-poll
  // metrics (queue/RPS/error/throughput/severity score) are excluded so they
  // don't recreate the row every tick (that churn was the visible flicker).
  // The telemetry cells read proxyMetrics() reactively, so live counters still
  // update without a DOM teardown.
  const stableModelRows = stableListByKey(
    modelRows,
    (row) => row.key,
    (row) =>
      [
        row.key,
        row.model.status?.phase ?? '',
        row.model.status?.loadingSubstage ?? '',
        row.model.status?.message ?? '',
        row.model.status?.loadingProgressAt ?? '',
        row.reliability.level,
        row.severityTier,
        row.adapters.length,
        row.model.spec?.source ?? '',
        row.model.status?.cache?.ready ?? '',
        row.model.status?.cache?.jobPhase ?? '',
        row.model.status?.cache?.strategy ?? '',
        row.model.status?.sharedGroup?.state ?? '',
        row.proxyMetricName ?? '',
      ].join('|'),
  );
  const stableRegistryRows = stableListByKey(
    registryRows,
    (model) => `${model.source}/${model.id ?? model.name}`,
  );
  const stableRouterModels = stableListByKey(
    routerModels,
    (entry) => entry.model_name,
  );
  const stableCatalogs = stableListByKey(
    catalogs,
    (catalog) => `${catalog.namespace}/${catalog.name}`,
  );
  const stableCaches = stableListByKey(
    caches,
    (cache) => `${cache.namespace}/${cache.name}`,
  );
  const stableSearchResults = stableListByKey(
    searchResults,
    (model) => `${model.source}/${model.source_id}`,
  );
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
      href: buildWorkbenchSectionHref(location.pathname, location.query, 'overview'),
      replace: true,
      eyebrow: 'Cockpit',
      value: freshnessLabel([proxyUpdatedAt(), routerUpdatedAt(), catalogUpdatedAt(), cacheUpdatedAt()]),
      detail: `${controller.crdModels().length} CRDs · ${proxyTotals()?.requestsTotal ?? 0} requests`,
      group: 'Primary',
    },
    {
      id: 'control-plane' as const,
      label: 'Control plane',
      href: buildWorkbenchSectionHref(location.pathname, location.query, 'control-plane'),
      replace: true,
      eyebrow: 'CRDs',
      value: `${controller.crdModels().length}`,
      detail: reliabilityHeadline().label,
      group: 'Operations',
    },
    {
      id: 'telemetry' as const,
      label: 'Telemetry',
      href: buildWorkbenchSectionHref(location.pathname, location.query, 'telemetry'),
      replace: true,
      eyebrow: 'Proxy + router',
      value: proxyEnabled() ? `${proxyTotals()?.queueDepth ?? 0}` : 'off',
      detail: proxyEnabled() ? `${proxyTotals()?.requestsTotal ?? 0} requests` : 'flexinfer proxy disabled',
      group: 'Operations',
    },
    {
      id: 'supply-chain' as const,
      label: 'Supply chain',
      href: buildWorkbenchSectionHref(location.pathname, location.query, 'supply-chain'),
      replace: true,
      eyebrow: 'Catalogs + caches',
      value: `${supplyChainSummary().cacheCount}`,
      detail: supplyChainStatNote(),
      group: 'Operations',
    },
    {
      id: 'intake' as const,
      label: 'Intake',
      href: buildWorkbenchSectionHref(location.pathname, location.query, 'intake'),
      replace: true,
      eyebrow: 'Registry + search',
      value: `${controller.registryModels().length}`,
      detail: `${controller.searchResults().length} staged results`,
      group: 'Operations',
    },
  ]);

  return (
    <div class="mx-auto flex w-full max-w-[1680px] min-w-0 flex-col gap-4 pb-6">
      <PageHeader title="FlexInfer Workbench">
        <div class="flex items-center gap-2">
          <span class={`rounded-md px-2 py-0.5 text-[10px] font-medium ${proxyHealthClass()}`}>
            Proxy {proxyHealthLabel()}
          </span>
          <span class={`rounded-md px-2 py-0.5 text-[10px] font-medium ${getReliabilityClasses(reliabilityHeadline().level)}`}>
            {headerStateSummary()}
          </span>
          <span class="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-medium text-text-muted">
            {managementMode()}
          </span>
        </div>
        <div class="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => void refreshWorkbench()}>
            Refresh all
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void controller.discoverModels()} disabled={controller.discoverLoading()}>
            {controller.discoverLoading() ? 'Syncing...' : 'Sync CRDs'}
          </Button>
        </div>
      </PageHeader>

      <Show when={controller.error()}>
        <div class="surface border-status-error/20 p-4 text-sm text-status-error">
          {controller.error()}
        </div>
      </Show>

      <div class="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <OperationsSidebarNav
          title="Workbench"
          description=""
          items={sectionNav()}
          active={activeSection()}
        />

        <div class="min-w-0 space-y-4">
          <section id="overview" class={activeSection() === 'overview' ? 'scroll-mt-6 space-y-4 xl:scroll-mt-8' : 'hidden'}>
            <WorkbenchSectionHeader
              kicker="Overview"
              title="Operator briefing"
              subtitle=""
              updatedAt={Math.max(controllerUpdatedAt(), telemetryUpdatedAt(), supplyChainUpdatedAt())}
              state={overviewState()}
              stateDetail={controller.error() || proxyError() || routerError() || catalogError() || cacheError() ? 'multi-surface review' : overviewStateDetail()}
              loading={controller.loading() || controller.controllerDataLoading() || proxyLoading() || routerLoading()}
            />

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
          <WorkbenchStatCard
            label="Controller"
            value={`${controller.crdModels().length}`}
            tone={failedControllerCount() > 0 ? 'text-status-error' : 'text-text-muted'}
            note={controllerPhaseNote()}
          />
          <WorkbenchStatCard
            label="Telemetry"
            value={telemetryStatValue()}
            tone={telemetryStatTone()}
            note={telemetryStatNote()}
          />
          <WorkbenchStatCard
            label="Supply chain"
            value={supplyChainStatValue()}
            tone={supplyChainStatTone()}
            note={supplyChainStatNote()}
          />
          <WorkbenchStatCard
            label="Data freshness"
            value={freshnessLabel([proxyUpdatedAt(), routerUpdatedAt(), catalogUpdatedAt(), cacheUpdatedAt()])}
            tone="text-text-main"
            note={freshnessNote([proxyUpdatedAt(), routerUpdatedAt(), catalogUpdatedAt(), cacheUpdatedAt()])}
          />
        </div>

        <div class="grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
          <OverviewFocusCard
            title="Control plane"
            stat={`${controller.crdModels().length} models`}
            tone="text-text-muted"
            onClick={() => changeSection('control-plane')}
          />
          <OverviewFocusCard
            title="Telemetry"
            stat={telemetryFocusStat()}
            tone={telemetryStatTone()}
            onClick={() => changeSection('telemetry')}
          />
          <OverviewFocusCard
            title="Supply chain"
            stat={supplyChainFocusStat()}
            tone={supplyChainStatTone()}
            onClick={() => changeSection('supply-chain')}
          />
          <OverviewFocusCard
            title="Intake"
            stat={`${searchResults().length} staged`}
            tone="text-text-main"
            onClick={() => changeSection('intake')}
          />
        </div>
          </section>

          <section id="control-plane" class={activeSection() === 'control-plane' ? 'scroll-mt-6 space-y-4 xl:scroll-mt-8' : 'hidden'}>
        <WorkbenchSectionHeader
          kicker="Controller"
          title="CRD fleet"
          subtitle=""
          updatedAt={controllerUpdatedAt()}
          state={controllerSectionState()}
          stateDetail={controllerSectionDetail()}
          loading={controller.loading() || controller.controllerDataLoading()}
          action={
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void controller.fetchCRDModels()}>Reload CRDs</Button>
              <Button variant="secondary" size="sm" onClick={() => void controller.fetchRegistryModels()}>Reload registry</Button>
            </div>
          }
        />

        {/* Region A — Fleet Pulse Rail: glanceable fleet verdict, phase
            distribution, load, cache, and GPU-pool contention. */}
        <Show when={modelRows().length > 0}>
          <div class="surface flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
            <div class="flex items-center gap-2">
              <span class={`rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${verdictBadgeClass(fleetVerdict().tier)}`}>
                {fleetVerdict().label}
              </span>
              <span class="text-[11px] text-text-dim">{fleetVerdict().summary}</span>
            </div>

            <div class="flex items-center gap-2">
              <span class="heading-label">Fleet</span>
              <div class="flex h-1.5 w-32 overflow-hidden rounded-full bg-white/5">
                <For each={phaseSegments()}>
                  {(seg) => <div class={seg.class} style={{ width: `${seg.pct}%` }} title={`${seg.count} ${seg.phase}`} />}
                </For>
              </div>
              <span class="num text-[11px] text-text-dim">{modelRows().length} CRDs</span>
            </div>

            <div class="flex items-center gap-2 text-[11px] text-text-dim">
              <span class="heading-label">Load</span>
              <span class={`num ${(proxyTotals()?.queueDepth ?? 0) >= 100 ? 'text-sem-crit' : (proxyTotals()?.queueDepth ?? 0) >= 10 ? 'text-util-near' : 'text-text-muted'}`}>
                {proxyTotals()?.queueDepth ?? 0} queued
              </span>
              <span class={`num ${(proxyTotals()?.errorRate ?? 0) >= 0.02 ? 'text-sem-crit' : 'text-text-muted'}`}>
                {((proxyTotals()?.errorRate ?? 0) * 100).toFixed(2)}% err
              </span>
            </div>

            <div class="flex items-center gap-2 text-[11px] text-text-dim">
              <span class="heading-label">Caches</span>
              <span class="num text-text-muted">{supplyChainSummary().readyCacheCount}/{supplyChainSummary().cacheCount}</span>
              <Show when={failedCacheCount() > 0}>
                <span class="num text-sem-crit">{failedCacheCount()} failed</span>
              </Show>
            </div>

            <Show when={gpuPools().length > 0}>
              <div class="flex min-w-0 flex-1 items-center gap-2">
                <span class="heading-label shrink-0">GPU pools</span>
                <div class="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  <For each={gpuPools()}>
                    {(pool) => (
                      <span class="inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-text-muted">
                        <span class={`inline-block h-1.5 w-1.5 rounded-full ${triageAccent(pool.worstTier)}`} />
                        <span class="truncate max-w-[10rem]">{pool.name}</span>
                        <span class="num text-text-dim">{pool.count}</span>
                      </span>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={modelRows().length > 0} fallback={<WorkbenchEmpty message="No FlexInfer CRDs found yet." />}>
          <div class="surface divide-y divide-white/5 overflow-hidden">
            <For each={stableModelRows()}>
              {(row) => {
                const metricName = () => row.proxyMetricName || row.model.name;
                const hasProxy = () =>
                  !!row.proxyMetricName && hasProxyMetricsForModel(proxyMetrics(), row.proxyMetricName);
                const queue = () => queueDepthForModel(proxyMetrics(), metricName());
                const errPct = () => proxyErrorRateForModel(proxyMetrics(), metricName()) * 100;
                const actionKey = (action: string) => `${row.model.namespace}/${row.model.name}/${action}`;
                return (
                  <div class="relative px-4 py-2.5 transition-colors hover:bg-white/[0.04]">
                    <div class={`absolute left-0 top-2 bottom-2 w-[2px] rounded-full ${triageAccent(row.severityTier)}`} />
                    <div class="flex items-start justify-between gap-3 pl-2">
                      <div class="min-w-0 flex-1 space-y-1.5">
                        {/* Identity + live triage chips */}
                        <div class="flex flex-wrap items-center gap-1.5">
                          <span class="font-medium text-text-main">{row.model.name}</span>
                          <Show when={queue() > 0}>
                            <span class={`num rounded-full px-2 py-0.5 text-[10px] font-semibold ${queueChipClass(queue())}`}>
                              Q {queue().toFixed(0)}
                            </span>
                          </Show>
                          <Show when={errPct() >= 0.01}>
                            <span class="num rounded-full bg-sem-crit/15 px-2 py-0.5 text-[10px] font-semibold text-sem-crit">
                              {errPct().toFixed(1)}% err
                            </span>
                          </Show>
                        </div>
                        <div class="truncate font-mono text-[10px] text-text-dim">
                          {row.model.namespace} · {row.model.spec.source}
                        </div>
                        {/* Phase + reliability (+ loading detail) */}
                        <ModelPhaseDetail status={row.model.status} reliability={row.reliability} />
                        {/* Compact telemetry strip — one line instead of six */}
                        <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-text-dim">
                          <Show
                            when={hasProxy()}
                            fallback={<span class="text-text-dim/70">No proxy series yet</span>}
                          >
                            <span class="num">Req {requestsForModel(proxyMetrics(), metricName()).toFixed(0)}</span>
                            <span class="num">RPS {formatMetricNumber(row.inferenceMetrics?.requestsPerSec)}</span>
                            <span class="num">Tok/s {formatMetricNumber(modelThroughputValue(row.model, row.inferenceMetrics, row.throughput))}</span>
                            <span class="num">Queue {queue().toFixed(0)}</span>
                            <span class="num">Conn {activeConnectionsForModel(proxyMetrics(), metricName()).toFixed(0)}</span>
                            <span class="num">Error {errPct().toFixed(2)}%</span>
                          </Show>
                          <span class="text-text-dim/40">·</span>
                          <span>{modelSignalSummary(row.model, row.inferenceMetrics, row.throughput, row.integrationState?.inferenceAvailable, row.proxyMetricName)}</span>
                          <span class="text-text-dim/40">·</span>
                          <span>cache {row.model.status?.cache?.strategy || row.model.spec.cache?.strategy || 'none'} {cacheReadinessLabel(row.model.status)}</span>
                        </div>
                        {/* Static signals */}
                        <div class="flex flex-wrap gap-1.5">
                          <ModelFlag tone={row.model.spec.serverless?.enabled === false ? 'bg-white/10 text-text-dim' : 'bg-status-ok/20 text-status-ok'} label={row.model.spec.serverless ? 'Serverless' : 'Static'} />
                          <ModelFlag tone={row.model.spec.gpu?.shared ? 'bg-white/10 text-text-muted' : 'bg-white/10 text-text-dim'} label={row.model.spec.gpu?.shared ? `Shared ${row.model.spec.gpu.shared}` : 'Dedicated'} />
                          <ModelFlag tone={row.adapters.length > 0 ? 'bg-status-ok/20 text-status-ok' : 'bg-white/10 text-text-dim'} label={row.adapters.length > 0 ? `${row.adapters.length} LoRA` : 'No LoRA'} />
                        </div>
                      </div>
                      {/* Actions */}
                      <div class="flex flex-shrink-0 flex-col gap-1.5">
                        <button
                          onClick={() => void controller.handleCRDAction('activate', row.model)}
                          disabled={controller.crdActionLoading() === actionKey('activate')}
                          class="rounded-md bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white transition-colors hover:bg-white/15 disabled:opacity-50"
                        >
                          Activate
                        </button>
                        <button
                          onClick={() => void controller.handleCRDAction('restart', row.model)}
                          disabled={controller.crdActionLoading() === actionKey('restart')}
                          class="rounded-md bg-white/10 px-2.5 py-1 text-[10px] font-medium text-text-muted transition-colors hover:bg-white/15 disabled:opacity-50"
                        >
                          Restart
                        </button>
                        <button
                          onClick={() => void controller.handleCRDAction('scale0', row.model)}
                          disabled={controller.crdActionLoading() === actionKey('scale0')}
                          class="rounded-md bg-status-warn/20 px-2.5 py-1 text-[10px] font-medium text-status-warn transition-colors hover:bg-status-warn/30 disabled:opacity-50"
                        >
                          Scale 0
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
          </section>

          <section id="telemetry" class={activeSection() === 'telemetry' ? 'scroll-mt-6 space-y-4 xl:scroll-mt-8' : 'hidden'}>
        <WorkbenchSectionHeader
          kicker="Telemetry"
          title="Proxy and router health"
          subtitle=""
          updatedAt={telemetryUpdatedAt()}
          state={telemetrySectionState()}
          stateDetail={telemetrySectionDetail()}
          loading={proxyLoading() || routerLoading()}
          action={
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void refreshFlexInferProxy()}>Reload proxy</Button>
              <Button variant="secondary" size="sm" onClick={() => void refreshFlexInferRouter()}>Reload router</Button>
            </div>
          }
        />

        <ModelTelemetryPanel onSelectModel={setSelectedTelemetryModel} />
        <Show when={selectedTelemetryModel()}>
          {(model) => (
            <ModelTelemetryDrawer
              model={model()}
              crd={proxyModelToCrd().get(model())}
              onClose={() => setSelectedTelemetryModel(null)}
            />
          )}
        </Show>

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div class="surface overflow-hidden">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="heading-label">Router table</div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-white/5 text-left text-text-dim">
                    <th class="px-4 py-3 font-medium">Model</th>
                    <th class="px-4 py-3 font-medium">Upstream</th>
                    <th class="px-4 py-3 font-medium text-right">RPM</th>
                    <th class="px-4 py-3 font-medium text-right">TPM</th>
                    <th class="px-4 py-3 font-medium text-right">Max tokens</th>
                  </tr>
                </thead>
                <tbody>
                  <For
                    each={stableRouterModels()}
                    fallback={
                      <tr>
                        <td class="px-4 py-5 text-center text-text-dim" colSpan={5}>
                          No router mapping available.
                        </td>
                      </tr>
                    }
                  >
                    {(entry) => (
                      <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td class="px-4 py-3 font-mono text-text-main">{entry.model_name}</td>
                        <td class="px-4 py-3 font-mono text-text-dim">{entry.litellm_params?.model || '—'}</td>
                        <td class="px-4 py-3 text-right font-mono text-text-muted">{entry.litellm_params?.rpm?.toLocaleString() || '—'}</td>
                        <td class="px-4 py-3 text-right font-mono text-text-muted">{entry.litellm_params?.tpm?.toLocaleString() || '—'}</td>
                        <td class="px-4 py-3 text-right font-mono text-text-muted">{entry.litellm_params?.max_tokens?.toLocaleString() || '—'}</td>
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

          <div class="surface p-4">
            <div class="heading-label">Model detail coverage</div>
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
          subtitle=""
          updatedAt={supplyChainUpdatedAt()}
          state={supplyChainSectionState()}
          stateDetail={supplyChainSectionDetail()}
          loading={catalogLoading() || cacheLoading()}
          action={
            <div class="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => void refreshFlexInferCatalogs()}>Reload catalogs</Button>
              <Button variant="secondary" size="sm" onClick={() => void refreshFlexInferCaches()}>Reload caches</Button>
            </div>
          }
        />

        <Show when={catalogError()}>
          <div class="surface border border-status-error/20 p-4 text-sm text-status-error">
            {catalogError()}
          </div>
        </Show>

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div class="surface overflow-hidden">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="heading-label">Catalogs</div>
            </div>
            <div class="divide-y divide-white/5">
              <For
                each={stableCatalogs()}
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

          <div class="surface overflow-hidden">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="heading-label">Cache jobs</div>
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
                    each={stableCaches()}
                    fallback={
                      <tr>
                        <td class="px-4 py-5 text-center text-text-dim" colSpan={3}>
                          No cache pipelines found.
                        </td>
                      </tr>
                    }
                  >
                    {(cache) => (
                      <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
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
          subtitle=""
          updatedAt={controllerUpdatedAt()}
          state={controllerSectionState()}
          stateDetail={controllerSectionDetail()}
          loading={controller.loading()}
          action={
            <div class="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" onClick={() => void controller.handleSearch()} disabled={controller.searching() || !controller.searchQuery().trim()}>
                {controller.searching() ? 'Searching...' : 'Search'}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void controller.fetchRegistryModels()}>Reload registry</Button>
            </div>
          }
        />

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div class="surface p-4 xl:col-span-1">
            <div class="heading-label">Search</div>
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
            </div>
          </div>

          <div class="surface overflow-hidden xl:col-span-2">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="heading-label">Search results</div>
            </div>
            <div class="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
              <For
                each={stableSearchResults()}
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
          <div class="surface overflow-hidden">
            <div class="border-b border-white/5 px-4 py-3">
              <div class="heading-label">Registry models</div>
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
                    each={stableRegistryRows()}
                    fallback={
                      <tr>
                        <td class="px-4 py-5 text-center text-text-dim" colSpan={4}>
                          No registry models found.
                        </td>
                      </tr>
                    }
                  >
                    {(model) => (
                      <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
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

        </div>
          </section>
        </div>
      </div>
    </div>
  );
};

const statCardBorder: Record<string, string> = {
  'text-text-muted': 'rgba(255,255,255,0.1)',
  'text-status-ok': 'rgba(0,240,255,0.3)',
  'text-status-warn': 'rgba(255,196,87,0.35)',
  'text-status-error': 'rgba(255,76,114,0.35)',
  'text-text-dim': 'rgba(189,0,255,0.3)',
  'text-text-main': 'rgba(10,255,104,0.3)',
};

const WorkbenchStatCard: Component<{ label: string; value: string; tone: string; note: string }> = (props) => (
  <div class="surface border-l-2 p-3" style={{ 'border-left-color': statCardBorder[props.tone] ?? 'rgba(255,255,255,0.1)' }}>
    <div class="heading-label">{props.label}</div>
    <div class={`mt-1.5 text-xl font-semibold ${props.tone}`}>{props.value}</div>
    <div class="mt-0.5 text-xs text-text-dim">{props.note}</div>
  </div>
);

const OverviewFocusCard: Component<{
  title: string;
  stat: string;
  tone: string;
  onClick: () => void;
}> = (props) => (
  <button
    type="button"
    onClick={props.onClick}
    class="surface-hover flex items-center justify-between rounded-md border-l-2 p-3 text-left"
    style={{ 'border-left-color': statCardBorder[props.tone] ?? 'rgba(255,255,255,0.1)' }}
  >
    <div>
      <div class={`text-sm font-semibold ${props.tone}`}>{props.title}</div>
      <div class="mt-1 text-xs font-medium text-text-main">{props.stat}</div>
    </div>
    <span class="text-lg text-text-dim">&rsaquo;</span>
  </button>
);

function proxyMetricCandidates(model: FlexInferModel): string[] {
  return uniqueStrings([
    model.name,
    model.spec.litellm?.servedModelName,
    ...(model.spec.litellm?.aliases || []),
    model.spec.litellm?.copilotAlias,
  ]);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function modelOperationalStatus(
  model: FlexInferModel,
  metrics: InferenceMetrics | null | undefined,
  proxyMetrics: FlexInferProxyModelMetrics | undefined,
): ReliabilityStatus {
  const phase = model.status?.phase;
  const conditionStatus = conditionOperationalStatus(model.status);
  if (conditionStatus) return conditionStatus;

  if (metrics && hasObservedInferenceMetrics(metrics)) {
    return getReliabilityStatus(metrics);
  }

  if (phase === 'Failed') return { level: 'degraded', label: 'Degraded' };
  if (phase === 'Ready') return { level: 'healthy', label: 'Healthy' };
  if (phase === 'Loading' || phase === 'Pending') return { level: 'partial', label: 'Starting' };
  if (phase === 'Idle' || phase === 'Preempted') {
    if ((proxyMetrics?.queueDepth ?? 0) > 0 || (proxyMetrics?.activeConnections ?? 0) > 0) {
      return { level: 'partial', label: 'Queued' };
    }
    return { level: 'unknown', label: 'Standby' };
  }

  return { level: 'unknown', label: 'Unknown' };
}

function conditionOperationalStatus(status?: FlexInferModelStatus): ReliabilityStatus | undefined {
  const phase = status?.phase;
  for (const condition of status?.conditions || []) {
    const type = condition.type.toLowerCase();
    const value = condition.status.toLowerCase();
    if (value === 'true' && (type.includes('degraded') || type.includes('failed') || type.includes('stalled'))) {
      return { level: 'degraded', label: condition.reason || 'Degraded' };
    }
    if (
      phase === 'Ready' &&
      value === 'false' &&
      ['ready', 'available', 'healthy', 'serving'].some((token) => type.includes(token))
    ) {
      return { level: 'degraded', label: condition.reason || 'Degraded' };
    }
  }
  return undefined;
}

function modelSignalSummary(
  model: FlexInferModel,
  metrics: InferenceMetrics | null | undefined,
  throughput: LiteLLMModelThroughput | undefined,
  inferenceAvailable: boolean | undefined,
  proxyMetricName: string | undefined,
): string {
  const throughputValue = modelThroughputValue(model, metrics, throughput);
  const inferenceLabel = inferenceAvailable || proxyMetricName ? 'Inference observed' : 'No inference series';
  if (throughputValue != null) {
    return `${inferenceLabel} · ${formatMetricNumber(throughputValue)} tok/s`;
  }
  return `${inferenceLabel} · tok/s unavailable`;
}

function modelThroughputValue(
  model: FlexInferModel,
  metrics: InferenceMetrics | null | undefined,
  throughput: LiteLLMModelThroughput | undefined,
): number | undefined {
  return firstFiniteNumber([
    parseFiniteNumber(model.status?.metrics?.tokensPerSecond),
    metrics?.tps,
    throughput?.tok_per_sec_1m,
    throughput?.output_tok_per_sec,
  ]);
}

function firstFiniteNumber(values: Array<number | null | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function parseFiniteNumber(value: string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatMetricNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function cacheReadinessLabel(status?: FlexInferModelStatus): string {
  const cache = status?.cache;
  if (cache?.ready || cache?.jobPhase === 'Ready') return 'ready';
  if (cache?.jobPhase) return cache.jobPhase.toLowerCase();
  return 'pending';
}

const ModelPhaseDetail: Component<{
  status?: FlexInferModelStatus;
  reliability: ReliabilityStatus;
}> = (props) => {
  const hasLoadingDetail = () =>
    props.status?.phase === 'Loading';

  return (
    <div class="min-w-[12rem] max-w-[22rem]">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class={`rounded-full px-2.5 py-1 text-[10px] font-medium ${phaseTone(props.status?.phase)}`}>
          {props.status?.phase || 'Unknown'}
        </span>
        <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getReliabilityClasses(props.reliability.level)}`}>
          {props.reliability.label}
        </span>
      </div>

      <Show when={hasLoadingDetail()}>
        <div class={`mt-2 border-l-2 pl-2.5 ${loadingSubstageAccent(props.status)}`}>
          <div class="flex flex-wrap items-center gap-1.5">
            <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${loadingSubstageTone(props.status, props.status?.loadingSubstage)}`}>
              {loadingSubstageLabel(props.status?.loadingSubstage)}
            </span>
            <Show when={isStalledLoad(props.status)}>
              <span class="rounded-full bg-status-error/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-status-error">
                stalled
              </span>
            </Show>
          </div>
          <div class="mt-1 text-[10px] uppercase tracking-wide text-text-dim">
            {loadingSubstageDetail(props.status?.loadingSubstage)}
          </div>
          <Show when={props.status?.message}>
            {(message) => (
              <div class="mt-1 max-w-[20rem] break-words font-mono text-[10px] leading-4 text-text-main/85" title={message()}>
                {message()}
              </div>
            )}
          </Show>
          <Show when={loadingProgressAgeLabel(props.status)}>
            {(ageLabel) => (
              <div class="mt-1 font-mono text-[10px] text-text-dim">
                {ageLabel()}
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
};

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
  <div class="surface flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
    <div class="min-w-0">
      <div class="flex items-center gap-3">
        <h3 class="heading-section">{props.title}</h3>
        <span class={`rounded-md px-2 py-0.5 text-[10px] font-medium ${operatorStateBadgeClass(props.state)}`}>
          {operatorStateLabel(props.state, props.stateDetail)}
        </span>
        <Show when={props.loading}>
          <span class="rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-text-muted">Refreshing</span>
        </Show>
      </div>
      <div class="mt-1 text-xs text-text-dim">
        Updated {props.updatedAt ? new Date(props.updatedAt).toLocaleTimeString() : '—'}
      </div>
    </div>
    <Show when={props.action}>
      <div class="shrink-0">{props.action}</div>
    </Show>
  </div>
);

const WorkbenchEmpty: Component<{ message: string }> = (props) => (
  <div class="surface p-4 text-center text-sm text-text-dim">{props.message}</div>
);

const ModelFlag: Component<{ tone: string; label: string }> = (props) => (
  <span class={`rounded-full px-2.5 py-1 text-[10px] font-medium ${props.tone}`}>{props.label}</span>
);

// Left-edge severity accent for a triage card — color by tier.
function triageAccent(tier: SeverityTier): string {
  switch (tier) {
    case 'critical': return 'bg-sem-crit';
    case 'degraded': return 'bg-sem-warn';
    case 'loading': return 'bg-viz-1/70';
    case 'standby': return 'bg-white/15';
    default: return 'bg-sem-ok/50'; // healthy
  }
}

// Color-coded queue chip: pre-attentive "busy-good vs saturated-bad".
function queueChipClass(queue: number): string {
  if (queue >= 100) return 'bg-sem-crit/15 text-sem-crit';   // overloaded
  if (queue >= 10) return 'bg-util-near/15 text-util-near';  // building
  return 'bg-util-safe/15 text-util-safe';                   // light traffic
}

function verdictBadgeClass(tier: 'critical' | 'degraded' | 'healthy'): string {
  switch (tier) {
    case 'critical': return 'bg-sem-crit/15 text-sem-crit';
    case 'degraded': return 'bg-sem-warn/15 text-sem-warn';
    default: return 'bg-status-ok/15 text-status-ok';
  }
}

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

// STALLED_LOAD_THRESHOLD_MS mirrors the proxy's defaultStalledLoadThreshold
// (internal/proxy/stalled_load.go). Keep in sync so UI stall classification
// matches the proxy's fail-fast behavior.
const STALLED_LOAD_THRESHOLD_MS = 120_000;

function isStalledLoad(status?: FlexInferModelStatus): boolean {
  if (!status) return false;
  if (status.phase !== 'Loading') return false;
  if (status.loadingSubstage !== 'LoadingWeights') return false;
  if (!status.loadingProgressAt) return false;
  const t = Date.parse(status.loadingProgressAt);
  if (Number.isNaN(t)) return false;
  return Date.now() - t >= STALLED_LOAD_THRESHOLD_MS;
}

function loadingSubstageTone(status: FlexInferModelStatus | undefined, substage?: string): string {
  if (isStalledLoad(status)) {
    return 'bg-status-error/20 text-status-error';
  }
  switch (substage) {
    case 'LoadingWeights':
    case 'Compiling':
      return 'bg-white/10 text-white';
    case 'HealthCheckPending':
      return 'bg-status-ok/10 text-status-ok';
    case 'ImagePulling':
    case 'Initializing':
    default:
      return 'bg-white/10 text-text-dim';
  }
}

function loadingSubstageAccent(status?: FlexInferModelStatus): string {
  if (isStalledLoad(status)) return 'border-status-error/50';
  switch (status?.loadingSubstage) {
    case 'HealthCheckPending':
      return 'border-status-ok/40';
    case 'LoadingWeights':
    case 'Compiling':
      return 'border-white/20';
    case 'ImagePulling':
    case 'Initializing':
    default:
      return 'border-white/10';
  }
}

function loadingSubstageLabel(substage?: string): string {
  switch (substage) {
    case 'ImagePulling':
      return 'Pulling image';
    case 'Initializing':
      return 'Runtime init';
    case 'LoadingWeights':
      return 'Loading weights';
    case 'Compiling':
      return 'Compiling graphs';
    case 'HealthCheckPending':
      return 'Readiness probe';
    default:
      return 'Loading detail';
  }
}

function loadingSubstageDetail(substage?: string): string {
  switch (substage) {
    case 'ImagePulling':
      return 'Runtime image is still being fetched';
    case 'Initializing':
      return 'Container is up, runtime is starting';
    case 'LoadingWeights':
      return 'Model weights are being loaded into the runtime';
    case 'Compiling':
      return 'Kernel or graph compilation is in progress';
    case 'HealthCheckPending':
      return 'Weights loaded, waiting on readiness';
    default:
      return 'Controller has not reported a substage yet';
  }
}

function loadingProgressAgeLabel(status?: FlexInferModelStatus): string | undefined {
  if (!status?.loadingProgressAt) return undefined;
  const progressAt = Date.parse(status.loadingProgressAt);
  if (Number.isNaN(progressAt)) return undefined;
  const elapsedMs = Math.max(0, Date.now() - progressAt);
  const prefix = isStalledLoad(status) ? 'No progress for' : 'Updated';
  return `${prefix} ${formatDuration(elapsedMs)}${isStalledLoad(status) ? '' : ' ago'}`;
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

function readWorkbenchSectionFromQueryValue(value?: string | string[]): WorkbenchSectionId | null {
  const rawSection = Array.isArray(value) ? value[0] : value;
  if (!rawSection) return null;
  return isWorkbenchSectionId(rawSection) ? rawSection : null;
}

function buildWorkbenchSectionHref(
  pathname: string,
  query: Record<string, string | string[] | undefined>,
  section: WorkbenchSectionId,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (key === 'section' || value == null) continue;

    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, entry);
      }
      continue;
    }

    params.set(key, value);
  }

  if (section !== 'overview') {
    params.set('section', section);
  }

  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export default FlexInferWorkbench;
