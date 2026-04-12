import { Component, createSignal, createMemo, onMount, onCleanup, Show, For } from 'solid-js';
import { PulseCard, TabBar, LoadingState } from '../shared';
import { k8sStore, connectK8sStream, disconnectK8sStream, connectionStatus, isNodeReady } from '../../stores/k8s';
import { getNodeMetrics, getPodMetrics, getUsageColor, getUsageGradient } from '../../stores/metrics';
import { startDashboardSummaryPolling, stopDashboardSummaryPolling } from '../../stores/dashboardSummary';
import { formatBytes, formatPercent } from '../../lib/format';
import type { K8sNode, K8sPod, K8sService } from '../../lib/types';
import TopologyGraph from './TopologyGraph';
import HoloDeck from './HoloDeck';
import PodLogPanel from './PodLogPanel';
import EventsFeed from './EventsFeed';
import AlertsPanel from './AlertsPanel';
import LangfuseWidget from './LangfuseWidget';
import NodeResourcePanel from './NodeResourcePanel';
import { DetailPanel } from '../shared';
import { dataStateLabel, resolveDashboardDataState } from './statusSemantics';
import { useDashboardSummaryState } from './useDashboardSummaryState';
import { useDashboardTopologyFilters } from './useDashboardTopologyFilters';

const METRICS_REFRESH_INTERVAL = 30000; // 30 seconds for Prometheus metrics
const DASHBOARD_STALE_AFTER_MS = METRICS_REFRESH_INTERVAL * 3;

interface SelectedItem {
  type: 'node' | 'pod' | 'service';
  data: K8sNode | K8sPod | K8sService;
}

const Dashboard: Component = () => {
  const [viewMode, setViewMode] = createSignal<'2d' | '3d'>('2d');
  const [showFilters, setShowFilters] = createSignal(false);
  const [selectedItem, setSelectedItem] = createSignal<SelectedItem | null>(null);
  const [logPanelPod, setLogPanelPod] = createSignal<K8sPod | null>(null);
  const [showObservability, setShowObservability] = createSignal(false);
  const nodes = createMemo(() => k8sStore.nodes as unknown as K8sNode[]);
  const pods = createMemo(() => k8sStore.pods as unknown as K8sPod[]);
  const services = createMemo(() => k8sStore.services as unknown as K8sService[]);

  const {
    clearFilters,
    filter,
    handleSearchChange,
    hasActiveFilter,
    isStatusActive,
    namespaceList,
    nodeNameList,
    searchInput,
    setFilter,
    setSearchInput,
    toggleStatusFilter,
  } = useDashboardTopologyFilters({
    nodes,
    pods,
    showFilters,
    viewMode,
  });

  const {
    agentActivity,
    agentCardError,
    agentDataState,
    agentFeatureEnabled,
    cpuHistory,
    cpuPercent,
    inferenceCardError,
    inferenceDataState,
    inferenceFeatureEnabled,
    inferenceHealth,
    loomHUDPullEnabled,
    loomHUDPushEnabled,
    memHistory,
    memUsed,
    modelCardError,
    modelCount,
    modelDataState,
    resourceCardError,
    resourceDataState,
    resourceLoading,
    tpsHistory,
  } = useDashboardSummaryState({
    metricsRefreshInterval: METRICS_REFRESH_INTERVAL,
    staleAfterMs: DASHBOARD_STALE_AFTER_MS,
  });

  // Computed values from K8s store
  const podSummary = createMemo(() => {
    let ready = 0;
    const namespaces = new Set<string>();
    const currentPods = pods();

    for (const pod of currentPods) {
      if (pod.metadata?.namespace) {
        namespaces.add(pod.metadata.namespace);
      }
      if (
        pod.status?.phase === 'Running' ||
        (pod.status as any)?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
      ) {
        ready += 1;
      }
    }

    return {
      namespaces: namespaces.size,
      ready,
      total: currentPods.length,
    };
  });

  // Get pods on a specific node
  const podsOnSelectedNode = createMemo(() => {
    const item = selectedItem();
    if (!item || item.type !== 'node') return [];
    const nodeName = (item.data as K8sNode).metadata.name;
    return pods().filter(p => p.spec.nodeName === nodeName);
  });

  // Handle selection from HoloDeck
  const handleSelect = (item: { type: 'node' | 'pod' | 'service'; data: K8sNode | K8sPod | K8sService } | null) => {
    setSelectedItem(item);
  };

  const nodeSummary = createMemo(() => {
    let ready = 0;
    const currentNodes = nodes();
    for (const node of currentNodes) {
      if (isNodeReady(node as any)) {
        ready += 1;
      }
    }
    return {
      ready,
      total: currentNodes.length,
    };
  });

  const isLoading = createMemo(() =>
    k8sStore.lastUpdate === 0 && connectionStatus() !== 'error'
  );

  const k8sError = createMemo(() => k8sStore.error);
  const k8sDataState = createMemo(() =>
    resolveDashboardDataState({
      loading: isLoading(),
      error: connectionStatus() === 'error' ? 'offline' : k8sError(),
      lastUpdateMs: k8sStore.lastUpdate,
      staleAfterMs: DASHBOARD_STALE_AFTER_MS,
    }),
  );
  const k8sCardError = createMemo(() =>
    k8sDataState() === 'offline' ? (k8sError() || 'offline') : '',
  );

  onMount(() => {
    // Connect to K8s SSE stream for real-time updates
    connectK8sStream();

    // Start dashboard summary polling (server-side materialized resource metrics)
    startDashboardSummaryPolling();
  });

  onCleanup(() => {
    disconnectK8sStream();
    stopDashboardSummaryPolling();
  });

  return (
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto md:overflow-hidden p-2 sm:p-3 md:p-4">
      {/* Pulse Cards — Cluster */}
      <div class="space-y-3 min-w-0">
        <div class="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3 lg:grid-cols-4">
          <PulseCard
            title="Pods"
            value={`${podSummary().ready}/${podSummary().total}`}
            sub={`${podSummary().namespaces} namespaces`}
            loading={isLoading()}
            error={k8sCardError()}
            meta={dataStateLabel(k8sDataState())}
            icon="⬡"
          />

          <PulseCard
            title="Nodes"
            value={`${nodeSummary().ready}/${nodeSummary().total}`}
            sub="cluster nodes"
            loading={isLoading()}
            error={k8sCardError()}
            meta={dataStateLabel(k8sDataState())}
            icon="◈"
          />

          <PulseCard
            title="CPU"
            value={formatPercent(cpuPercent())}
            sub="cluster utilization"
            loading={resourceLoading()}
            error={resourceCardError()}
            meta={dataStateLabel(resourceDataState())}
            icon="⚡"
            sparkData={cpuHistory()}
            trend={cpuHistory().length >= 2 ? (cpuHistory()[cpuHistory().length - 1] > cpuHistory()[cpuHistory().length - 2] ? 'up' : 'down') : undefined}
          />

          <PulseCard
            title="Memory"
            value={formatBytes(memUsed())}
            sub="used across cluster"
            loading={resourceLoading()}
            error={resourceCardError()}
            meta={dataStateLabel(resourceDataState())}
            icon="◉"
            sparkData={memHistory()}
          />
        </div>

        {/* AI Operations */}
        <div class="border-t border-white/[0.12] pt-4">
          <div class="heading-section mb-2">AI Operations</div>
          <div class="grid grid-cols-1 min-[360px]:grid-cols-2 gap-3 lg:grid-cols-3">
            <PulseCard
              title="Models"
              value={`${modelCount().deployed}/${modelCount().total}`}
              sub="deployed models"
              loading={modelCount().loading}
              error={modelCardError()}
              meta={dataStateLabel(modelDataState())}
              icon="◆"
            />

            <PulseCard
              title="Inference"
              value={
                inferenceFeatureEnabled()
                  ? (inferenceHealth().totalTps > 0 ? `${inferenceHealth().totalTps.toFixed(1)}` : '0')
                  : '—'
              }
              sub={
                inferenceFeatureEnabled()
                  ? `${inferenceHealth().modelCount} models · queue ${inferenceHealth().queueDepth}`
                  : 'feature disabled'
              }
              loading={inferenceFeatureEnabled() ? inferenceHealth().loading : false}
              error={inferenceCardError()}
              meta={
                inferenceFeatureEnabled()
                  ? dataStateLabel(
                      inferenceDataState(),
                      inferenceDataState() === 'partial' && inferenceHealth().error
                        ? inferenceHealth().error
                        : undefined,
                    )
                  : dataStateLabel('disabled', 'feature disabled')
              }
              icon="⚡"
              color={inferenceFeatureEnabled() ? 'purple' : 'orange'}
              sparkData={inferenceFeatureEnabled() ? tpsHistory() : undefined}
              trend={
                inferenceFeatureEnabled() && tpsHistory().length >= 2
                  ? (tpsHistory()[tpsHistory().length - 1] > tpsHistory()[tpsHistory().length - 2] ? 'up' : 'down')
                  : undefined
              }
            />

            <PulseCard
              title="Agents"
              value={agentFeatureEnabled() ? `${agentActivity().activeAgents}` : '—'}
              sub={
                agentFeatureEnabled()
                  ? (loomHUDPullEnabled()
                    ? `${agentActivity().totalTasks} completed · ${agentActivity().pendingApprovals} approvals`
                    : `${agentActivity().totalTasks} sessions · push mode`)
                  : 'feature disabled'
              }
              loading={agentFeatureEnabled() ? agentActivity().loading : false}
              error={agentCardError()}
              meta={
                agentFeatureEnabled()
                  ? dataStateLabel(
                      agentDataState(),
                      loomHUDPushEnabled() && !loomHUDPullEnabled() ? 'push mode' : undefined,
                    )
                  : dataStateLabel('disabled', 'feature disabled')
              }
              icon="◎"
              color={agentFeatureEnabled() ? 'green' : 'orange'}
            />
          </div>
        </div>
      </div>

      {/* Main Content: Visualization + Events */}
      <div class="flex flex-1 flex-col lg:flex-row gap-4 overflow-visible lg:overflow-hidden min-h-0">
      {/* Visualization Panel */}
      <div class="surface flex-1 min-h-[400px] lg:min-h-0 overflow-hidden relative flex flex-col">
        {/* Controls */}
        <div class="absolute left-2 right-2 top-2 z-10 flex flex-col items-end gap-2 sm:left-auto sm:right-4 sm:top-4 sm:flex-row sm:items-center">
           {/* Connection status indicator */}
           <div class="flex max-w-full items-center gap-2 rounded-lg border border-white/10 bg-[#0a1020]/85 px-2.5 py-1 sm:px-3">
             <div class={`w-2 h-2 rounded-full ${
               connectionStatus() === 'connected' ? 'bg-status-ok animate-pulse' :
               connectionStatus() === 'connecting' ? 'bg-yellow-500 animate-pulse' :
               connectionStatus() === 'error' ? 'bg-red-500' :
               'bg-gray-500'
             }`} />
             <span class="text-[10px] sm:text-xs text-text-dim">
               {connectionStatus() === 'connected' ? 'LIVE' :
                connectionStatus() === 'connecting' ? 'CONNECTING' :
                connectionStatus() === 'error' ? 'OFFLINE' : 'DISCONNECTED'}
             </span>
           </div>

           {/* Filter toggle (only in 3D mode) */}
           <Show when={viewMode() === '3d'}>
             <button
               onClick={() => setShowFilters(!showFilters())}
               class={`rounded-lg border px-2.5 py-1 text-[11px] sm:text-xs font-mono transition-colors ${
                 hasActiveFilter()
                   ? 'bg-white/10 border-white/20 text-white'
                   : showFilters()
                   ? 'bg-black/40 border-white/20 text-text-main'
                   : 'bg-black/40 border-white/10 text-text-dim hover:text-text-main'
               }`}
             >
               FILTER {hasActiveFilter() ? '•' : ''}
             </button>
           </Show>

           <TabBar
             tabs={[
               { id: '2d', label: '2D' },
               { id: '3d', label: '3D' },
             ]}
             active={viewMode()}
             onChange={setViewMode}
             size="sm"
           />
        </div>

        {/* Mobile Observability Toggle */}
        <button
          onClick={() => setShowObservability(true)}
          class="lg:hidden absolute left-4 z-10 flex items-center gap-2 px-4 py-2 rounded-full bg-bg-dark/90 border border-white/10 text-text-dim shadow-lg"
          style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          <span class="text-lg">◈</span>
          <span class="text-[10px] font-medium uppercase tracking-wide">Events</span>
        </button>

        {/* Filter Panel */}
        <Show when={viewMode() === '3d' && showFilters()}>
          <div class="absolute left-2 right-2 top-[92px] sm:left-4 sm:right-auto sm:top-4 z-10 rounded-lg border border-white/10 bg-[#0a1020]/90 p-3 min-w-0 sm:min-w-[240px] sm:w-auto">
            <div class="flex items-center justify-between mb-3">
              <span class="text-xs font-mono text-text-main uppercase tracking-wider">Filters</span>
              <Show when={hasActiveFilter()}>
                <button
                  onClick={clearFilters}
                  class="text-[10px] text-text-dim hover:text-white transition-colors"
                >
                  Clear All
                </button>
              </Show>
            </div>

            {/* Search Input */}
            <div class="mb-3">
              <label class="block text-[10px] text-text-dim mb-1 uppercase">Search</label>
              <div class="relative">
                <input
                  type="text"
                  placeholder="Pod or namespace name..."
                  value={searchInput()}
                  onInput={(e) => handleSearchChange(e.currentTarget.value)}
                  class="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-text-main placeholder:text-text-dim/50 focus:border-white/20 focus:outline-none pr-6"
                />
                <Show when={searchInput()}>
                  <button
                    onClick={() => { setSearchInput(''); handleSearchChange(''); }}
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-main"
                  >
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </Show>
              </div>
            </div>

            {/* Quick Status Chips */}
            <div class="mb-3">
              <label class="block text-[10px] text-text-dim mb-1.5 uppercase">Quick Filters</label>
              <div class="flex flex-wrap gap-1.5">
                <button
                  onClick={() => toggleStatusFilter('Running')}
                  class={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                    isStatusActive('Running')
                      ? 'bg-status-ok/20 border-status-ok/50 text-status-ok'
                      : 'bg-black/20 border-white/10 text-text-dim hover:text-text-main hover:border-white/20'
                  }`}
                >
                  Running
                </button>
                <button
                  onClick={() => toggleStatusFilter('Pending')}
                  class={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                    isStatusActive('Pending')
                      ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-500'
                      : 'bg-black/20 border-white/10 text-text-dim hover:text-text-main hover:border-white/20'
                  }`}
                >
                  Pending
                </button>
                <button
                  onClick={() => toggleStatusFilter('Failed')}
                  class={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                    isStatusActive('Failed')
                      ? 'bg-red-500/20 border-red-500/50 text-red-500'
                      : 'bg-black/20 border-white/10 text-text-dim hover:text-text-main hover:border-white/20'
                  }`}
                >
                  Failed
                </button>
              </div>
            </div>

            {/* Namespace Filter */}
            <div class="mb-3">
              <label class="block text-[10px] text-text-dim mb-1 uppercase">Namespace</label>
              <select
                value={filter().namespace || ''}
                onChange={(e) => setFilter({ ...filter(), namespace: e.currentTarget.value || undefined })}
                class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-text-main focus:border-white/20 focus:outline-none"
              >
                <option value="">All Namespaces</option>
                <For each={namespaceList()}>
                  {ns => <option value={ns}>{ns}</option>}
                </For>
              </select>
            </div>

            {/* Node Filter */}
            <div>
              <label class="block text-[10px] text-text-dim mb-1 uppercase">Node</label>
              <select
                value={filter().nodeName || ''}
                onChange={(e) => setFilter({ ...filter(), nodeName: e.currentTarget.value || undefined })}
                class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-text-main focus:border-white/20 focus:outline-none"
              >
                <option value="">All Nodes</option>
                <For each={nodeNameList()}>
                  {name => <option value={name}>{name}</option>}
                </For>
              </select>
            </div>
          </div>
        </Show>

        <Show
          when={nodes().length > 0 || pods().length > 0}
          fallback={
            isLoading()
              ? <LoadingState message="Loading cluster data..." />
              : <div class="flex h-full items-center justify-center">
                  <div class="text-center">
                    <div class="mb-4 text-6xl text-text-muted/30">⬡</div>
                    <h3 class="mb-2 text-lg font-semibold text-text-main">Cluster Topology</h3>
                    <p class="text-sm text-text-muted">No resources found</p>
                  </div>
                </div>
          }
        >
          <Show when={viewMode() === '2d'} fallback={
              <HoloDeck
                nodes={nodes()}
                pods={pods()}
                services={services()}
                topologyVersion={k8sStore.topologyVersion}
                styleVersion={k8sStore.styleVersion}
                filter={filter()}
                onSelect={handleSelect}
              />
          }>
            <TopologyGraph
                nodes={nodes()}
                pods={pods()}
                services={services()}
                topologyVersion={k8sStore.topologyVersion}
                styleVersion={k8sStore.styleVersion}
            />
          </Show>
        </Show>

        <Show when={k8sStore.lastUpdate > 0}>
          <div class="absolute bottom-2 right-2 text-xs text-text-dim z-10 pointer-events-none">
            Updated: {new Date(k8sStore.lastUpdate).toLocaleTimeString()}
          </div>
        </Show>

        {/* Detail Panel - Refactored to shared component */}
        <Show when={selectedItem()}>
          {item => (
            <DetailPanel
              title={item().type === 'node' ? (item().data as K8sNode).metadata.name : (item().data as K8sPod).metadata.name}
              subtitle={item().type === 'node' ? 'Cluster Node' : `Pod in ${(item().data as K8sPod).metadata.namespace}`}
              status={item().type === 'node' 
                ? (isNodeReady(item().data as any) ? 'ok' : 'error')
                : ((item().data as K8sPod).status.phase === 'Running' ? 'running' : (item().data as K8sPod).status.phase === 'Pending' ? 'warn' : 'error')
              }
              onClose={() => setSelectedItem(null)}
              actions={[
                ...(item().type === 'pod' ? [{
                  label: 'View Logs',
                  variant: 'primary' as const,
                  onClick: () => setLogPanelPod(item().data as K8sPod)
                }] : []),
                {
                  label: `Filter to ${item().type === 'node' ? 'Node' : 'Namespace'}`,
                  onClick: () => {
                    if (item().type === 'node') {
                      setFilter({ ...filter(), nodeName: (item().data as K8sNode).metadata.name });
                    } else {
                      setFilter({ ...filter(), namespace: (item().data as K8sPod).metadata.namespace });
                    }
                    setShowFilters(true);
                  }
                }
              ]}
            >
              {/* Specialized Content Grid based on type */}
              <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Show when={item().type === 'node'}>
                  {/* Node Specifics */}
                  <div>
                    <h4 class="text-[10px] text-text-dim uppercase mb-3 font-bold tracking-widest">Resource Usage</h4>
                    <div class="space-y-4">
                      {/* CPU Usage Bar */}
                      {(() => {
                        const metrics = getNodeMetrics((item().data as K8sNode).metadata.name);
                        const cpuUsage = metrics?.cpuUsage || 0;
                        return (
                          <div>
                            <div class="flex justify-between text-xs mb-1.5">
                              <span class="text-text-muted">CPU</span>
                              <span class="font-mono" style={{ color: getUsageColor(cpuUsage) }}>{cpuUsage.toFixed(1)}%</span>
                            </div>
                            <div class="h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div class="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.min(cpuUsage, 100)}%`, background: getUsageGradient(cpuUsage) }} />
                            </div>
                          </div>
                        );
                      })()}
                      {/* Memory Usage Bar */}
                      {(() => {
                        const metrics = getNodeMetrics((item().data as K8sNode).metadata.name);
                        const memPercent = metrics?.memoryPercent || 0;
                        return (
                          <div>
                            <div class="flex justify-between text-xs mb-1.5">
                              <span class="text-text-muted">Memory</span>
                              <span class="font-mono" style={{ color: getUsageColor(memPercent) }}>{formatBytes(metrics?.memoryUsed || 0)} / {formatBytes(metrics?.memoryLimit || 0)}</span>
                            </div>
                            <div class="h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div class="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.min(memPercent, 100)}%`, background: getUsageGradient(memPercent) }} />
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  <div>
                    <h4 class="text-[10px] text-text-dim uppercase mb-3 font-bold tracking-widest">Conditions</h4>
                    <div class="space-y-2">
                      <For each={(item().data as K8sNode).status?.conditions || []}>
                        {condition => (
                          <div class="flex items-center gap-2 text-xs">
                            <span class={`w-1.5 h-1.5 rounded-full ${condition.status === 'True' ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span class="text-text-muted">{condition.type}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                  <div>
                    <h4 class="text-[10px] text-text-dim uppercase mb-3 font-bold tracking-widest">Pods ({podsOnSelectedNode().length})</h4>
                    <div class="max-h-32 overflow-y-auto space-y-1.5 pr-2 custom-scrollbar">
                      <For each={podsOnSelectedNode().slice(0, 20)}>
                        {p => (
                          <div class="flex items-center gap-2 text-[11px]">
                            <span class={`w-1.5 h-1.5 rounded-full ${p.status.phase === 'Running' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                            <span class="text-text-muted truncate font-mono">{p.metadata.name}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={item().type === 'pod'}>
                  {/* Pod Specifics */}
                  <div>
                    <h4 class="text-[10px] text-text-dim uppercase mb-3 font-bold tracking-widest">Pod Metrics</h4>
                    {(() => {
                      const metrics = getPodMetrics((item().data as K8sPod).metadata.namespace || 'default', (item().data as K8sPod).metadata.name);
                      const cpuUsage = metrics?.cpuUsage || 0;
                      const memPercent = metrics?.memoryPercent || 0;
                      return (
                        <div class="space-y-4">
                          <div>
                            <div class="flex justify-between text-xs mb-1.5">
                              <span class="text-text-muted">CPU Usage</span>
                              <span class="font-mono" style={{ color: getUsageColor(cpuUsage) }}>{cpuUsage.toFixed(1)}%</span>
                            </div>
                            <div class="h-1 bg-white/10 rounded-full overflow-hidden">
                              <div class="h-full transition-[width] duration-300" style={{ width: `${Math.min(cpuUsage, 100)}%`, background: getUsageGradient(cpuUsage) }} />
                            </div>
                          </div>
                          <div>
                            <div class="flex justify-between text-xs mb-1.5">
                              <span class="text-text-muted">Memory</span>
                              <span class="font-mono" style={{ color: getUsageColor(memPercent) }}>{formatBytes(metrics?.memoryUsed || 0)}</span>
                            </div>
                            <div class="h-1 bg-white/10 rounded-full overflow-hidden">
                              <div class="h-full transition-[width] duration-300" style={{ width: `${Math.min(memPercent, 100)}%`, background: getUsageGradient(memPercent) }} />
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div>
                    <h4 class="text-[10px] text-text-dim uppercase mb-3 font-bold tracking-widest">Containers</h4>
                    <div class="space-y-2">
                      <For each={(item().data as K8sPod).spec.containers || []}>
                        {container => {
                          const cs = () => (item().data as K8sPod).status.containerStatuses?.find(s => s.name === container.name);
                          return (
                            <div class="flex items-center gap-2 text-[11px]">
                              <span class={`w-1.5 h-1.5 rounded-full ${cs()?.ready ? 'bg-green-500' : 'bg-red-500'}`} />
                              <span class="text-text-muted font-mono">{container.name}</span>
                              <Show when={cs()?.restartCount}><span class="text-[10px] text-yellow-500">({cs()?.restartCount}R)</span></Show>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                  <div>
                    <h4 class="text-[10px] text-text-dim uppercase mb-3 font-bold tracking-widest">Labels</h4>
                    <div class="flex flex-wrap gap-1.5">
                      <For each={Object.entries((item().data as K8sPod).metadata.labels || {}).slice(0, 8)}>
                        {([k, v]) => (
                          <span class="px-2 py-0.5 rounded bg-white/5 border border-white/5 text-[10px] text-text-muted font-mono truncate max-w-[120px]" title={`${k}=${v}`}>{k}</span>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </DetailPanel>
          )}
        </Show>
      </div>

      {/* Observability Sidebar / Mobile Sheet */}
      <div class={`
        fixed lg:relative inset-0 lg:inset-auto z-50 lg:z-0 flex flex-col lg:w-80 flex-shrink-0 transition-transform duration-300
        ${showObservability() ? 'translate-y-0' : 'translate-y-full lg:translate-y-0'}
      `}>
        {/* Backdrop (mobile only) */}
        <div 
          class="absolute inset-0 bg-black/60 backdrop-blur-sm lg:hidden" 
          onClick={() => setShowObservability(false)}
        />
        
        {/* Sidebar Content */}
        <div class="relative mt-auto lg:mt-0 h-[85vh] lg:h-full w-full bg-bg-dark lg:bg-transparent border-t border-white/[0.08] lg:border-t-0 flex flex-col gap-3 p-4 lg:p-0 overflow-y-auto shadow-2xl lg:shadow-none">
          {/* Mobile Header */}
          <div class="flex lg:hidden items-center justify-between mb-2 pb-2 border-b border-white/5">
            <div class="flex items-center gap-2">
              <div class="w-2 h-2 rounded-full bg-white/40" />
              <span class="heading-label">Observability</span>
            </div>
            <button 
              onClick={() => setShowObservability(false)}
              class="h-8 w-8 flex items-center justify-center rounded-full bg-white/5 border border-white/10 text-text-dim"
            >
              ✕
            </button>
          </div>
          
          <AlertsPanel />
          <NodeResourcePanel />
          <EventsFeed />
          <LangfuseWidget />
        </div>
      </div>
      </div> {/* End Main Content */}

      {/* Pod Log Panel */}
      <Show when={logPanelPod()}>
        {(pod) => (
          <PodLogPanel
            podName={pod().metadata.name}
            namespace={pod().metadata.namespace || 'default'}
            onClose={() => setLogPanelPod(null)}
          />
        )}
      </Show>
    </div>
  );
};

export default Dashboard;
