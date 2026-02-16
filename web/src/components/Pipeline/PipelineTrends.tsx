import { Component, createSignal, onMount, onCleanup, For, Show, createMemo } from 'solid-js';
import { ciApi } from '../../lib/api';

interface TrendData {
  project_id: number;
  avg_duration_s: number;
  p95_duration_s: number;
  success_rate: number;
  total_runs: number;
  sparkline: number[];
  trend: string;
}

const PipelineTrends: Component = () => {
  const [trends, setTrends] = createSignal<TrendData[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');

  const fetchTrends = async () => {
    try {
      const data = await ciApi.getTrends();
      setTrends(data || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trends');
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    fetchTrends();
    const interval = setInterval(fetchTrends, 60000);
    onCleanup(() => clearInterval(interval));
  });

  const formatDuration = (secs: number): string => {
    if (secs < 60) return `${Math.round(secs)}s`;
    const mins = Math.floor(secs / 60);
    const remaining = Math.round(secs % 60);
    return `${mins}m ${remaining}s`;
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return '\u2191';
      case 'down': return '\u2193';
      default: return '\u2192';
    }
  };

  const getTrendColor = (trend: string) => {
    // For duration trends, "up" is bad, "down" is good
    switch (trend) {
      case 'up': return 'text-status-error';
      case 'down': return 'text-status-ok';
      default: return 'text-text-dim';
    }
  };

  const getSuccessRateColor = (rate: number) => {
    if (rate >= 90) return 'text-status-ok';
    if (rate >= 70) return 'text-status-warn';
    return 'text-status-error';
  };

  return (
    <div class="p-4 overflow-y-auto flex-1">
      <Show when={loading()}>
        <div class="flex items-center justify-center py-12">
          <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
        </div>
      </Show>

      <Show when={error()}>
        <div class="glass-panel flex items-center gap-3 p-4 text-sm text-status-error border border-status-error/20">
          <span>!</span>
          {error()}
        </div>
      </Show>

      <Show when={!loading() && trends().length === 0 && !error()}>
        <div class="flex flex-col items-center justify-center py-12 text-text-muted">
          <div class="text-lg mb-2">No Pipeline Trend Data</div>
          <div class="text-sm text-text-dim">
            Pipeline data will appear after the scraper collects execution history.
          </div>
        </div>
      </Show>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <For each={trends()}>
          {(trend) => (
            <div class="glass-panel-hover p-4 flex flex-col gap-3">
              {/* Header */}
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-text-main font-mono">
                  Project #{trend.project_id}
                </span>
                <span class={`text-sm ${getTrendColor(trend.trend)}`}>
                  {getTrendIcon(trend.trend)}
                </span>
              </div>

              {/* Stats grid */}
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <div class="text-[10px] uppercase tracking-wider text-text-dim mb-0.5">
                    Avg Duration
                  </div>
                  <div class="text-lg font-bold text-neon-cyan font-mono">
                    {formatDuration(trend.avg_duration_s)}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] uppercase tracking-wider text-text-dim mb-0.5">
                    P95 Duration
                  </div>
                  <div class="text-lg font-bold text-neon-purple font-mono">
                    {formatDuration(trend.p95_duration_s)}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] uppercase tracking-wider text-text-dim mb-0.5">
                    Success Rate
                  </div>
                  <div class={`text-lg font-bold font-mono ${getSuccessRateColor(trend.success_rate)}`}>
                    {trend.success_rate.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div class="text-[10px] uppercase tracking-wider text-text-dim mb-0.5">
                    Total Runs
                  </div>
                  <div class="text-lg font-bold text-text-main font-mono">
                    {trend.total_runs}
                  </div>
                </div>
              </div>

              {/* Sparkline */}
              <Show when={trend.sparkline && trend.sparkline.length > 1}>
                <div class="h-12 mt-1">
                  <MiniSparkline
                    data={trend.sparkline}
                    color={trend.trend === 'up' ? '#ef4444' : trend.trend === 'down' ? '#22c55e' : '#00d9ff'}
                  />
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

const MiniSparkline: Component<{ data: number[]; color: string }> = (props) => {
  const width = 200;
  const height = 40;
  const padding = 2;

  const path = createMemo(() => {
    const vals = props.data;
    if (vals.length < 2) return '';

    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    return vals
      .map((v, i) => {
        const x = padding + (chartW * i) / (vals.length - 1);
        const y = padding + chartH - (chartH * (v - min)) / range;
        return `${i === 0 ? 'M' : 'L'} ${x},${y}`;
      })
      .join(' ');
  });

  const areaPath = createMemo(() => {
    const vals = props.data;
    if (vals.length < 2) return '';

    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;
    const chartW = width - padding * 2;
    const chartH = height - padding * 2;

    const points = vals
      .map((v, i) => {
        const x = padding + (chartW * i) / (vals.length - 1);
        const y = padding + chartH - (chartH * (v - min)) / range;
        return `${x},${y}`;
      })
      .join(' L ');

    return `M ${padding},${padding + chartH} L ${points} L ${padding + chartW},${padding + chartH} Z`;
  });

  return (
    <svg class="h-full w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`spark-grad-${props.color.replace('#', '')}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color={props.color} stop-opacity="0.3" />
          <stop offset="100%" stop-color={props.color} stop-opacity="0" />
        </linearGradient>
      </defs>
      <path
        d={areaPath()}
        fill={`url(#spark-grad-${props.color.replace('#', '')})`}
      />
      <path
        d={path()}
        fill="none"
        stroke={props.color}
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
};

export default PipelineTrends;
