import { batch, createEffect, createRoot } from "solid-js";
import { createStore } from "solid-js/store";
import {
  dashboardSummary,
  dashboardSummaryError,
  dashboardSummaryLoading,
  dashboardSummaryRefreshing,
  dashboardSummaryUpdatedAt,
} from "./dashboardSummary";
import type { DashboardSummaryResponse } from "../lib/api/infrastructure";

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
const [metricsStore, setMetricsStore] = createStore<MetricsStore>({
  nodes: new Map(),
  pods: new Map(),
  clusterCpu: 0,
  clusterMemory: 0,
  clusterMemoryTotal: 0,
  loading: true,
  error: null,
  lastUpdate: 0,
});

function buildNodeMetrics(summary: DashboardSummaryResponse, observedAtMs: number) {
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
      lastUpdate: observedAtMs,
    });
  }
  return nodeMetrics;
}

function buildPodMetrics(summary: DashboardSummaryResponse, observedAtMs: number) {
  const podMetrics = new Map<string, ResourceMetrics>();
  for (const p of summary.pods) {
    const memPercent = p.memory_limit > 0 ? (p.memory_used / p.memory_limit) * 100 : 0;
    podMetrics.set(`${p.namespace}/${p.pod}`, {
      cpuUsage: p.cpu_percent,
      memoryUsed: p.memory_used,
      memoryLimit: p.memory_limit,
      memoryPercent: memPercent,
      lastUpdate: observedAtMs,
    });
  }
  return podMetrics;
}

const disposeMetricsStoreRoot = createRoot((dispose) => {
  // Derive metricsStore from dashboardSummary whenever it updates.
  createEffect(() => {
    const summary = dashboardSummary();
    const loading = dashboardSummaryLoading() || dashboardSummaryRefreshing();
    const error = dashboardSummaryError();
    const updatedAt = dashboardSummaryUpdatedAt();

    if (!summary) {
      batch(() => {
        setMetricsStore('loading', loading);
        setMetricsStore('error', error || metricsStore.error);
      });
      return;
    }

    const observedAtMs = updatedAt || Date.now();
    const nodeMetrics = buildNodeMetrics(summary, observedAtMs);
    const podMetrics = buildPodMetrics(summary, observedAtMs);

    batch(() => {
      setMetricsStore('nodes', nodeMetrics);
      setMetricsStore('pods', podMetrics);
      setMetricsStore('clusterCpu', summary.cluster.cpu_percent);
      setMetricsStore('clusterMemory', summary.cluster.memory_used);
      setMetricsStore('clusterMemoryTotal', summary.cluster.memory_total);
      setMetricsStore('loading', loading);
      setMetricsStore('error', error);
      setMetricsStore('lastUpdate', observedAtMs);
    });
  });

  return dispose;
});

// Start/stop are now no-ops — polling is managed by dashboardSummary store.
// Kept for backward compatibility with callers.
export function startMetricsPolling() {
  // no-op: polling managed by startDashboardSummaryPolling()
}

export function stopMetricsPolling() {
  // no-op: polling managed by stopDashboardSummaryPolling()
}

export function disposeMetricsStoreForTest() {
  disposeMetricsStoreRoot();
}

// Get metrics for a specific node
export function getNodeMetrics(nodeName: string): ResourceMetrics | undefined {
  return metricsStore.nodes.get(nodeName);
}

// Get metrics for a specific pod
export function getPodMetrics(
  namespace: string,
  podName: string
): ResourceMetrics | undefined {
  return metricsStore.pods.get(`${namespace}/${podName}`);
}

// Get color for resource usage (success -> warning -> error)
export function getUsageColor(percent: number): string {
  if (percent < 50) return "#22e076"; // --success
  if (percent < 80) return "#ffb830"; // --warning
  return "#ff3d71"; // --error
}

// Get gradient for resource bar
export function getUsageGradient(percent: number): string {
  if (percent < 50)
    return "linear-gradient(90deg, rgba(34, 224, 118, 0.3), rgba(34, 224, 118, 0.6))";
  if (percent < 80)
    return "linear-gradient(90deg, rgba(255, 184, 48, 0.3), rgba(255, 184, 48, 0.6))";
  return "linear-gradient(90deg, rgba(255, 61, 113, 0.3), rgba(255, 61, 113, 0.6))";
}

// Export the store for reactive access
export { metricsStore };
