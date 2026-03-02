import { createSignal } from "solid-js";
import { prom } from "../lib/api";
import { pollingScheduler } from "../lib/polling";

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

// Reactive store
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

// Polling interval (30 seconds)
const POLL_INTERVAL = 30000;

// PromQL queries
const QUERIES = {
  // Node CPU usage percentage
  nodeCpu:
    '100 - (avg by (node) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
  // Node memory usage percentage
  nodeMemoryPercent:
    "(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100",
  // Node memory available
  nodeMemoryAvailable: "node_memory_MemAvailable_bytes",
  // Node memory total
  nodeMemoryTotal: "node_memory_MemTotal_bytes",
  // Pod CPU usage (rate over 5m)
  podCpu:
    'sum(rate(container_cpu_usage_seconds_total{container!=""}[5m])) by (pod, namespace) * 100',
  // Pod memory usage
  podMemory:
    'sum(container_memory_working_set_bytes{container!=""}) by (pod, namespace)',
  // Pod memory limit
  podMemoryLimit:
    'sum(container_spec_memory_limit_bytes{container!=""}) by (pod, namespace)',
  // Cluster totals
  clusterCpu:
    'sum(rate(node_cpu_seconds_total{mode!="idle"}[5m])) / sum(rate(node_cpu_seconds_total[5m])) * 100',
  clusterMemoryUsed:
    "sum(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)",
  clusterMemoryTotal: "sum(node_memory_MemTotal_bytes)",
};

// Parse Prometheus query result
function parsePrometheusResult(result: any): Map<string, number> {
  const values = new Map<string, number>();
  if (result?.data?.result) {
    for (const entry of result.data.result) {
      const labels = entry.metric || {};
      const value = parseFloat(entry.value?.[1] || "0");

      // Build key from relevant labels
      if (labels.node) {
        values.set(labels.node, value);
      } else if (labels.pod && labels.namespace) {
        values.set(`${labels.namespace}/${labels.pod}`, value);
      } else if (labels.pod) {
        values.set(labels.pod, value);
      }
    }
  }
  return values;
}

// Parse single value from Prometheus query
function parseSingleValue(result: any): number {
  return parseFloat(result?.data?.result?.[0]?.value?.[1] || "0");
}

// Fetch all metrics
async function fetchMetrics() {
  const publicDomains = ['www.flexinfer.ai', 'codyblevins.com', 'www.codyblevins.com'];
  const isPublicView =
    typeof window !== "undefined" &&
    publicDomains.includes(window.location.hostname);

  if (isPublicView) {
    try {
      const resp = await fetch("/flexdeck/api/public/metrics/summary");
      if (resp.ok) {
        const data = await resp.json();

        // In public view, we only get aggregate cluster metrics
        setMetricsStore({
          nodes: new Map(),
          pods: new Map(),
          clusterCpu: data.cluster.cpuPercent,
          clusterMemory:
            (data.cluster.memPercent / 100) *
            (data.cluster.nodeCount * 32 * 1024 * 1024 * 1024), // Approx 32GB per node
          clusterMemoryTotal: data.cluster.nodeCount * 32 * 1024 * 1024 * 1024,
          loading: false,
          error: null,
          lastUpdate: Date.now(),
        });
      } else {
        throw new Error(`Public metrics error: ${resp.status}`);
      }
    } catch (err) {
      console.error("Failed to fetch public metrics:", err);
      // Don't set error here to avoid blocking UI if topology works
      setMetricsStore((prev) => ({ ...prev, loading: false }));
    }
    return;
  }

  try {
    // Fetch all metrics in parallel
    const [
      nodeCpuResult,
      nodeMemPercentResult,
      nodeMemTotalResult,
      podCpuResult,
      podMemResult,
      podMemLimitResult,
      clusterCpuResult,
      clusterMemUsedResult,
      clusterMemTotalResult,
    ] = await Promise.all([
      prom.query(QUERIES.nodeCpu).catch(() => null),
      prom.query(QUERIES.nodeMemoryPercent).catch(() => null),
      prom.query(QUERIES.nodeMemoryTotal).catch(() => null),
      prom.query(QUERIES.podCpu).catch(() => null),
      prom.query(QUERIES.podMemory).catch(() => null),
      prom.query(QUERIES.podMemoryLimit).catch(() => null),
      prom.query(QUERIES.clusterCpu).catch(() => null),
      prom.query(QUERIES.clusterMemoryUsed).catch(() => null),
      prom.query(QUERIES.clusterMemoryTotal).catch(() => null),
    ]);

    // Parse node metrics
    const nodeCpuMap = parsePrometheusResult(nodeCpuResult);
    const nodeMemPercentMap = parsePrometheusResult(nodeMemPercentResult);
    const nodeMemTotalMap = parsePrometheusResult(nodeMemTotalResult);

    const nodeMetrics = new Map<string, ResourceMetrics>();
    for (const [nodeName, cpuUsage] of nodeCpuMap) {
      const memPercent = nodeMemPercentMap.get(nodeName) || 0;
      const memTotal = nodeMemTotalMap.get(nodeName) || 0;
      const memUsed = memTotal * (memPercent / 100);

      nodeMetrics.set(nodeName, {
        cpuUsage,
        memoryUsed: memUsed,
        memoryLimit: memTotal,
        memoryPercent: memPercent,
        lastUpdate: Date.now(),
      });
    }

    // Parse pod metrics
    const podCpuMap = parsePrometheusResult(podCpuResult);
    const podMemMap = parsePrometheusResult(podMemResult);
    const podMemLimitMap = parsePrometheusResult(podMemLimitResult);

    const podMetrics = new Map<string, ResourceMetrics>();
    const allPodKeys = new Set([...podCpuMap.keys(), ...podMemMap.keys()]);

    for (const podKey of allPodKeys) {
      const cpuUsage = podCpuMap.get(podKey) || 0;
      const memUsed = podMemMap.get(podKey) || 0;
      const memLimit = podMemLimitMap.get(podKey) || 0;
      const memPercent = memLimit > 0 ? (memUsed / memLimit) * 100 : 0;

      podMetrics.set(podKey, {
        cpuUsage,
        memoryUsed: memUsed,
        memoryLimit: memLimit,
        memoryPercent: memPercent,
        lastUpdate: Date.now(),
      });
    }

    // Parse cluster totals
    const clusterCpu = parseSingleValue(clusterCpuResult);
    const clusterMemory = parseSingleValue(clusterMemUsedResult);
    const clusterMemoryTotal = parseSingleValue(clusterMemTotalResult);

    setMetricsStore({
      nodes: nodeMetrics,
      pods: podMetrics,
      clusterCpu,
      clusterMemory,
      clusterMemoryTotal,
      loading: false,
      error: null,
      lastUpdate: Date.now(),
    });
  } catch (err) {
    console.error("Failed to fetch metrics:", err);
    setMetricsStore((prev) => ({
      ...prev,
      loading: false,
      error: err instanceof Error ? err.message : "Failed to fetch metrics",
    }));
  }
}

// Start polling metrics
export function startMetricsPolling() {
  pollingScheduler.register("metrics-throughput", fetchMetrics, POLL_INTERVAL);
}

// Stop polling metrics
export function stopMetricsPolling() {
  pollingScheduler.unregister("metrics-throughput");
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
