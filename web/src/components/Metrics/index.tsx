import { Component, createSignal, For, Show, createMemo, lazy, Suspense, ErrorBoundary } from 'solid-js';
import PageScrollBody from '../shared/PageScrollBody';
import {
  PROMETHEUS_TIME_RANGES,
  type MetricPanel,
  type MetricValue,
  usePrometheusMetricsController,
} from './usePrometheusMetricsController';

const GrafanaDashboards = lazy(() => import('./GrafanaDashboards'));
const Alerts = lazy(() => import('../Alerts'));
const CHART_STROKE_COLORS: Record<string, string> = {
  cyan: '#00d9ff',
  purple: '#a855f7',
  green: '#22c55e',
  orange: '#f97316',
  blue: '#60a5fa',
  pink: '#ec4899',
};

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

  return (
    <div class="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div class="glass-panel flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          {/* Tab bar */}
          <div class="flex max-w-full overflow-x-auto rounded-lg bg-surface-raised p-0.5 no-scrollbar">
            <button
              onClick={() => setMetricsTab('prometheus')}
              class={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                metricsTab() === 'prometheus'
                  ? 'bg-neon-cyan/20 text-neon-cyan shadow-sm'
                  : 'text-text-muted hover:text-text-main'
              }`}
            >
              Prometheus
            </button>
            <button
              onClick={() => setMetricsTab('grafana')}
              class={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                metricsTab() === 'grafana'
                  ? 'bg-neon-cyan/20 text-neon-cyan shadow-sm'
                  : 'text-text-muted hover:text-text-main'
              }`}
            >
              Grafana
            </button>
            <button
              onClick={() => setMetricsTab('alerts')}
              class={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                metricsTab() === 'alerts'
                  ? 'bg-neon-cyan/20 text-neon-cyan shadow-sm'
                  : 'text-text-muted hover:text-text-main'
              }`}
            >
              Alerts
            </button>
          </div>
          <Show when={metricsTab() === 'prometheus' && lastUpdated()}>
            <span class="text-xs text-text-dim">
              Updated {lastUpdated()?.toLocaleTimeString()}
            </span>
          </Show>
        </div>

        <Show when={metricsTab() === 'prometheus'}>
          <div class="flex flex-wrap items-center gap-2 sm:gap-3">
            <div class="flex max-w-full overflow-x-auto rounded-lg bg-surface-raised p-0.5 no-scrollbar">
              <For each={PROMETHEUS_TIME_RANGES}>
                {(range) => (
                  <button
                    onClick={() => setTimeRange(range.value)}
                    class={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                      timeRange() === range.value
                        ? 'bg-neon-cyan/20 text-neon-cyan shadow-sm'
                        : 'text-text-muted hover:text-text-main'
                    }`}
                  >
                    {range.label}
                  </button>
                )}
              </For>
            </div>

            <button
              onClick={fetchMetrics}
              disabled={loading()}
              class="flex items-center gap-2 rounded-lg bg-neon-cyan/10 px-4 py-1.5 text-sm font-medium text-neon-cyan transition-all hover:bg-neon-cyan/20 disabled:opacity-50 border border-neon-cyan/20"
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
            <div class="glass-panel flex items-center gap-3 p-4 text-sm text-status-error border border-status-error/20">
              <span class="text-lg">!</span>
              {error()}
            </div>
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
            <div class="glass-panel p-4 text-sm text-status-error border border-status-error/20">
              Failed to load Grafana dashboards: {err.message}
            </div>
          )}>
            <Suspense fallback={
              <div class="flex items-center justify-center py-12">
                <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
              </div>
            }>
              <GrafanaDashboards />
            </Suspense>
          </ErrorBoundary>
        </Show>

        {/* Alerts tab content */}
        <Show when={metricsTab() === 'alerts'}>
          <ErrorBoundary fallback={(err) => (
            <div class="glass-panel p-4 text-sm text-status-error border border-status-error/20">
              {err.message}
            </div>
          )}>
            <Suspense fallback={
              <div class="glass-panel p-4 text-text-dim animate-pulse">Loading alerts...</div>
            }>
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
      cyan: 'text-neon-cyan',
      purple: 'text-neon-purple',
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
    <div class="glass-panel-hover group flex flex-col p-4 transition-all hover:border-white/10">
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
              <div class="text-center">
                {props.loading ? (
                  <div class="h-5 w-5 mx-auto animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
                ) : (
                  <span class="text-xs text-text-dim">No data available</span>
                )}
              </div>
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

// Enhanced sparkline chart with grid and hover
const EnhancedChart: Component<{
  values: MetricValue[];
  color: string;
  unit: string;
  onHover: (index: number | null) => void;
}> = (props) => {
  const width = 300;
  const height = 100;
  const padding = { top: 8, right: 8, bottom: 4, left: 35 };

  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const chartModel = createMemo(() => {
    const values = props.values;
    if (values.length < 2) return null;

    let min = values[0].value;
    let max = values[0].value;
    for (let i = 1; i < values.length; i++) {
      const currentValue = values[i].value;
      if (currentValue < min) min = currentValue;
      if (currentValue > max) max = currentValue;
    }

    const range = max - min || 1;
    const paddedMin = min - range * 0.1;
    const paddedMax = max + range * 0.1;

    const domain = paddedMax - paddedMin || 1;
    const xStep = chartWidth / (values.length - 1);
    const points = new Array<{ x: number; y: number }>(values.length);
    let linePath = '';

    for (let i = 0; i < values.length; i++) {
      const x = padding.left + xStep * i;
      const y =
        padding.top + chartHeight - (chartHeight * (values[i].value - paddedMin)) / domain;
      points[i] = { x, y };
      linePath += `${i === 0 ? 'M' : ' L'} ${x},${y}`;
    }

    const areaPath = `${linePath} L ${padding.left + chartWidth},${padding.top + chartHeight} L ${padding.left},${padding.top + chartHeight} Z`;
    const ticks = [];
    const tickStep = (paddedMax - paddedMin) / 4;
    for (let i = 0; i <= 4; i++) {
      const value = paddedMin + tickStep * i;
      const y =
        padding.top + chartHeight - (chartHeight * (value - paddedMin)) / domain;
      ticks.push({ value, y });
    }

    return {
      min: paddedMin,
      max: paddedMax,
      range: paddedMax - paddedMin,
      points,
      linePath,
      areaPath,
      ticks,
      lastPoint: points[points.length - 1],
    };
  });

  const strokeColor = () => CHART_STROKE_COLORS[props.color] || '#888';

  const handleMouseMove = (e: MouseEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const svgX = (x / rect.width) * width;
    const relativeX = svgX - padding.left;
    const index = Math.round((relativeX / chartWidth) * (props.values.length - 1));
    if (index >= 0 && index < props.values.length) {
      props.onHover(index);
    }
  };

  return (
    <svg
      class="h-full w-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => props.onHover(null)}
    >
      <defs>
        <linearGradient id={`chart-gradient-${props.color}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color={strokeColor()} stop-opacity="0.4" />
          <stop offset="100%" stop-color={strokeColor()} stop-opacity="0" />
        </linearGradient>
        <filter id={`chart-glow-${props.color}`}>
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Grid lines */}
      <For each={chartModel()?.ticks || []}>
        {(tick) => (
          <>
            <line
              x1={padding.left}
              y1={tick.y}
              x2={padding.left + chartWidth}
              y2={tick.y}
              stroke="rgba(255,255,255,0.05)"
              stroke-width="1"
            />
            <text
              x={padding.left - 4}
              y={tick.y}
              text-anchor="end"
              dominant-baseline="middle"
              font-size="8"
              fill="rgba(255,255,255,0.3)"
            >
              {props.unit === 'MB/s' && Math.abs(tick.value) < 0.1 && Math.abs(tick.value) > 0
                ? `${(tick.value * 1024).toFixed(0)}`
                : (chartModel()?.range || 0) < 10
                  ? tick.value.toFixed(1)
                  : tick.value.toFixed(0)}
            </text>
          </>
        )}
      </For>

      {/* Area fill */}
      <path
        d={chartModel()?.areaPath || ''}
        fill={`url(#chart-gradient-${props.color})`}
        class="transition-all duration-300"
      />

      {/* Line */}
      <path
        d={chartModel()?.linePath || ''}
        fill="none"
        stroke={strokeColor()}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        filter={`url(#chart-glow-${props.color})`}
        class="transition-all duration-300"
      />

      {/* Endpoint dot with pulse */}
      <Show when={chartModel()?.lastPoint} keyed>
        {(lastPoint) => {
          return (
            <>
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r={6}
                fill={strokeColor()}
                opacity={0.3}
              >
                <animate
                  attributeName="r"
                  values="4;8;4"
                  dur="2s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0.3;0.1;0.3"
                  dur="2s"
                  repeatCount="indefinite"
                />
              </circle>
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r={3}
                fill={strokeColor()}
                stroke="rgba(0,0,0,0.3)"
                stroke-width={1}
              />
            </>
          );
        }}
      </Show>
    </svg>
  );
};

export default Metrics;
