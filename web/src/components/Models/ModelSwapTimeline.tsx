import { Component, createSignal, createEffect, For, Show } from 'solid-js';
import { modelsApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import type { GPUSwapEvent } from '../../lib/types';

function formatDurationSec(seconds?: number): string {
  if (!seconds || seconds <= 0) return '-';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function timeAgo(ts: string): string {
  const seconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function stateColor(state: string): string {
  switch (state) {
    case 'Active': return 'text-status-ok';
    case 'Queued': return 'text-status-warn';
    case 'Preempted': return 'text-text-muted';
    default: return 'text-text-dim';
  }
}

function dotBgColor(state: string): string {
  switch (state) {
    case 'Active': return 'bg-status-ok';
    case 'Queued': return 'bg-status-warn';
    case 'Preempted': return 'bg-white/30';
    default: return 'bg-white/20';
  }
}

const ModelSwapTimeline: Component<{ namespace: string; name: string }> = (props) => {
  const [events, setEvents] = createSignal<GPUSwapEvent[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [showAll, setShowAll] = createSignal(false);

  const fetchHistory = async () => {
    try {
      const data = await modelsApi.swapHistory(props.namespace, props.name, 24);
      setEvents(data.events || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch swap history');
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    // Re-fetch when props change
    const _ns = props.namespace;
    const _name = props.name;
    setLoading(true);
    fetchHistory();
  });

  createPolling(
    () => `swap-history-${props.namespace}-${props.name}`,
    fetchHistory,
    30_000,
  );

  const displayed = () => showAll() ? events() : events().slice(0, 20);
  const groupName = () => events().length > 0 ? events()[0].group : null;

  return (
    <div class="mt-2 border-t border-white/5 pt-2">
      {/* Header */}
      <Show when={!loading() && events().length > 0}>
        <div class="px-1 pb-2 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-medium text-text-muted uppercase tracking-wider">
              Swap History
            </span>
            <span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-text-muted">
              {events().length} event{events().length !== 1 ? 's' : ''}
            </span>
          </div>
          <Show when={groupName()}>
            <span class="text-[10px] font-mono text-text-dim">
              {groupName()}
            </span>
          </Show>
        </div>
      </Show>

      {/* Loading state */}
      <Show when={loading()}>
        <div class="py-2 text-xs text-text-dim animate-pulse">Loading swap history...</div>
      </Show>

      {/* Error state */}
      <Show when={!loading() && error()}>
        <div class="py-2 text-xs text-status-error">{error()}</div>
      </Show>

      {/* Empty state */}
      <Show when={!loading() && !error() && events().length === 0}>
        <div class="py-2 text-xs text-text-dim">No swap events recorded</div>
      </Show>

      {/* Timeline entries */}
      <Show when={!loading() && !error() && events().length > 0}>
        <div class="space-y-1">
          <For each={displayed()}>
            {(event) => (
              <div class="flex items-start gap-2 py-1 px-1 text-xs">
                {/* State dot */}
                <div class={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotBgColor(event.newState)}`} />

                <div class="flex-1 min-w-0">
                  {/* Row 1: Transition + timestamp */}
                  <div class="flex items-center gap-2">
                    <span class="font-mono">
                      <span class={stateColor(event.oldState)}>{event.oldState}</span>
                      <span class="text-text-dim/50 mx-1">{'->'}</span>
                      <span class={`font-medium ${stateColor(event.newState)}`}>{event.newState}</span>
                    </span>
                    <Show when={event.durationSec != null && event.durationSec > 0}>
                      <span class="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-text-dim">
                        {formatDurationSec(event.durationSec)}
                      </span>
                    </Show>
                    <span class="text-text-dim/40 ml-auto flex-shrink-0">
                      {timeAgo(event.ts)}
                    </span>
                  </div>

                  {/* Row 2: Preempted-by info */}
                  <Show when={event.preemptedBy}>
                    <div class="text-text-dim/70 truncate">
                      Preempted by <span class="font-mono text-text-muted">{event.preemptedBy}</span>
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </For>
          <Show when={events().length > 20 && !showAll()}>
            <button
              class="text-xs text-text-dim hover:text-white mt-1"
              onClick={() => setShowAll(true)}
            >
              Show all {events().length} events
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default ModelSwapTimeline;
