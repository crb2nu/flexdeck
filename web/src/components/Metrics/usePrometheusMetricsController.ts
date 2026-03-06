import { batch, createEffect, createSignal, onCleanup, onMount, on, type Accessor } from 'solid-js';

export interface MetricValue {
  time: number;
  value: number;
}

export interface MetricPanel {
  title: string;
  query: string;
  unit: string;
  color: string;
  values: MetricValue[];
}

export const PROMETHEUS_TIME_RANGES = [
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '3h', value: '3h' },
  { label: '6h', value: '6h' },
  { label: '12h', value: '12h' },
  { label: '24h', value: '24h' },
] as const;

const BASE_PANELS: MetricPanel[] = [
  {
    title: 'Cluster CPU Usage',
    query: '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)',
    unit: '%',
    color: 'cyan',
    values: [],
  },
  {
    title: 'Cluster Memory Usage',
    query: '(1 - (sum(node_memory_MemAvailable_bytes) / sum(node_memory_MemTotal_bytes))) * 100',
    unit: '%',
    color: 'purple',
    values: [],
  },
  {
    title: 'Pod Count',
    query: 'count(kube_pod_info)',
    unit: '',
    color: 'green',
    values: [],
  },
  {
    title: 'Container Restarts (1h)',
    query: 'sum(increase(kube_pod_container_status_restarts_total[1h]))',
    unit: '',
    color: 'orange',
    values: [],
  },
  {
    title: 'Network Received',
    query: 'sum(rate(node_network_receive_bytes_total[5m])) / 1024 / 1024',
    unit: 'MB/s',
    color: 'blue',
    values: [],
  },
  {
    title: 'Network Transmitted',
    query: 'sum(rate(node_network_transmit_bytes_total[5m])) / 1024 / 1024',
    unit: 'MB/s',
    color: 'pink',
    values: [],
  },
];

function parseTimeRange(range: string): number {
  const match = range.match(/^(\d+)([mhd])$/);
  if (!match) return 3600;
  const [, count, unit] = match;
  const multipliers: Record<string, number> = { m: 60, h: 3600, d: 86400 };
  return parseInt(count, 10) * (multipliers[unit] || 3600);
}

function parseMetricValues(payload: any): MetricValue[] {
  const rawValues = payload?.data?.result?.[0]?.values;
  if (!Array.isArray(rawValues)) return [];

  const values: MetricValue[] = [];
  for (const point of rawValues) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const timestamp = Number(point[0]);
    const value = Number.parseFloat(point[1]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) continue;
    values.push({
      time: timestamp * 1000,
      value,
    });
  }
  return values;
}

export function usePrometheusMetricsController(isPrometheusActive: Accessor<boolean>) {
  const [panels, setPanels] = createSignal<MetricPanel[]>(BASE_PANELS.map((panel) => ({ ...panel })));
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [timeRange, setTimeRange] = createSignal('1h');
  const [lastUpdated, setLastUpdated] = createSignal<Date | null>(null);

  let refreshInterval: ReturnType<typeof setInterval> | null = null;
  let currentAbortController: AbortController | null = null;
  let fetchGeneration = 0;

  const stopPolling = () => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  };

  const fetchMetrics = async () => {
    const generation = ++fetchGeneration;
    currentAbortController?.abort();
    const abortController = new AbortController();
    currentAbortController = abortController;

    batch(() => {
      setLoading(true);
      setError('');
    });

    const now = Math.floor(Date.now() / 1000);
    const start = now - parseTimeRange(timeRange());
    const step = Math.max(15, Math.floor((now - start) / 100));

    try {
      const nextPanels = await Promise.all(
        BASE_PANELS.map(async (panel) => {
          const params = new URLSearchParams({
            query: panel.query,
            start: start.toString(),
            end: now.toString(),
            step: step.toString(),
          });

          const response = await fetch(`/api/prom/query_range?${params}`, {
            signal: abortController.signal,
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          return {
            ...panel,
            values: parseMetricValues(data),
          };
        }),
      );

      if (generation !== fetchGeneration) return;
      batch(() => {
        setPanels(nextPanels);
        setLastUpdated(new Date());
      });
    } catch (err) {
      if (abortController.signal.aborted) return;
      if (generation !== fetchGeneration) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      if (generation === fetchGeneration) {
        setLoading(false);
      }
      if (currentAbortController === abortController) {
        currentAbortController = null;
      }
    }
  };

  const startPolling = () => {
    if (refreshInterval || !isPrometheusActive()) return;
    refreshInterval = setInterval(() => {
      if (!document.hidden) {
        void fetchMetrics();
      }
    }, 30000);
  };

  onMount(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) return;
      if (isPrometheusActive()) {
        void fetchMetrics();
        startPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    onCleanup(() => document.removeEventListener('visibilitychange', handleVisibilityChange));
  });

  createEffect(() => {
    if (isPrometheusActive()) {
      void fetchMetrics();
      startPolling();
      return;
    }
    stopPolling();
  });

  createEffect(
    on(
      timeRange,
      () => {
        if (isPrometheusActive()) {
          void fetchMetrics();
        }
      },
      { defer: true },
    ),
  );

  onCleanup(() => {
    stopPolling();
    currentAbortController?.abort();
  });

  return {
    panels,
    loading,
    error,
    timeRange,
    setTimeRange,
    lastUpdated,
    fetchMetrics,
  };
}
