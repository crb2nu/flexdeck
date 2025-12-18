import { Component, createSignal, createMemo, onMount, onCleanup, Show, For } from 'solid-js';
import { PulseCard } from '../shared';
import { healthStore } from '../../stores/health';
import { k8sStore, connectK8sStream, disconnectK8sStream, connectionStatus, isNodeReady } from '../../stores/k8s';
import { api } from '../../lib/api';
import { formatBytes, formatPercent } from '../../lib/format';
import type { K8sNode, K8sPod, K8sService } from '../../lib/types';
import TopologyGraph from './TopologyGraph';
import HoloDeck, { type HoloDeckFilter } from './HoloDeck';

const METRICS_REFRESH_INTERVAL = 30000; // 30 seconds for Prometheus metrics

interface SelectedItem {
  type: 'node' | 'pod';
  data: K8sNode | K8sPod;
}

const Dashboard: Component = () => {
  const [viewMode, setViewMode] = createSignal<'2d' | '3d'>('2d');
  const [filter, setFilter] = createSignal<HoloDeckFilter>({});
  const [showFilters, setShowFilters] = createSignal(false);
  const [selectedItem, setSelectedItem] = createSignal<SelectedItem | null>(null);

  // Resource pulse state (still polling Prometheus)
  const [resourceLoading, setResourceLoading] = createSignal(true);
  const [resourceError, setResourceError] = createSignal('');
  const [cpuPercent, setCpuPercent] = createSignal(0);
  const [memUsed, setMemUsed] = createSignal(0);

  let metricsInterval: ReturnType<typeof setInterval>;

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

  const statusList = createMemo(() =>
    [...new Set(k8sStore.pods.map(p => p.status?.phase).filter(Boolean))].sort() as string[]
  );

  const nodeNameList = createMemo(() =>
    k8sStore.nodes.map(n => n.metadata?.name).filter(Boolean).sort() as string[]
  );

  const hasActiveFilter = createMemo(() =>
    Boolean(filter().namespace || (filter().status && filter().status.length > 0) || filter().nodeName)
  );

  const clearFilters = () => setFilter({});

  // Get pods on a specific node
  const getPodsOnNode = createMemo(() => {
    const item = selectedItem();
    if (!item || item.type !== 'node') return [];
    const nodeName = (item.data as K8sNode).metadata.name;
    return pods().filter(p => p.spec.nodeName === nodeName);
  });

  // Handle selection from HoloDeck
  const handleSelect = (item: { type: 'node' | 'pod'; data: K8sNode | K8sPod } | null) => {
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

  async function fetchResources() {
    try {
      const now = Math.floor(Date.now() / 1000);
      const cpuQuery = 'sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) / sum(rate(node_cpu_seconds_total[5m])) * 100';
      const memQuery = 'sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)';

      const [cpuData, memData] = await Promise.all([
        api<any>(`/prom/query?query=${encodeURIComponent(cpuQuery)}&time=${now}`),
        api<any>(`/prom/query?query=${encodeURIComponent(memQuery)}&time=${now}`),
      ]);

      const cpuVal = Number(cpuData?.data?.result?.[0]?.value?.[1] || 0);
      const memVal = Number(memData?.data?.result?.[0]?.value?.[1] || 0);

      setCpuPercent(cpuVal);
      setMemUsed(memVal);
      setResourceError('');
    } catch (e) {
      setResourceError(e instanceof Error ? e.message : 'Failed to fetch metrics');
    } finally {
      setResourceLoading(false);
    }
  }

  onMount(() => {
    // Connect to K8s SSE stream for real-time updates
    connectK8sStream();

    // Fetch Prometheus metrics (still polling, these aren't in SSE)
    fetchResources();
    metricsInterval = setInterval(fetchResources, METRICS_REFRESH_INTERVAL);
  });

  onCleanup(() => {
    disconnectK8sStream();
    if (metricsInterval) clearInterval(metricsInterval);
  });

  return (
    <div class="flex h-full flex-col gap-4">
      {/* Pulse Cards Grid */}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
        />

        <PulseCard
          title="Memory"
          value={formatBytes(memUsed())}
          sub="used across cluster"
          loading={resourceLoading()}
          error={resourceError()}
          icon="◉"
        />
      </div>

      {/* Visualization Panel */}
      <div class="glass-panel flex-1 overflow-hidden relative flex flex-col">
        {/* Controls */}
        <div class="absolute right-4 top-4 z-10 flex gap-2">
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
                   2D GRAPH
               </button>
               <button
                onClick={() => setViewMode('3d')}
                class={`px-3 py-1 text-xs font-mono rounded transition-colors ${viewMode() === '3d' ? 'bg-neon-purple/20 text-neon-purple' : 'text-text-dim hover:text-text-main'}`}
               >
                   HOLODECK
               </button>
           </div>
        </div>

        {/* Filter Panel */}
        <Show when={viewMode() === '3d' && showFilters()}>
          <div class="absolute left-4 top-4 z-10 p-3 rounded-lg bg-black/60 border border-white/10 backdrop-blur min-w-[200px]">
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

            {/* Status Filter */}
            <div class="mb-3">
              <label class="block text-[10px] text-text-dim mb-1 uppercase">Pod Status</label>
              <select
                value={filter().status?.[0] || ''}
                onChange={(e) => setFilter({ ...filter(), status: e.currentTarget.value ? [e.currentTarget.value] : undefined })}
                class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-text-main focus:border-neon-cyan/50 focus:outline-none"
              >
                <option value="">All Statuses</option>
                <For each={statusList()}>
                  {status => <option value={status}>{status}</option>}
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

                          {/* Resources Section */}
                          <div>
                            <h4 class="text-[10px] text-text-dim uppercase mb-2">Resources</h4>
                            <div class="space-y-1 text-xs">
                              <Show when={n().status?.capacity?.cpu}>
                                <div class="flex justify-between">
                                  <span class="text-text-muted">CPU</span>
                                  <span class="text-text-main font-mono">{n().status?.capacity?.cpu}</span>
                                </div>
                              </Show>
                              <Show when={n().status?.capacity?.memory}>
                                <div class="flex justify-between">
                                  <span class="text-text-muted">Memory</span>
                                  <span class="text-text-main font-mono">{n().status?.capacity?.memory}</span>
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
                      <button class="px-3 py-1.5 text-xs font-mono rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 transition-colors">
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
    </div>
  );
};

export default Dashboard;
