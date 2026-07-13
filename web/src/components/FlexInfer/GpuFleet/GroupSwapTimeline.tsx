import { Component, createSignal, createMemo, For, Show } from 'solid-js';
import { sanitizeError } from '../../../lib/sanitizeError';
import { modelsApi } from '../../../lib/api';
import { createPolling } from '../../../hooks/createPolling';
import { createPersistedSignal } from '../../../hooks/createPersistedSignal';
import type { GroupSwapHistoryResponse, GPUSwapEvent } from '../../../lib/types';

interface GroupSwapTimelineProps {
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

function isHoursOption(value: unknown): value is HoursOption {
  return typeof value === 'number' && (HOURS_OPTIONS as number[]).includes(value);
}

// Stale-while-revalidate: the last good response, stamped with the fetch time
// and the window it was fetched for. Refetches (polls, hours changes) keep
// rendering this snapshot until fresh data lands — the chart never blanks.
interface Snapshot {
  data: GroupSwapHistoryResponse;
  at: number;
  hours: HoursOption;
}

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
    case 'Preempted': return 'bg-white/30';
    default: return 'bg-white/10';
  }
}

function stateTextColor(state: string): string {
  switch (state) {
    case 'Active': return 'text-status-ok';
    case 'Queued': return 'text-status-warn';
    case 'Preempted': return 'text-text-dim';
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

const GroupSwapTimeline: Component<GroupSwapTimelineProps> = (props) => {
  const [snap, setSnap] = createSignal<Snapshot | null>(null);
  const [refreshing, setRefreshing] = createSignal(false);
  const [error, setError] = createSignal('');
  const [hours, setHours] = createPersistedSignal<HoursOption>('flexinfer.swapHours', 24, isHoursOption);

  // Latest-wins: rapid hours switches fire overlapping fetches, and a slow
  // wide-window response must not overwrite a newer narrow one. Each fetch
  // takes a sequence token and drops its resolution if it's no longer newest.
  let fetchSeq = 0;
  const fetchHistory = async () => {
    const requested = hours();
    const seq = ++fetchSeq;
    if (snap()) setRefreshing(true);
    try {
      const result = await modelsApi.groupSwapHistory(props.group, props.namespace, requested);
      if (seq !== fetchSeq) return;
      setSnap({ data: result, at: Date.now(), hours: requested });
      setError('');
    } catch (err) {
      if (seq !== fetchSeq) return;
      setError(err instanceof Error ? err.message : 'Failed to fetch swap history');
    } finally {
      if (seq === fetchSeq) setRefreshing(false);
    }
  };

  createPolling(() => `gpu-group-timeline-${props.namespace}-${props.group}`, fetchHistory, 60_000);

  // Window, axis, and segments all derive from the SNAPSHOT (not the live
  // hours selection), so the rendered chart is always internally consistent —
  // a pending hours change updates the display only when its data arrives.
  const windowMs = createMemo(() => {
    const s = snap();
    if (!s) return null;
    return { start: s.at - s.hours * 60 * 60 * 1000, end: s.at };
  });

  const timelineData = createMemo(() => {
    const s = snap();
    const window = windowMs();
    if (!s || !window) return new Map<string, TimelineSegment[]>();

    const result = new Map<string, TimelineSegment[]>();
    for (const model of s.data.models) {
      result.set(model, buildTimelineSegments(s.data.events, model, window.start, window.end));
    }
    return result;
  });

  const axisLabels = createMemo(() => {
    const s = snap();
    return timeAxisLabels(s ? s.hours : hours());
  });

  const loading = () => !snap() && !error();

  return (
    <div class="border-t border-white/5 bg-white/[0.02]">
      {/* Header: hours selector */}
      <div class="flex items-center justify-between px-4 py-2 border-b border-white/5">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-medium text-text-dim uppercase tracking-wider">Swap Timeline</span>
          <Show when={refreshing()}>
            <span class="text-[9px] text-text-dim animate-pulse">updating</span>
          </Show>
          <Show when={!refreshing() && error() && snap()}>
            <span class="rounded-md border border-status-warn/20 bg-status-warn/10 px-1.5 py-0.5 text-[9px] text-status-warn">
              stale snapshot
            </span>
          </Show>
        </div>
        <div class="flex gap-0.5 rounded bg-white/5 p-0.5">
          <For each={HOURS_OPTIONS}>
            {(h) => (
              <button
                class="rounded px-2 py-0.5 text-[10px] font-mono transition-colors"
                classList={{
                  'bg-white/10 text-white': hours() === h,
                  'text-text-muted hover:text-white hover:bg-white/5': hours() !== h,
                }}
                aria-pressed={hours() === h}
                onClick={() => {
                  if (hours() === h) return;
                  setHours(h);
                  void fetchHistory();
                }}
              >
                {h}h
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Initial loading state (only before the first snapshot) */}
      <Show when={loading()}>
        <div class="px-4 py-6 text-center text-xs text-text-dim animate-pulse">Loading swap history...</div>
      </Show>

      {/* Error state (only when there is no snapshot to keep showing) */}
      <Show when={!snap() && error()}>
        <div class="px-4 py-4 text-center text-xs text-status-error">{sanitizeError(error())}</div>
      </Show>

      {/* Empty state */}
      <Show when={snap() && snap()!.data.events.length === 0}>
        <div class="px-4 py-6 text-center text-xs text-text-dim">
          No swap events in the last {snap()!.hours}h
        </div>
      </Show>

      {/* Content */}
      <Show when={snap() && snap()!.data.events.length > 0}>
        {/* Summary stats */}
        <div class="flex items-center gap-4 px-4 py-2 border-b border-white/5 text-[10px] text-text-muted">
          <span>
            <span class="font-mono text-text-main">{snap()!.data.summary.totalSwaps}</span> swaps
          </span>
          <span class="text-white/10">|</span>
          <span>
            Avg queue wait: <span class="font-mono text-text-main">{formatDuration(snap()!.data.summary.avgQueueWaitSec)}</span>
          </span>
          <span class="text-white/10">|</span>
          <span>
            <span class="font-mono text-text-main">{snap()!.data.models.length}</span> model{snap()!.data.models.length !== 1 ? 's' : ''}
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
            <For each={snap()!.data.models}>
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
              <div class="w-2.5 h-2.5 rounded-sm bg-white/30 opacity-80" />
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
            <For each={snap()!.data.models}>
              {(model) => {
                const stats = () => snap()!.data.summary.modelStats[model];
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

export default GroupSwapTimeline;
