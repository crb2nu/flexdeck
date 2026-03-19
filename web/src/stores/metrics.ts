import { createSignal, createEffect } from "solid-js";
import { dashboardSummary, dashboardSummaryLoading, dashboardSummaryError } from "./dashboardSummary";

// Resource metrics for nodes and pods
export interface ResourceMetrics {
  cpuUsage: number; // 0-100 percentage
  memoryUsed: number; // bytes
  memoryLimit: number; // bytes
  memoryPercent: number; // 0-100 percentage
  lastUpdate: number; // timestamp
}

interface MetricsStore {
  nodes: Map<string, ResourceMetrics>;
  pods: Map<string, ResourceMetrics>; // key: namespace/podName
  clusterCpu: number;
  clusterMemory: number;
  clusterMemoryTotal: number;
  loading: boolean;
  error: string | null;
  lastUpdate: number;
}

// Reactive store — populated from the server-side dashboard summary
const [metricsStore, setMetricsStore] = createSignal<MetricsStore>({
  nodes: new Map(),
  pods: new Map(),
  clusterCpu: 0,
  clusterMemory: 0,
  clusterMemoryTotal: 0,
  loading: true,
  error: null,
  lastUpdate: 0,
});

// Derive metricsStore from dashboardSummary whenever it updates
createEffect(() => {
  const summary = dashboardSummary();
  const loading = dashboardSummaryLoading();
  const error = dashboardSummaryError();

  if (!summary) {
    setMetricsStore((prev) => ({
      ...prev,
      loading,
      error: error || prev.error,
    }));
    return;
  }

  // Build node metrics map
  const nodeMetrics = new Map<string, ResourceMetrics>();
  for (const n of summary.nodes) {
    const cpuUsage = n.cpu_percent ?? 0;
    const memPercent = n.mem_percent ?? 0;
    const memTotal = n.mem_total ?? 0;
    const memUsed = n.mem_used ?? (memTotal * memPercent / 100);

    nodeMetrics.set(n.node, {
      cpuUsage,
      memoryUsed: memUsed,
      memoryLimit: memTotal,
      memoryPercent: memPercent,
      lastUpdate: Date.now(),
    });
  }

  // Build pod metrics map
  const podMetrics = new Map<string, ResourceMetrics>();
  for (const p of summary.pods) {
    const memPercent = p.memory_limit > 0 ? (p.memory_used / p.memory_limit) * 100 : 0;
    podMetrics.set(`${p.namespace}/${p.pod}`, {
      cpuUsage: p.cpu_percent,
      memoryUsed: p.memory_used,
      memoryLimit: p.memory_limit,
      memoryPercent: memPercent,
      lastUpdate: Date.now(),
    });
  }

  setMetricsStore({
    nodes: nodeMetrics,
    pods: podMetrics,
    clusterCpu: summary.cluster.cpu_percent,
    clusterMemory: summary.cluster.memory_used,
    clusterMemoryTotal: summary.cluster.memory_total,
    loading: false,
    error: null,
    lastUpdate: Date.now(),
  });
});

// Start/stop are now no-ops — polling is managed by dashboardSummary store.
// Kept for backward compatibility with callers.
export function startMetricsPolling() {
  // no-op: polling managed by startDashboardSummaryPolling()
}

export function stopMetricsPolling() {
  // no-op: polling managed by stopDashboardSummaryPolling()
}

// Get metrics for a specific node
export function getNodeMetrics(nodeName: string): ResourceMetrics | undefined {
  return metricsStore().nodes.get(nodeName);
}

// Get metrics for a specific pod
export function getPodMetrics(
  namespace: string,
  podName: string
): ResourceMetrics | undefined {
  return metricsStore().pods.get(`${namespace}/${podName}`);
}

// Get color for resource usage (green -> yellow -> red)
export function getUsageColor(percent: number): string {
  if (percent < 50) return "#0aff68"; // green
  if (percent < 80) return "#fcee0a"; // yellow
  return "#ff003c"; // red
}

// Get gradient for resource bar
export function getUsageGradient(percent: number): string {
  if (percent < 50)
    return "linear-gradient(90deg, rgba(10, 255, 104, 0.3), rgba(10, 255, 104, 0.6))";
  if (percent < 80)
    return "linear-gradient(90deg, rgba(252, 238, 10, 0.3), rgba(252, 238, 10, 0.6))";
  return "linear-gradient(90deg, rgba(255, 0, 60, 0.3), rgba(255, 0, 60, 0.6))";
}

// Export the store for reactive access
export { metricsStore };
