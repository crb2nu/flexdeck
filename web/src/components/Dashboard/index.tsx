import { Component, createSignal, createMemo, onMount, onCleanup, Show } from 'solid-js';
import { PulseCard } from '../shared';
import { healthStore } from '../../stores/health';
import { k8sStore, connectK8sStream, disconnectK8sStream, connectionStatus, isNodeReady } from '../../stores/k8s';
import { api } from '../../lib/api';
import { formatBytes, formatPercent } from '../../lib/format';
import type { K8sNode, K8sPod, K8sService } from '../../lib/types';
import TopologyGraph from './TopologyGraph';
import HoloDeck from './HoloDeck';

const METRICS_REFRESH_INTERVAL = 30000; // 30 seconds for Prometheus metrics

const Dashboard: Component = () => {
  const [viewMode, setViewMode] = createSignal<'2d' | '3d'>('2d');

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
              <HoloDeck nodes={nodes()} pods={pods()} services={services()} />
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
      </div>
    </div>
  );
};

export default Dashboard;
