import { Component, createSignal, For, Show, createMemo, lazy, Suspense, ErrorBoundary } from 'solid-js';
import { TabBar, LoadingState, ErrorState, EmptyState } from '../shared';
import type { TabDef } from '../shared';
import PageScrollBody from '../shared/PageScrollBody';
import {
  PROMETHEUS_TIME_RANGES,
  type MetricPanel,
  usePrometheusMetricsController,
} from './usePrometheusMetricsController';
import EnhancedChart from './EnhancedChart';

const GrafanaDashboards = lazy(() => import('./GrafanaDashboards'));
const Alerts = lazy(() => import('../Alerts'));

const METRICS_TABS: TabDef<'prometheus' | 'grafana' | 'alerts'>[] = [
  { id: 'prometheus', label: 'Prometheus', color: 'white' },
  { id: 'grafana', label: 'Grafana', color: 'white' },
  { id: 'alerts', label: 'Alerts', color: 'white' },
];

const Metrics: Component = () => {
  const [metricsTab, setMetricsTab] = createSignal<'prometheus' | 'grafana' | 'alerts'>('prometheus');
  const {
    panels,
    loading,
    error,
    timeRange,
    setTimeRange,
    lastUpdated,
    fetchMetrics,
  } = usePrometheusMetricsController(() => metricsTab() === 'prometheus');

  const timeRangeTabs = createMemo<TabDef[]>(() =>
    PROMETHEUS_TIME_RANGES.map((range) => ({
      id: range.value,
      label: range.label,
      color: 'white',
    }))
  );

  return (
    <div class="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div class="surface flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          {/* Tab bar */}
          <TabBar
            tabs={METRICS_TABS}
            active={metricsTab()}
            onChange={setMetricsTab}
          />
          <Show when={metricsTab() === 'prometheus' && lastUpdated()}>
            <span class="text-xs text-text-dim">
              Updated {lastUpdated()?.toLocaleTimeString()}
            </span>
          </Show>
        </div>

        <Show when={metricsTab() === 'prometheus'}>
          <div class="flex flex-wrap items-center gap-2 sm:gap-3">
            <TabBar
              tabs={timeRangeTabs()}
              active={timeRange()}
              onChange={setTimeRange}
            />

            <button
              onClick={fetchMetrics}
              disabled={loading()}
              class="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-1.5 text-sm font-medium text-white transition-all hover:bg-white/20 disabled:opacity-50 border border-white/15"
            >
              <span class={loading() ? 'animate-spin' : ''}>↻</span>
              Refresh
            </button>
          </div>
        </Show>
      </div>

      <PageScrollBody contentClass="gap-4">
        {/* Prometheus tab content */}
        <Show when={metricsTab() === 'prometheus'}>
          <Show when={error()}>
            <ErrorState message={error()!} variant="banner" onRetry={fetchMetrics} />
          </Show>

          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <For each={panels()}>
              {(panel) => (
                <MetricCard
                  panel={panel}
                  loading={loading()}
                />
              )}
            </For>
          </div>
        </Show>

        {/* Grafana tab content */}
        <Show when={metricsTab() === 'grafana'}>
          <ErrorBoundary fallback={(err) => (
            <ErrorState message={`Failed to load Grafana dashboards: ${err.message}`} variant="banner" />
          )}>
            <Suspense fallback={<LoadingState variant="inline" size="sm" />}>
              <GrafanaDashboards />
            </Suspense>
          </ErrorBoundary>
        </Show>

        {/* Alerts tab content */}
        <Show when={metricsTab() === 'alerts'}>
          <ErrorBoundary fallback={(err) => (
            <ErrorState message={err.message} variant="banner" />
          )}>
            <Suspense fallback={<LoadingState variant="inline" size="sm" message="Loading alerts..." />}>
              <Alerts />
            </Suspense>
          </ErrorBoundary>
        </Show>
      </PageScrollBody>
    </div>
  );
};

// Enhanced metric card component
const MetricCard: Component<{ panel: MetricPanel; loading: boolean }> = (props) => {
  const [hoveredIndex, setHoveredIndex] = createSignal<number | null>(null);

  const formatValue = (value: number, unit: string, precision: 'headline' | 'stat' | 'axis' | 'tooltip' = 'headline'): string => {
    // Adaptive unit for network throughput: show KB/s for small values
    if (unit === 'MB/s') {
      if (Math.abs(value) < 0.1 && Math.abs(value) > 0) {
        const kbVal = value * 1024;
        if (precision === 'headline') return `${kbVal.toFixed(1)}KB/s`;
        if (precision === 'axis') return `${kbVal.toFixed(0)}`;
        return `${kbVal.toFixed(1)}KB/s`;
      }
      if (precision === 'headline') return `${value.toFixed(1)}${unit}`;
      if (precision === 'axis') return `${value.toFixed(1)}`;
      if (precision === 'tooltip') return `${value.toFixed(2)}${unit}`;
      return `${value.toFixed(1)}`;
    }
    // Default formatting
    if (precision === 'headline') return `${value.toFixed(1)}${unit}`;
    if (precision === 'axis') return value.toFixed(0);
    if (precision === 'tooltip') return `${value.toFixed(2)}${unit}`;
    return value.toFixed(1);
  };

  const stats = createMemo(() => {
    const values = props.panel.values;
    if (values.length === 0) return { current: 0, min: 0, max: 0, avg: 0, trend: 'stable' as const };

    let min = values[0].value;
    let max = values[0].value;
    let sum = 0;
    let recentSum = 0;
    let earlierSum = 0;
    const recentStart = Math.floor(values.length * 0.8);

    for (let i = 0; i < values.length; i++) {
      const currentValue = values[i].value;
      if (currentValue < min) min = currentValue;
      if (currentValue > max) max = currentValue;
      sum += currentValue;
      if (i >= recentStart) recentSum += currentValue;
      else earlierSum += currentValue;
    }

    const current = values[values.length - 1].value;
    const avg = sum / values.length;
    const recentCount = Math.max(1, values.length - recentStart);
    const recentAvg = recentSum / recentCount;
    const earlierAvg = recentStart > 0 ? earlierSum / recentStart : recentAvg;
    const trend = recentAvg > earlierAvg * 1.05 ? 'up' : recentAvg < earlierAvg * 0.95 ? 'down' : 'stable';

    return { current, min, max, avg, trend };
  });

  const getColorClass = (color: string) => {
    const colors: Record<string, string> = {
      cyan: 'text-white',
      purple: 'text-text-muted',
      green: 'text-status-ok',
      orange: 'text-status-warn',
      blue: 'text-blue-400',
      pink: 'text-pink-400',
    };
    return colors[color] || 'text-text-main';
  };

  const getTrendIcon = () => {
    switch (stats().trend) {
      case 'up': return '↑';
      case 'down': return '↓';
      default: return '→';
    }
  };

  const getTrendColor = () => {
    if (props.panel.title.includes('Restart')) {
      return stats().trend === 'up' ? 'text-status-error' : stats().trend === 'down' ? 'text-status-ok' : 'text-text-dim';
    }
    return stats().trend === 'up' ? 'text-status-ok' : stats().trend === 'down' ? 'text-status-error' : 'text-text-dim';
  };

  return (
    <div class="surface-hover group flex flex-col p-4 transition-all hover:border-white/10">
      {/* Header */}
      <div class="mb-3 flex items-center justify-between">
        <span class={`text-sm font-medium ${getColorClass(props.panel.color)}`}>
          {props.panel.title}
        </span>
        <div class="flex items-center gap-2">
          <span class={`text-sm ${getTrendColor()}`}>{getTrendIcon()}</span>
          <span class="text-2xl font-bold text-text-main tabular-nums">
            {props.panel.values.length > 0
              ? formatValue(stats().current, props.panel.unit, 'headline')
              : '-'}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div class="relative h-32 flex-1">
        <Show
          when={props.panel.values.length > 1}
          fallback={
            <div class="flex h-full items-center justify-center">
              {props.loading ? (
                <LoadingState variant="inline" size="sm" />
              ) : (
                <EmptyState title="No data available" size="sm" />
              )}
            </div>
          }
        >
          <EnhancedChart
            values={props.panel.values}
            color={props.panel.color}
            unit={props.panel.unit}
            onHover={setHoveredIndex}
          />
        </Show>

        {/* Hover tooltip */}
        <Show when={hoveredIndex() !== null && props.panel.values[hoveredIndex()!]} keyed>
          {(val) => (
            <div class="absolute top-0 left-1/2 -translate-x-1/2 rounded-md bg-surface-raised px-2 py-1 text-xs shadow-lg border border-white/10 pointer-events-none z-10">
              <div class="font-mono text-text-main">
                {formatValue(val.value, props.panel.unit, 'tooltip')}
              </div>
              <div class="text-text-dim text-[10px]">
                {new Date(val.time).toLocaleTimeString()}
              </div>
            </div>
          )}
        </Show>
      </div>

      {/* Stats footer */}
      <div class="mt-3 flex justify-between border-t border-white/5 pt-3 text-[10px] text-text-dim">
        <div class="flex gap-3">
          <span>Min: <span class="text-text-muted font-mono">{formatValue(stats().min, props.panel.unit, 'stat')}</span></span>
          <span>Avg: <span class="text-text-muted font-mono">{formatValue(stats().avg, props.panel.unit, 'stat')}</span></span>
          <span>Max: <span class="text-text-muted font-mono">{formatValue(stats().max, props.panel.unit, 'stat')}</span></span>
        </div>
      </div>
    </div>
  );
};

export default Metrics;
