import { Component, createSignal, createMemo, For, Show } from 'solid-js';
import { modelsApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import type { GroupSwapHistoryResponse, GPUSwapEvent } from '../../lib/types';

interface GPUGroupTimelineProps {
  group: string;
  namespace: string;
}

interface TimelineSegment {
  startPct: number;
  widthPct: number;
  state: string;
  model: string;
  fromTs: number;
  toTs: number;
}

type HoursOption = 6 | 12 | 24 | 48;
const HOURS_OPTIONS: HoursOption[] = [6, 12, 24, 48];

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    return `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function stateSegmentColor(state: string): string {
  switch (state) {
    case 'Active': return 'bg-status-ok';
    case 'Queued': return 'bg-status-warn';
    case 'Preempted': return 'bg-neon-purple';
    default: return 'bg-white/10';
  }
}

function stateTextColor(state: string): string {
  switch (state) {
    case 'Active': return 'text-status-ok';
    case 'Queued': return 'text-status-warn';
    case 'Preempted': return 'text-neon-purple';
    default: return 'text-text-dim';
  }
}

function buildTimelineSegments(
  events: GPUSwapEvent[],
  model: string,
  windowStartMs: number,
  windowEndMs: number,
): TimelineSegment[] {
  const totalMs = windowEndMs - windowStartMs;
  if (totalMs <= 0) return [];

  const modelEvents = events
    .filter((e) => e.model === model)
    .map((e) => ({ ...e, tsMs: new Date(e.ts).getTime() }))
    .sort((a, b) => a.tsMs - b.tsMs);

  if (modelEvents.length === 0) return [];

  const segments: TimelineSegment[] = [];

  // Before the first event: the model was in the first event's oldState
  const firstEvent = modelEvents[0];
  if (firstEvent.tsMs > windowStartMs) {
    const fromTs = windowStartMs;
    const toTs = firstEvent.tsMs;
    segments.push({
      startPct: 0,
      widthPct: ((toTs - fromTs) / totalMs) * 100,
      state: firstEvent.oldState,
      model,
      fromTs,
      toTs,
    });
  }

  // Between consecutive events: the state is the newState of the preceding event
  for (let i = 0; i < modelEvents.length; i++) {
    const current = modelEvents[i];
    const nextTs = i + 1 < modelEvents.length ? modelEvents[i + 1].tsMs : windowEndMs;
    const fromTs = Math.max(current.tsMs, windowStartMs);
    const toTs = Math.min(nextTs, windowEndMs);
    if (toTs <= fromTs) continue;

    segments.push({
      startPct: ((fromTs - windowStartMs) / totalMs) * 100,
      widthPct: ((toTs - fromTs) / totalMs) * 100,
      state: current.newState,
      model,
      fromTs,
      toTs,
    });
  }

  return segments;
}

function timeAxisLabels(hours: number): string[] {
  if (hours <= 6) return [`${hours}h ago`, `${Math.round(hours * 0.75)}h ago`, `${Math.round(hours * 0.5)}h ago`, `${Math.round(hours * 0.25)}h ago`, 'now'];
  if (hours <= 12) return [`${hours}h ago`, `${Math.round(hours * 0.67)}h ago`, `${Math.round(hours * 0.33)}h ago`, 'now'];
  if (hours <= 24) return ['24h ago', '18h ago', '12h ago', '6h ago', 'now'];
  return ['48h ago', '36h ago', '24h ago', '12h ago', 'now'];
}

const GPUGroupTimeline: Component<GPUGroupTimelineProps> = (props) => {
  const [data, setData] = createSignal<GroupSwapHistoryResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [hours, setHours] = createSignal<HoursOption>(24);

  const fetchHistory = async () => {
    try {
      const result = await modelsApi.groupSwapHistory(props.group, props.namespace, hours());
      setData(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch swap history');
    } finally {
      setLoading(false);
    }
  };

  createPolling(`gpu-group-timeline-${props.group}`, fetchHistory, 60_000);

  const windowMs = createMemo(() => {
    const now = Date.now();
    const start = now - hours() * 60 * 60 * 1000;
    return { start, end: now };
  });

  const timelineData = createMemo(() => {
    const d = data();
    if (!d) return new Map<string, TimelineSegment[]>();

    const { start, end } = windowMs();
    const result = new Map<string, TimelineSegment[]>();

    for (const model of d.models) {
      result.set(model, buildTimelineSegments(d.events, model, start, end));
    }

    return result;
  });

  const axisLabels = createMemo(() => timeAxisLabels(hours()));

  return (
    <div class="border-t border-white/5 bg-white/[0.02]">
      {/* Header: hours selector */}
      <div class="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <span class="text-[10px] font-medium text-text-dim uppercase tracking-wider">Swap Timeline</span>
        <div class="flex gap-0.5 rounded bg-white/5 p-0.5">
          <For each={HOURS_OPTIONS}>
            {(h) => (
              <button
                class="rounded px-2 py-0.5 text-[10px] font-mono transition-colors"
                classList={{
                  'bg-white/10 text-white': hours() === h,
                  'text-text-muted hover:text-white hover:bg-white/5': hours() !== h,
                }}
                onClick={() => { setHours(h); setLoading(true); }}
              >
                {h}h
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Loading state */}
      <Show when={loading()}>
        <div class="px-4 py-6 text-center text-xs text-text-dim animate-pulse">Loading swap history...</div>
      </Show>

      {/* Error state */}
      <Show when={!loading() && error()}>
        <div class="px-4 py-4 text-center text-xs text-status-error">{error()}</div>
      </Show>

      {/* Empty state */}
      <Show when={!loading() && !error() && data() && data()!.events.length === 0}>
        <div class="px-4 py-6 text-center text-xs text-text-dim">
          No swap events in the last {hours()}h
        </div>
      </Show>

      {/* Content */}
      <Show when={!loading() && !error() && data() && data()!.events.length > 0}>
        {/* Summary stats */}
        <div class="flex items-center gap-4 px-4 py-2 border-b border-white/5 text-[10px] text-text-muted">
          <span>
            <span class="font-mono text-text-main">{data()!.summary.totalSwaps}</span> swaps
          </span>
          <span class="text-white/10">|</span>
          <span>
            Avg queue wait: <span class="font-mono text-text-main">{formatDuration(data()!.summary.avgQueueWaitSec)}</span>
          </span>
          <span class="text-white/10">|</span>
          <span>
            <span class="font-mono text-text-main">{data()!.models.length}</span> model{data()!.models.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Gantt chart */}
        <div class="px-4 py-3 overflow-x-auto">
          {/* Time axis */}
          <div class="flex ml-28">
            <div class="flex-1 relative h-4">
              <For each={axisLabels()}>
                {(label, i) => (
                  <span
                    class="absolute text-[9px] text-text-dim font-mono -translate-x-1/2 whitespace-nowrap"
                    style={{ left: `${(i() / (axisLabels().length - 1)) * 100}%` }}
                  >
                    {label}
                  </span>
                )}
              </For>
            </div>
          </div>

          {/* Model rows */}
          <div class="space-y-1 mt-1">
            <For each={data()!.models}>
              {(model) => {
                const segments = () => timelineData().get(model) || [];
                return (
                  <div class="flex items-center gap-2">
                    {/* Model name */}
                    <div class="w-28 shrink-0 text-right pr-2">
                      <span class="text-[10px] font-mono text-text-muted truncate block" title={model}>
                        {model.length > 16 ? model.slice(0, 14) + '..' : model}
                      </span>
                    </div>
                    {/* Timeline bar */}
                    <div class="flex-1 relative h-5 rounded bg-white/5 overflow-hidden">
                      <For each={segments()}>
                        {(seg) => (
                          <div
                            class={`absolute top-0 h-full ${stateSegmentColor(seg.state)} opacity-80 hover:opacity-100 transition-opacity`}
                            style={{ left: `${seg.startPct}%`, width: `${Math.max(seg.widthPct, 0.2)}%` }}
                            title={`${seg.state}: ${formatDuration((seg.toTs - seg.fromTs) / 1000)}`}
                          />
                        )}
                      </For>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>

          {/* Legend */}
          <div class="flex items-center gap-3 mt-3 ml-28">
            <div class="flex items-center gap-1">
              <div class="w-2.5 h-2.5 rounded-sm bg-status-ok opacity-80" />
              <span class="text-[9px] text-text-dim">Active</span>
            </div>
            <div class="flex items-center gap-1">
              <div class="w-2.5 h-2.5 rounded-sm bg-status-warn opacity-80" />
              <span class="text-[9px] text-text-dim">Queued</span>
            </div>
            <div class="flex items-center gap-1">
              <div class="w-2.5 h-2.5 rounded-sm bg-neon-purple opacity-80" />
              <span class="text-[9px] text-text-dim">Preempted</span>
            </div>
            <div class="flex items-center gap-1">
              <div class="w-2.5 h-2.5 rounded-sm bg-white/10" />
              <span class="text-[9px] text-text-dim">Unknown</span>
            </div>
          </div>
        </div>

        {/* Per-model stats */}
        <div class="px-4 py-2 border-t border-white/5">
          <div class="grid gap-1">
            <For each={data()!.models}>
              {(model) => {
                const stats = () => data()!.summary.modelStats[model];
                return (
                  <Show when={stats()}>
                    <div class="flex items-center gap-3 text-[10px]">
                      <span class="font-mono text-text-muted w-28 text-right pr-2 truncate" title={model}>
                        {model.length > 16 ? model.slice(0, 14) + '..' : model}
                      </span>
                      <span class="text-text-dim">
                        <span class="font-mono text-text-muted">{stats()!.swapCount}</span> swaps
                      </span>
                      <span class={stateTextColor('Active')}>
                        <span class="font-mono">{formatDuration(stats()!.totalActiveSec)}</span> active
                      </span>
                      <span class={stateTextColor('Queued')}>
                        <span class="font-mono">{formatDuration(stats()!.totalQueuedSec)}</span> queued
                      </span>
                    </div>
                  </Show>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default GPUGroupTimeline;
