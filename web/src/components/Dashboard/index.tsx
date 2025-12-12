import { Component, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { PulseCard } from '../shared';
import { healthStore } from '../../stores/health';
import { api } from '../../lib/api';
import { formatBytes, formatPercent } from '../../lib/format';
import type { K8sNode, K8sPod, K8sService, K8sList } from '../../lib/types';
import TopologyGraph from './TopologyGraph';

const REFRESH_INTERVAL = 15000; // 15 seconds

const Dashboard: Component = () => {
  // Pod pulse state
  const [podLoading, setPodLoading] = createSignal(true);
  const [podError, setPodError] = createSignal('');
  const [podReady, setPodReady] = createSignal(0);
  const [podTotal, setPodTotal] = createSignal(0);
  const [podNamespaces, setPodNamespaces] = createSignal(0);

  // Node pulse state
  const [nodeLoading, setNodeLoading] = createSignal(true);
  const [nodeError, setNodeError] = createSignal('');
  const [nodeReady, setNodeReady] = createSignal(0);
  const [nodeTotal, setNodeTotal] = createSignal(0);

  // Resource pulse state
  const [resourceLoading, setResourceLoading] = createSignal(true);
  const [resourceError, setResourceError] = createSignal('');
  const [cpuPercent, setCpuPercent] = createSignal(0);
  const [memUsed, setMemUsed] = createSignal(0);

  // K8s data for topology (future use)
  const [pods, setPods] = createSignal<K8sPod[]>([]);
  const [nodes, setNodes] = createSignal<K8sNode[]>([]);
  const [services, setServices] = createSignal<K8sService[]>([]);
  const [lastUpdated, setLastUpdated] = createSignal(0);

  let refreshInterval: ReturnType<typeof setInterval>;

  const isK8sEnabled = () => healthStore.features?.k8s?.enabled ?? false;
  const isPromEnabled = () => healthStore.features?.prometheus?.enabled ?? false;

  async function fetchPods() {
    if (!isK8sEnabled()) return;

    try {
      const data = await api<K8sList<K8sPod>>('/k8s/pods');
      const items = data.items || [];
      setPods(items);

      const ready = items.filter(
        (p) => p.status?.conditions?.find((c) => c.type === 'Ready')?.status === 'True'
      ).length;
      const namespaces = new Set(items.map((p) => p.metadata?.namespace)).size;

      setPodReady(ready);
      setPodTotal(items.length);
      setPodNamespaces(namespaces);
      setPodError('');
    } catch (e) {
      setPodError(e instanceof Error ? e.message : 'Failed to fetch pods');
    } finally {
      setPodLoading(false);
    }
  }

  async function fetchNodes() {
    if (!isK8sEnabled()) return;

    try {
      const data = await api<K8sList<K8sNode>>('/k8s/nodes');
      const items = data.items || [];
      setNodes(items);

      const ready = items.filter(
        (n) => n.status?.conditions?.find((c) => c.type === 'Ready')?.status === 'True'
      ).length;

      setNodeReady(ready);
      setNodeTotal(items.length);
      setNodeError('');
    } catch (e) {
      setNodeError(e instanceof Error ? e.message : 'Failed to fetch nodes');
    } finally {
      setNodeLoading(false);
    }
  }

  async function fetchServices() {
    if (!isK8sEnabled()) return;

    try {
      const data = await api<K8sList<K8sService>>('/k8s/services');
      setServices(data.items || []);
    } catch {
      // Services are optional for display
    }
  }

  async function fetchResources() {
    if (!isPromEnabled()) {
      setResourceLoading(false);
      setResourceError('Prometheus disabled');
      return;
    }

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

  async function refresh() {
    setLastUpdated(Date.now());
    await Promise.all([fetchPods(), fetchNodes(), fetchServices(), fetchResources()]);
  }

  onMount(() => {
    refresh();
    refreshInterval = setInterval(refresh, REFRESH_INTERVAL);
  });

  onCleanup(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });

  return (
    <div class="flex h-full flex-col gap-4">
      {/* Pulse Cards Grid */}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PulseCard
          title="Pods"
          value={`${podReady()}/${podTotal()}`}
          sub={`${podNamespaces()} namespaces`}
          loading={podLoading()}
          error={podError()}
          icon="⬡"
        />

        <PulseCard
          title="Nodes"
          value={`${nodeReady()}/${nodeTotal()}`}
          sub="cluster nodes"
          loading={nodeLoading()}
          error={nodeError()}
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

      {/* Topology Graph */}
      <div class="glass-panel flex-1 overflow-hidden">
        <Show
          when={nodes().length > 0 || pods().length > 0}
          fallback={
            <div class="flex h-full items-center justify-center">
              <div class="text-center">
                <div class="mb-4 text-6xl text-neon-cyan/30">⬡</div>
                <h3 class="mb-2 text-lg font-semibold text-text-main">Cluster Topology</h3>
                <p class="text-sm text-text-muted">
                  {podLoading() || nodeLoading() ? 'Loading cluster data...' : 'No resources found'}
                </p>
              </div>
            </div>
          }
        >
          <TopologyGraph
            nodes={nodes()}
            pods={pods()}
            services={services()}
          />
        </Show>
        <Show when={lastUpdated() > 0}>
          <div class="absolute bottom-2 right-2 text-xs text-text-dim">
            Updated: {new Date(lastUpdated()).toLocaleTimeString()}
          </div>
        </Show>
      </div>
    </div>
  );
};

export default Dashboard;
