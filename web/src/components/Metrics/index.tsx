import { Component, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';

interface MetricValue {
  time: number;
  value: number;
}

interface MetricPanel {
  title: string;
  query: string;
  unit: string;
  color: string;
  values: MetricValue[];
}

const Metrics: Component = () => {
  const [panels, setPanels] = createStore<MetricPanel[]>([
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
  ]);

  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [timeRange, setTimeRange] = createSignal('1h');

  const timeRanges = [
    { label: '15m', value: '15m' },
    { label: '1h', value: '1h' },
    { label: '3h', value: '3h' },
    { label: '6h', value: '6h' },
    { label: '12h', value: '12h' },
    { label: '24h', value: '24h' },
  ];

  const parseTimeRange = (range: string): number => {
    const match = range.match(/^(\d+)([mhd])$/);
    if (!match) return 3600; // default 1h in seconds
    const [, num, unit] = match;
    const multipliers: Record<string, number> = { m: 60, h: 3600, d: 86400 };
    return parseInt(num) * (multipliers[unit] || 3600);
  };

  const fetchMetrics = async () => {
    setLoading(true);
    setError('');

    const now = Math.floor(Date.now() / 1000);
    const start = now - parseTimeRange(timeRange());
    const step = Math.max(15, Math.floor((now - start) / 100)); // ~100 data points

    try {
      await Promise.all(
        panels.map(async (panel, index) => {
          const params = new URLSearchParams({
            query: panel.query,
            start: start.toString(),
            end: now.toString(),
            step: step.toString(),
          });

          const response = await fetch(`/api/prom/query_range?${params}`);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();
          const values: MetricValue[] = [];

          if (data.data?.result?.[0]?.values) {
            for (const [time, value] of data.data.result[0].values) {
              values.push({
                time: time * 1000,
                value: parseFloat(value) || 0,
              });
            }
          }

          setPanels(index, 'values', values);
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 30000);
    onCleanup(() => clearInterval(interval));
  });

  // Re-fetch when time range changes
  createEffect(() => {
    timeRange(); // Track dependency
    fetchMetrics();
  });

  const getColorClass = (color: string) => {
    const colors: Record<string, string> = {
      cyan: 'text-neon-cyan',
      purple: 'text-neon-purple',
      green: 'text-status-ok',
      orange: 'text-status-warn',
      blue: 'text-blue-400',
      pink: 'text-pink-400',
    };
    return colors[color] || 'text-text-main';
  };

  const getGradientId = (color: string) => `gradient-${color}`;

  const getStrokeColor = (color: string) => {
    const colors: Record<string, string> = {
      cyan: '#00d9ff',
      purple: '#a855f7',
      green: '#22c55e',
      orange: '#f97316',
      blue: '#60a5fa',
      pink: '#ec4899',
    };
    return colors[color] || '#888';
  };

  return (
    <div class="flex h-full flex-col gap-4">
      {/* Header */}
      <div class="glass-panel flex items-center justify-between px-4 py-3">
        <h2 class="text-lg font-medium text-text-main">Cluster Metrics</h2>

        <div class="flex items-center gap-4">
          <select
            value={timeRange()}
            onChange={(e) => setTimeRange(e.currentTarget.value)}
            class="rounded-md border border-white/10 bg-surface-raised px-3 py-1.5 text-sm text-text-main focus:border-neon-cyan focus:outline-none"
          >
            <For each={timeRanges}>{(range) => <option value={range.value}>{range.label}</option>}</For>
          </select>

          <button
            onClick={fetchMetrics}
            disabled={loading()}
            class="rounded-md bg-neon-cyan/20 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="glass-panel p-4 text-sm text-status-error">{error()}</div>
      </Show>

      {/* Metrics Grid */}
      <div class="grid flex-1 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <For each={panels}>
          {(panel) => (
            <div class="glass-panel flex flex-col p-4">
              <div class="mb-2 flex items-center justify-between">
                <span class={`text-sm font-medium ${getColorClass(panel.color)}`}>{panel.title}</span>
                <span class="text-lg font-bold text-text-main">
                  {panel.values.length > 0
                    ? `${panel.values[panel.values.length - 1].value.toFixed(1)}${panel.unit}`
                    : '-'}
                </span>
              </div>

              <div class="relative h-24 flex-1">
                <Show
                  when={panel.values.length > 1}
                  fallback={
                    <div class="flex h-full items-center justify-center text-xs text-text-dim">
                      {loading() ? 'Loading...' : 'No data'}
                    </div>
                  }
                >
                  <SparklineChart values={panel.values} color={panel.color} />
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

// Simple sparkline chart component
const SparklineChart: Component<{ values: MetricValue[]; color: string }> = (props) => {
  const getPath = () => {
    if (props.values.length < 2) return '';

    const values = props.values;
    const min = Math.min(...values.map((v) => v.value));
    const max = Math.max(...values.map((v) => v.value));
    const range = max - min || 1;

    const width = 100;
    const height = 100;
    const padding = 5;

    const points = values.map((v, i) => {
      const x = padding + ((width - 2 * padding) * i) / (values.length - 1);
      const y = height - padding - ((height - 2 * padding) * (v.value - min)) / range;
      return `${x},${y}`;
    });

    return `M ${points.join(' L ')}`;
  };

  const getAreaPath = () => {
    if (props.values.length < 2) return '';

    const values = props.values;
    const min = Math.min(...values.map((v) => v.value));
    const max = Math.max(...values.map((v) => v.value));
    const range = max - min || 1;

    const width = 100;
    const height = 100;
    const padding = 5;

    const points = values.map((v, i) => {
      const x = padding + ((width - 2 * padding) * i) / (values.length - 1);
      const y = height - padding - ((height - 2 * padding) * (v.value - min)) / range;
      return `${x},${y}`;
    });

    const firstX = padding;
    const lastX = padding + ((width - 2 * padding) * (values.length - 1)) / (values.length - 1);
    const bottomY = height - padding;

    return `M ${firstX},${bottomY} L ${points.join(' L ')} L ${lastX},${bottomY} Z`;
  };

  const strokeColor = () => {
    const colors: Record<string, string> = {
      cyan: '#00d9ff',
      purple: '#a855f7',
      green: '#22c55e',
      orange: '#f97316',
      blue: '#60a5fa',
      pink: '#ec4899',
    };
    return colors[props.color] || '#888';
  };

  return (
    <svg class="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`gradient-${props.color}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color={strokeColor()} stop-opacity="0.3" />
          <stop offset="100%" stop-color={strokeColor()} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path d={getAreaPath()} fill={`url(#gradient-${props.color})`} />
      <path d={getPath()} fill="none" stroke={strokeColor()} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
};

export default Metrics;
