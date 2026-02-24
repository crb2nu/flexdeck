import { Component, createSignal, createMemo, createEffect, onMount, onCleanup, Show, For } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { PulseCard } from '../shared';
import { healthStore } from '../../stores/health';
import { k8sStore, connectK8sStream, disconnectK8sStream, connectionStatus, isNodeReady } from '../../stores/k8s';
import { metricsStore, startMetricsPolling, stopMetricsPolling, getNodeMetrics, getPodMetrics, getUsageColor, getUsageGradient } from '../../stores/metrics';
import { modelsApi, flexinferProxyApi, hudApi, agentsApi } from '../../lib/api';
import { formatBytes, formatPercent } from '../../lib/format';
import type { FlexInferProxyMetricsResponse, K8sNode, K8sPod, K8sService } from '../../lib/types';
import TopologyGraph from './TopologyGraph';
import HoloDeck, { type HoloDeckFilter } from './HoloDeck';
import PodLogPanel from './PodLogPanel';
import EventsFeed from './EventsFeed';
import AlertsPanel from './AlertsPanel';
import LangfuseWidget from './LangfuseWidget';
import { buildInferenceHealthSummary } from './inferenceHealth';

const METRICS_REFRESH_INTERVAL = 30000; // 30 seconds for Prometheus metrics

interface SelectedItem {
  type: 'node' | 'pod' | 'service';
  data: K8sNode | K8sPod | K8sService;
}

const Dashboard: Component = () => {
  const [viewMode, setViewMode] = createSignal<'2d' | '3d'>('2d');
  const [filter, setFilter] = createSignal<HoloDeckFilter>({});
  const [showFilters, setShowFilters] = createSignal(false);
  const [selectedItem, setSelectedItem] = createSignal<SelectedItem | null>(null);
  const [logPanelPod, setLogPanelPod] = createSignal<K8sPod | null>(null);
  const [searchInput, setSearchInput] = createSignal('');

  let searchDebounceTimer: ReturnType<typeof setTimeout>;

  // Debounced search update
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      setFilter({ ...filter(), searchTerm: value || undefined });
    }, 300);
  };

  // Quick filter helpers
  const toggleStatusFilter = (status: string) => {
    const current = filter().status || [];
    if (current.includes(status)) {
      const newStatus = current.filter(s => s !== status);
      setFilter({ ...filter(), status: newStatus.length > 0 ? newStatus : undefined });
    } else {
      setFilter({ ...filter(), status: [...current, status] });
    }
  };

  const isStatusActive = (status: string) => filter().status?.includes(status) || false;

  // Resource pulse state
  const cpuPercent = () => metricsStore().clusterCpu;
  const memUsed = () => metricsStore().clusterMemory;
  const resourceLoading = () => metricsStore().loading;
  const resourceError = () => metricsStore().error || '';

  // Rolling history for sparklines
  const [cpuHistory, setCpuHistory] = createSignal<number[]>([]);
  const [memHistory, setMemHistory] = createSignal<number[]>([]);

  createEffect(() => {
    const cpu = cpuPercent();
    const mem = memUsed();
    if (cpu > 0) setCpuHistory(prev => [...prev.slice(-19), cpu]);
    if (mem > 0) setMemHistory(prev => [...prev.slice(-19), mem]);
  });

  // AI Models state
  const [modelCount, setModelCount] = createSignal({ deployed: 0, total: 0, loading: true, error: '' });

  const fetchModelCount = async () => {
    try {
      const result = await modelsApi.list();
      const models = result?.models || [];
      const deployed = models.filter((m: { deployment_status?: string }) => m.deployment_status === 'deployed').length;
      setModelCount({ deployed, total: models.length, loading: false, error: '' });
    } catch {
      setModelCount(prev => ({ ...prev, loading: false, error: 'offline' }));
    }
  };

  // Inference Health state (feature-gated: flexinfer_proxy)
  const [inferenceHealth, setInferenceHealth] = createSignal({
    totalTps: 0, modelCount: 0, queueDepth: 0, loading: true, error: '',
  });
  const [tpsHistory, setTpsHistory] = createSignal<number[]>([]);

  const fetchInferenceHealth = async () => {
    if (!healthStore.features.flexinfer_proxy?.enabled) return;
    try {
      const data: FlexInferProxyMetricsResponse = await flexinferProxyApi.metrics();
      const summary = buildInferenceHealthSummary(data);

      setInferenceHealth({
        totalTps: summary.totalTps,
        modelCount: summary.modelCount,
        queueDepth: summary.queueDepth,
        loading: false,
        error: summary.error,
      });
      if (summary.totalTps > 0) setTpsHistory(prev => [...prev.slice(-19), summary.totalTps]);
    } catch {
      setInferenceHealth(prev => ({ ...prev, loading: false, error: 'offline' }));
    }
  };

  // Agent Activity state (feature-gated: loom_hud)
  const [agentActivity, setAgentActivity] = createSignal({
    activeAgents: 0, totalTasks: 0, pendingApprovals: 0, loading: true, error: '',
  });
  const loomHUDPullEnabled = () => healthStore.features.loom_hud?.enabled ?? false;
  const loomHUDPushEnabled = () => healthStore.features.loom_hud_push?.enabled ?? false;
  const loomHUDAvailable = () => loomHUDPullEnabled() || loomHUDPushEnabled();

  const fetchAgentActivity = async () => {
    if (!loomHUDAvailable()) return;
    try {
      if (loomHUDPullEnabled()) {
        const data = await hudApi.fleet();
        const agents = data?.agents || [];
        const tasks = data?.tasks || [];
        const activeAgents = agents.filter((a: any) => a.status === 'active').length;
        const completedTasks = tasks.filter((t: any) => t.status === 'completed').length;
        const pendingApprovals = data?.kpis?.pending_approvals || 0;
        setAgentActivity({
          activeAgents,
          totalTasks: completedTasks,
          pendingApprovals,
          loading: false,
          error: '',
        });
        return;
      }

      const list = await agentsApi.list();
      const allAgents = list?.agents || [];
      const hudAgents = allAgents.filter((a: any) => a?.metadata?.source === 'hud' || a?.type === 'cli-agent');
      const activeAgents = hudAgents.filter((a: any) => {
        const presenceStatus = a?.metadata?.presence_status;
        if (presenceStatus === 'active') return true;
        if (presenceStatus === 'idle' || presenceStatus === 'offline') return false;
        return a?.status === 'healthy';
      }).length;
      const sessionsSeen = hudAgents.reduce((sum: number, a: any) => {
        const count = Number(a?.metadata?.session_count || 0);
        return Number.isFinite(count) ? sum + count : sum;
      }, 0);
      setAgentActivity({
        activeAgents,
        totalTasks: sessionsSeen,
        pendingApprovals: 0,
        loading: false,
        error: '',
      });
    } catch {
      setAgentActivity(prev => ({ ...prev, loading: false, error: 'offline' }));
    }
  };

  createEffect(() => {
    if (loomHUDAvailable()) {
      fetchAgentActivity();
    }
  });

  // Register polling tasks
  createPolling('dash-models', fetchModelCount, METRICS_REFRESH_INTERVAL);
  createPolling('dash-inference', fetchInferenceHealth, METRICS_REFRESH_INTERVAL, () => healthStore.features.flexinfer_proxy?.enabled ?? false);
  createPolling('dash-agents', fetchAgentActivity, METRICS_REFRESH_INTERVAL, loomHUDAvailable);

  // Computed values from K8s store
  const podReady = createMemo(() =>
    k8sStore.pods.filter(p =>
      p.status?.phase === 'Running' ||
      (p.status as any)?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
    ).length
  );

  const podTotal = createMemo(() => k8sStore.pods.length);

  const podNamespaces = createMemo(() =>
    new Set(k8sStore.pods.map(p => p.metadata?.namespace)).size
  );

  // For filter dropdowns
  const namespaceList = createMemo(() =>
    [...new Set(k8sStore.pods.map(p => p.metadata?.namespace).filter(Boolean))].sort() as string[]
  );

  const nodeNameList = createMemo(() =>
    k8sStore.nodes.map(n => n.metadata?.name).filter(Boolean).sort() as string[]
  );

  const hasActiveFilter = createMemo(() => {
    const activeFilter = filter();
    return Boolean(
      activeFilter.namespace ||
        (activeFilter.status?.length ?? 0) > 0 ||
        activeFilter.nodeName ||
        activeFilter.searchTerm
    );
  });

  const clearFilters = () => {
    setFilter({});
    setSearchInput('');
  };

  // Get pods on a specific node
  const getPodsOnNode = createMemo(() => {
    const item = selectedItem();
    if (!item || item.type !== 'node') return [];
    const nodeName = (item.data as K8sNode).metadata.name;
    return pods().filter(p => p.spec.nodeName === nodeName);
  });

  // Handle selection from HoloDeck
  const handleSelect = (item: { type: 'node' | 'pod' | 'service'; data: K8sNode | K8sPod | K8sService } | null) => {
    setSelectedItem(item);
  };

  const nodeReady = createMemo(() =>
    k8sStore.nodes.filter(n => isNodeReady(n as any)).length
  );

  const nodeTotal = createMemo(() => k8sStore.nodes.length);

  const isLoading = createMemo(() =>
    k8sStore.lastUpdate === 0 && connectionStatus() !== 'error'
  );

  const k8sError = createMemo(() => k8sStore.error);

  // Adapt store data to component types
  const nodes = createMemo(() => k8sStore.nodes as unknown as K8sNode[]);
  const pods = createMemo(() => k8sStore.pods as unknown as K8sPod[]);
  const services = createMemo(() => k8sStore.services as unknown as K8sService[]);



  onMount(() => {
    // Connect to K8s SSE stream for real-time updates
    connectK8sStream();

    // Start metrics polling (for node/pod resource metrics)
    startMetricsPolling();
  });

  onCleanup(() => {
    disconnectK8sStream();
    stopMetricsPolling();
  });

  return (
    <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto md:overflow-hidden p-2 sm:p-4">
      {/* Pulse Cards Grid */}
      <div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        <PulseCard
          title="Pods"
          value={`${podReady()}/${podTotal()}`}
          sub={`${podNamespaces()} namespaces`}
          loading={isLoading()}
          error={k8sError() || ''}
          icon="⬡"
        />

        <PulseCard
          title="Nodes"
          value={`${nodeReady()}/${nodeTotal()}`}
          sub="cluster nodes"
          loading={isLoading()}
          error={k8sError() || ''}
          icon="◈"
        />

        <PulseCard
          title="CPU"
          value={formatPercent(cpuPercent())}
          sub="cluster utilization"
          loading={resourceLoading()}
          error={resourceError()}
          icon="⚡"
          sparkData={cpuHistory()}
          trend={cpuHistory().length >= 2 ? (cpuHistory()[cpuHistory().length - 1] > cpuHistory()[cpuHistory().length - 2] ? 'up' : 'down') : undefined}
        />

        <PulseCard
          title="Memory"
          value={formatBytes(memUsed())}
          sub="used across cluster"
          loading={resourceLoading()}
          error={resourceError()}
          icon="◉"
          sparkData={memHistory()}
        />

        <PulseCard
          title="AI Models"
          value={`${modelCount().deployed}/${modelCount().total}`}
          sub="deployed models"
          loading={modelCount().loading}
          error={modelCount().error}
          icon="◆"
        />

        <Show when={healthStore.features.flexinfer_proxy?.enabled}>
          <PulseCard
            title="Inference"
            value={inferenceHealth().totalTps > 0 ? `${inferenceHealth().totalTps.toFixed(1)}` : '0'}
            sub={`${inferenceHealth().modelCount} models · queue ${inferenceHealth().queueDepth}`}
            loading={inferenceHealth().loading}
            error={inferenceHealth().error}
            icon="⚡"
            color="purple"
            sparkData={tpsHistory()}
            trend={tpsHistory().length >= 2 ? (tpsHistory()[tpsHistory().length - 1] > tpsHistory()[tpsHistory().length - 2] ? 'up' : 'down') : undefined}
          />
        </Show>

        <Show when={loomHUDAvailable()}>
          <PulseCard
            title="Agents"
            value={`${agentActivity().activeAgents}`}
            sub={
              loomHUDPullEnabled()
                ? `${agentActivity().totalTasks} completed · ${agentActivity().pendingApprovals} approvals`
                : `${agentActivity().totalTasks} sessions observed · push mode`
            }
            loading={agentActivity().loading}
            error={agentActivity().error}
            icon="◎"
            color="green"
          />
        </Show>
      </div>

      {/* Main Content: Visualization + Events */}
      <div class="flex flex-1 flex-col lg:flex-row gap-4 overflow-visible lg:overflow-hidden min-h-0">
      {/* Visualization Panel */}
      <div class="glass-panel flex-1 min-h-[400px] lg:min-h-0 overflow-hidden relative flex flex-col">
        {/* Controls */}
        <div class="absolute right-4 top-4 z-10 flex flex-col sm:flex-row gap-2">
           {/* Connection status indicator */}
           <div class="flex items-center gap-2 px-3 py-1 rounded-lg bg-black/40 border border-white/10 backdrop-blur">
             <div class={`w-2 h-2 rounded-full ${
               connectionStatus() === 'connected' ? 'bg-neon-green animate-pulse' :
               connectionStatus() === 'connecting' ? 'bg-yellow-500 animate-pulse' :
               connectionStatus() === 'error' ? 'bg-red-500' :
               'bg-gray-500'
             }`} />
             <span class="text-[10px] font-mono uppercase text-text-dim">
               {connectionStatus() === 'connected' ? 'LIVE' :
                connectionStatus() === 'connecting' ? 'CONNECTING' :
                connectionStatus() === 'error' ? 'OFFLINE' : 'DISCONNECTED'}
             </span>
           </div>

           {/* Filter toggle (only in 3D mode) */}
           <Show when={viewMode() === '3d'}>
             <button
               onClick={() => setShowFilters(!showFilters())}
               class={`px-3 py-1 text-xs font-mono rounded-lg transition-colors backdrop-blur border ${
                 hasActiveFilter()
                   ? 'bg-neon-purple/20 border-neon-purple/50 text-neon-purple'
                   : showFilters()
                   ? 'bg-black/40 border-white/20 text-text-main'
                   : 'bg-black/40 border-white/10 text-text-dim hover:text-text-main'
               }`}
             >
               FILTER {hasActiveFilter() ? '•' : ''}
             </button>
           </Show>

           <div class="p-1 rounded-lg bg-black/40 border border-white/10 backdrop-blur flex">
               <button
                onClick={() => setViewMode('2d')}
                class={`px-3 py-1 text-xs font-mono rounded transition-colors ${viewMode() === '2d' ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-text-dim hover:text-text-main'}`}
               >
                   2D
               </button>
               <button
                onClick={() => setViewMode('3d')}
                class={`px-3 py-1 text-xs font-mono rounded transition-colors ${viewMode() === '3d' ? 'bg-neon-purple/20 text-neon-purple' : 'text-text-dim hover:text-text-main'}`}
               >
                   3D
               </button>
           </div>
        </div>

        {/* Filter Panel */}
        <Show when={viewMode() === '3d' && showFilters()}>
          <div class="absolute left-4 top-4 z-10 p-3 rounded-lg bg-black/60 border border-white/10 backdrop-blur min-w-[240px]">
            <div class="flex items-center justify-between mb-3">
              <span class="text-xs font-mono text-text-main uppercase tracking-wider">Filters</span>
              <Show when={hasActiveFilter()}>
                <button
                  onClick={clearFilters}
                  class="text-[10px] text-neon-cyan hover:text-neon-cyan/80 transition-colors"
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
                  class="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs text-text-main placeholder:text-text-dim/50 focus:border-neon-cyan/50 focus:outline-none pr-6"
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
                      ? 'bg-neon-green/20 border-neon-green/50 text-neon-green'
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
                class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-text-main focus:border-neon-cyan/50 focus:outline-none"
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
                class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-text-main focus:border-neon-cyan/50 focus:outline-none"
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
            <div class="flex h-full items-center justify-center">
              <div class="text-center">
                <div class="mb-4 text-6xl text-neon-cyan/30 animate-pulse">⬡</div>
                <h3 class="mb-2 text-lg font-semibold text-text-main">Cluster Topology</h3>
                <p class="text-sm text-text-muted">
                  {isLoading() ? 'Loading cluster data...' : 'No resources found'}
                </p>
              </div>
            </div>
          }
        >
          <Show when={viewMode() === '2d'} fallback={
              <HoloDeck nodes={nodes()} pods={pods()} services={services()} filter={filter()} onSelect={handleSelect} />
          }>
            <TopologyGraph
                nodes={nodes()}
                pods={pods()}
                services={services()}
            />
          </Show>
        </Show>

        <Show when={k8sStore.lastUpdate > 0}>
          <div class="absolute bottom-2 right-2 text-xs text-text-dim z-10 pointer-events-none">
            Updated: {new Date(k8sStore.lastUpdate).toLocaleTimeString()}
          </div>
        </Show>

        {/* Detail Panel - Slides up when item selected */}
        <Show when={selectedItem()}>
          {item => {
            const isNode = () => item().type === 'node';
            const node = () => isNode() ? item().data as K8sNode : null;
            const pod = () => !isNode() ? item().data as K8sPod : null;

            return (
              <div class="absolute bottom-0 left-0 right-0 z-20 transform transition-transform duration-300 ease-out"
                   style={{ transform: 'translateY(0)' }}>
                <div class="bg-black/80 backdrop-blur-md border-t border-white/10 p-4">
                  {/* Header */}
                  <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-3">
                      <div class={`h-2 w-2 rounded-full ${isNode() ? 'bg-neon-cyan' : 'bg-neon-green'}`} />
                      <div>
                        <h3 class="text-sm font-semibold text-text-main font-mono">
                          {isNode() ? node()?.metadata.name : pod()?.metadata.name}
                        </h3>
                        <p class="text-[10px] text-text-dim uppercase tracking-wider">
                          {isNode() ? 'Cluster Node' : `Pod in ${pod()?.metadata.namespace}`}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedItem(null)}
                      class="text-text-dim hover:text-text-main transition-colors p-1"
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Content Grid */}
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Node Details */}
                    <Show when={isNode() && node()}>
                      {n => (
                        <>
                          {/* Status Section */}
                          <div>
                            <h4 class="text-[10px] text-text-dim uppercase mb-2">Status</h4>
                            <div class="space-y-1">
                              <For each={n().status?.conditions || []}>
                                {condition => (
                                  <div class="flex items-center gap-2 text-xs">
                                    <span class={`w-1.5 h-1.5 rounded-full ${
                                      condition.status === 'True' ? 'bg-green-500' : 'bg-red-500'
                                    }`} />
                                    <span class="text-text-muted">{condition.type}</span>
                                  </div>
                                )}
                              </For>
                            </div>
                          </div>

                          {/* Resources Section with Usage Meters */}
                          <div>
                            <h4 class="text-[10px] text-text-dim uppercase mb-2">Resource Usage</h4>
                            <div class="space-y-3">
                              {/* CPU Usage Bar */}
                              {(() => {
                                const metrics = getNodeMetrics(n().metadata.name);
                                const cpuUsage = metrics?.cpuUsage || 0;
                                return (
                                  <div>
                                    <div class="flex justify-between text-xs mb-1">
                                      <span class="text-text-muted">CPU</span>
                                      <span class="font-mono" style={{ color: getUsageColor(cpuUsage) }}>
                                        {cpuUsage.toFixed(1)}%
                                      </span>
                                    </div>
                                    <div class="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                      <div
                                        class="h-full rounded-full transition-all duration-500"
                                        style={{
                                          width: `${Math.min(cpuUsage, 100)}%`,
                                          background: getUsageGradient(cpuUsage)
                                        }}
                                      />
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Memory Usage Bar */}
                              {(() => {
                                const metrics = getNodeMetrics(n().metadata.name);
                                const memPercent = metrics?.memoryPercent || 0;
                                const memUsed = metrics?.memoryUsed || 0;
                                const memLimit = metrics?.memoryLimit || 0;
                                return (
                                  <div>
                                    <div class="flex justify-between text-xs mb-1">
                                      <span class="text-text-muted">Memory</span>
                                      <span class="font-mono" style={{ color: getUsageColor(memPercent) }}>
                                        {formatBytes(memUsed)} / {formatBytes(memLimit)}
                                      </span>
                                    </div>
                                    <div class="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                      <div
                                        class="h-full rounded-full transition-all duration-500"
                                        style={{
                                          width: `${Math.min(memPercent, 100)}%`,
                                          background: getUsageGradient(memPercent)
                                        }}
                                      />
                                    </div>
                                  </div>
                                );
                              })()}

                              {/* Capacity Info */}
                              <div class="pt-2 border-t border-white/5 space-y-1 text-xs">
                                <Show when={n().status?.capacity?.cpu}>
                                  <div class="flex justify-between">
                                    <span class="text-text-muted">CPU Capacity</span>
                                    <span class="text-text-main font-mono">{n().status?.capacity?.cpu}</span>
                                  </div>
                                </Show>
                                <Show when={n().status?.capacity?.pods}>
                                  <div class="flex justify-between">
                                    <span class="text-text-muted">Max Pods</span>
                                    <span class="text-text-main font-mono">{n().status?.capacity?.pods}</span>
                                  </div>
                                </Show>
                              </div>
                            </div>
                          </div>

                          {/* Pods on Node */}
                          <div>
                            <h4 class="text-[10px] text-text-dim uppercase mb-2">
                              Pods ({getPodsOnNode().length})
                            </h4>
                            <div class="max-h-24 overflow-y-auto space-y-1">
                              <For each={getPodsOnNode().slice(0, 10)}>
                                {p => (
                                  <div class="flex items-center gap-2 text-xs">
                                    <span class={`w-1.5 h-1.5 rounded-full ${
                                      p.status.phase === 'Running' ? 'bg-green-500' :
                                      p.status.phase === 'Pending' ? 'bg-yellow-500' : 'bg-red-500'
                                    }`} />
                                    <span class="text-text-muted truncate">{p.metadata.name}</span>
                                  </div>
                                )}
                              </For>
                              <Show when={getPodsOnNode().length > 10}>
                                <div class="text-[10px] text-text-dim">
                                  +{getPodsOnNode().length - 10} more
                                </div>
                              </Show>
                            </div>
                          </div>
                        </>
                      )}
                    </Show>

                    {/* Pod Details */}
                    <Show when={!isNode() && pod()}>
                      {p => (
                        <>
                          {/* Status Section */}
                          <div>
                            <h4 class="text-[10px] text-text-dim uppercase mb-2">Status</h4>
                            <div class="space-y-2">
                              <div class="flex items-center gap-2">
                                <span class={`px-2 py-0.5 rounded text-xs ${
                                  p().status.phase === 'Running' ? 'bg-green-500/20 text-green-400' :
                                  p().status.phase === 'Pending' ? 'bg-yellow-500/20 text-yellow-400' :
                                  'bg-red-500/20 text-red-400'
                                }`}>
                                  {p().status.phase}
                                </span>
                              </div>
                              <div class="text-xs">
                                <span class="text-text-muted">Node: </span>
                                <span class="text-text-main font-mono">{p().spec.nodeName || 'Unassigned'}</span>
                              </div>
                            </div>
                          </div>

                          {/* Resource Usage Section */}
                          <div>
                            <h4 class="text-[10px] text-text-dim uppercase mb-2">Resource Usage</h4>
                            {(() => {
                              const metrics = getPodMetrics(p().metadata.namespace || 'default', p().metadata.name);
                              const cpuUsage = metrics?.cpuUsage || 0;
                              const memPercent = metrics?.memoryPercent || 0;
                              const memUsed = metrics?.memoryUsed || 0;
                              const memLimit = metrics?.memoryLimit || 0;

                              return (
                                <div class="space-y-2">
                                  {/* CPU */}
                                  <div>
                                    <div class="flex justify-between text-xs mb-1">
                                      <span class="text-text-muted">CPU</span>
                                      <span class="font-mono" style={{ color: getUsageColor(cpuUsage) }}>
                                        {cpuUsage.toFixed(1)}%
                                      </span>
                                    </div>
                                    <div class="h-1 bg-white/10 rounded-full overflow-hidden">
                                      <div
                                        class="h-full rounded-full transition-all duration-500"
                                        style={{
                                          width: `${Math.min(cpuUsage, 100)}%`,
                                          background: getUsageGradient(cpuUsage)
                                        }}
                                      />
                                    </div>
                                  </div>
                                  {/* Memory */}
                                  <div>
                                    <div class="flex justify-between text-xs mb-1">
                                      <span class="text-text-muted">Memory</span>
                                      <span class="font-mono" style={{ color: getUsageColor(memPercent) }}>
                                        {memLimit > 0 ? `${formatBytes(memUsed)} / ${formatBytes(memLimit)}` : formatBytes(memUsed)}
                                      </span>
                                    </div>
                                    <Show when={memLimit > 0}>
                                      <div class="h-1 bg-white/10 rounded-full overflow-hidden">
                                        <div
                                          class="h-full rounded-full transition-all duration-500"
                                          style={{
                                            width: `${Math.min(memPercent, 100)}%`,
                                            background: getUsageGradient(memPercent)
                                          }}
                                        />
                                      </div>
                                    </Show>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          {/* Containers Section */}
                          <div>
                            <h4 class="text-[10px] text-text-dim uppercase mb-2">
                              Containers ({p().spec.containers?.length || 0})
                            </h4>
                            <div class="space-y-1">
                              <For each={p().spec.containers || []}>
                                {container => {
                                  const status = () => p().status.containerStatuses?.find(
                                    cs => cs.name === container.name
                                  );
                                  return (
                                    <div class="flex items-center gap-2 text-xs">
                                      <span class={`w-1.5 h-1.5 rounded-full ${
                                        status()?.ready ? 'bg-green-500' : 'bg-yellow-500'
                                      }`} />
                                      <span class="text-text-muted truncate">{container.name}</span>
                                      <Show when={status()?.restartCount}>
                                        <span class="text-[10px] text-yellow-500">
                                          ({status()?.restartCount} restarts)
                                        </span>
                                      </Show>
                                    </div>
                                  );
                                }}
                              </For>
                            </div>
                          </div>

                          {/* Labels/Info Section */}
                          <div>
                            <h4 class="text-[10px] text-text-dim uppercase mb-2">Labels</h4>
                            <div class="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                              <For each={Object.entries(p().metadata.labels || {}).slice(0, 6)}>
                                {([key, value]) => (
                                  <span class="px-1.5 py-0.5 rounded bg-white/5 text-[10px] text-text-muted truncate max-w-[150px]">
                                    {key}: {value}
                                  </span>
                                )}
                              </For>
                            </div>
                          </div>
                        </>
                      )}
                    </Show>
                  </div>

                  {/* Actions */}
                  <div class="flex gap-2 mt-4 pt-3 border-t border-white/10">
                    <Show when={!isNode() && pod()}>
                      <button
                        onClick={() => {
                          const currentPod = pod();
                          if (currentPod) {
                            setLogPanelPod(currentPod);
                          }
                        }}
                        class="px-3 py-1.5 text-xs font-mono rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 transition-colors"
                      >
                        View Logs
                      </button>
                    </Show>
                    <button
                      onClick={() => {
                        const item = selectedItem();
                        if (item?.type === 'node') {
                          setFilter({ ...filter(), nodeName: (item.data as K8sNode).metadata.name });
                        } else if (item?.type === 'pod') {
                          setFilter({ ...filter(), namespace: (item.data as K8sPod).metadata.namespace });
                        }
                        setShowFilters(true);
                      }}
                      class="px-3 py-1.5 text-xs font-mono rounded bg-white/5 text-text-muted border border-white/10 hover:bg-white/10 transition-colors"
                    >
                      Filter to {isNode() ? 'Node' : 'Namespace'}
                    </button>
                  </div>
                </div>
              </div>
            );
          }}
        </Show>
      </div>

      {/* Observability Sidebar */}
      <div class="hidden lg:flex w-80 flex-shrink-0 flex-col gap-3 overflow-y-auto">
        <AlertsPanel />
        <EventsFeed />
        <LangfuseWidget />
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
