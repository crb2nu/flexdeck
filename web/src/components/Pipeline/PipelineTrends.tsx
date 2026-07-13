import { Component, For, Show, createMemo } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { LoadingState, ErrorState, EmptyState } from '../shared';
import { ciApi } from '../../lib/api';
import { createPolledResource } from '../../hooks/createPolledResource';
import { formatDuration } from '../../lib/format';
import {
  operatorStateBadgeClass,
  operatorStateLabel,
  resolveOperatorState,
  type OperatorState,
} from '../../lib/freshness';

interface TrendData {
  project_id: number;
  project_name?: string;
  avg_duration_s: number;
  p95_duration_s: number;
  success_rate: number;
  total_runs: number;
  sparkline: number[];
  trend: string;
}

const PipelineTrends: Component = () => {
  // Same-route navigation: clicking a trend card drops the tab param (back to
  // the pipelines tab) and opens that project's pipeline detail via ?repo=.
  const [, setSearchParams] = useSearchParams<{ repo?: string; tab?: string; view?: string }>();
  const openProjectDetail = (trend: TrendData) => {
    setSearchParams({ tab: undefined, view: 'detail', repo: String(trend.project_id) });
  };

  // Keyed reconcile keeps unchanged trend cards (and their sparklines) from
  // being torn down on every 60s poll.
  const res = createPolledResource<TrendData[]>('pipeline-trends', () => ciApi.getTrends(), {
    interval: 60_000,
    key: 'project_id',
  });
  const trends = () => res.data() ?? [];
  const loading = () => !res.loaded();
  const error = () => res.error() ?? '';

  const state = createMemo<OperatorState>(() =>
    resolveOperatorState({
      loading: loading(),
      error: error(),
      lastUpdateMs: res.updatedAt(),
      staleAfterMs: 60_000 * 3,
    }),
  );

  const stateDetail = () => {
    if (error()) return 'trend feed issue';
    if (loading()) return res.updatedAt() ? 'background refresh' : 'initial sync';
    if (state() === 'stale') return 'refresh overdue';
    if (trends().length === 0) return 'awaiting samples';
    return `${trends().length} project${trends().length === 1 ? '' : 's'}`;
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
      <div class="surface mb-4 flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
        <div class="min-w-0">
          <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Pipeline Trends</div>
          <div class="mt-1 text-lg font-semibold text-text-main">Execution trend telemetry</div>
          <div class="mt-1 max-w-3xl text-sm text-text-dim">
            Duration and success-rate trends across recently observed pipeline runs.
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-dim">
            <span class={`rounded-full px-2.5 py-1 ${operatorStateBadgeClass(state())}`}>
              {operatorStateLabel(state(), stateDetail())}
            </span>
            <span class="rounded-full bg-white/5 px-2.5 py-1">
              Updated {res.updatedAt() ? new Date(res.updatedAt()).toLocaleTimeString() : '—'}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-white/5 text-text-muted border border-white/10 hover:bg-white/10 transition-all"
            onClick={() => void res.refresh()}
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      <Show when={loading()}>
        <LoadingState size="sm" />
      </Show>

      <Show when={error()}>
        <ErrorState message={error()} />
      </Show>

      <Show when={!loading() && trends().length === 0 && !error()}>
        <EmptyState size="sm" title="No pipeline trend data found" subtitle="Pipeline data will appear after the scraper collects execution history." />
      </Show>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <For each={trends()}>
          {(trend) => (
            <button
              type="button"
              class="surface-hover p-4 flex flex-col gap-3 text-left cursor-pointer"
              title={`Open pipeline detail for ${trend.project_name || `project #${trend.project_id}`}`}
              onClick={() => openProjectDetail(trend)}
            >
              {/* Header */}
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-text-main font-mono truncate" title={trend.project_name || `Project #${trend.project_id}`}>
                  {trend.project_name || `Project #${trend.project_id}`}
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
                  <div class="text-lg font-bold text-text-main font-mono">
                    {formatDuration(trend.avg_duration_s * 1000)}
                  </div>
                </div>
                <div>
                  <div class="text-[10px] uppercase tracking-wider text-text-dim mb-0.5">
                    P95 Duration
                  </div>
                  <div class="text-lg font-bold text-text-muted font-mono">
                    {formatDuration(trend.p95_duration_s * 1000)}
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
                    color={trend.trend === 'up' ? '#ff3d71' : trend.trend === 'down' ? '#22e076' : '#00c8ff'}
                  />
                </div>
              </Show>
            </button>
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
