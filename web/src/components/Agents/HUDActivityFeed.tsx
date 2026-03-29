import { Component, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import type { HUDTimelineEvent } from '../../lib/types';
import { hudApi } from '../../lib/api';
import {
  computeReconnectDelayMs,
  feedConnectionLabel,
  type FeedConnectionState,
} from './hudDegradedMode';

const HUDActivityFeed: Component<{
  initialEvents?: HUDTimelineEvent[];
  onConnectionStateChange?: (state: FeedConnectionState) => void;
  emptyMessage?: string;
  enabled?: boolean;
}> = (props) => {
  const [events, setEvents] = createSignal<HUDTimelineEvent[]>(props.initialEvents || []);
  const [connectionState, setConnectionState] = createSignal<FeedConnectionState>(props.enabled === false ? 'disabled' : 'connecting');

  // Merge initial events without replacing SSE events
  createEffect(() => {
    if (props.initialEvents && props.initialEvents.length > 0) {
      setEvents(prev => {
        if (prev.length === 0) return props.initialEvents!;
        // Merge: deduplicate by timestamp+agentId, keep newest first
        const seen = new Set(prev.map(e => `${e.timestamp}:${e.agentId}:${e.type}`));
        const newEvents = props.initialEvents!.filter(
          e => !seen.has(`${e.timestamp}:${e.agentId}:${e.type}`)
        );
        return [...prev, ...newEvents].slice(0, 50);
      });
    }
  });

  createEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let reconnectAttempts = 0;

    if (props.enabled === false) {
      setConnectionState('disabled');
      onCleanup(() => {
        clearTimeout(reconnectTimer);
        eventSource?.close();
        setConnectionState('disabled');
      });
      return;
    }

    const connect = () => {
      setConnectionState(reconnectAttempts > 0 ? 'stale' : 'connecting');
      const url = hudApi.eventsSSEUrl();
      eventSource = new EventSource(url);

      eventSource.onopen = () => {
        setConnectionState('live');
        reconnectAttempts = 0;
      };

      eventSource.onmessage = (e) => {
        try {
          const event: HUDTimelineEvent = JSON.parse(e.data);
          setEvents(prev => [event, ...prev].slice(0, 50));
        } catch {
          // Skip non-JSON messages
        }
      };

      eventSource.onerror = () => {
        setConnectionState('stale');
        eventSource?.close();
        // Exponential backoff with jitter: 2s base, capped at 30s.
        const delay = computeReconnectDelayMs(reconnectAttempts);
        reconnectAttempts++;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    onCleanup(() => {
      eventSource?.close();
      clearTimeout(reconnectTimer);
      setConnectionState('stale');
    });
  });

  createEffect(() => {
    props.onConnectionStateChange?.(connectionState());
  });

  const eventTypeColor = (type: string) => {
    switch (type) {
      case 'session_start': return 'text-status-ok';
      case 'session_end': return 'text-text-dim';
      case 'context_add': return 'text-neon-cyan';
      case 'task_update': return 'text-neon-purple';
      case 'file_claim': return 'text-yellow-400';
      case 'conflict': return 'text-status-error';
      case 'heartbeat': return 'text-text-dim';
      default: return 'text-text-muted';
    }
  };

  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString();
    } catch {
      return ts;
    }
  };

  return (
    <div class="glass-panel p-4">
      <div class="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 class="text-sm font-medium text-text-main">Live timeline</h3>
          <p class="text-[11px] text-text-dim">Events from heartbeats, claims, tasks, and workflows.</p>
        </div>
        <div class="flex items-center gap-2">
          <div class={`w-1.5 h-1.5 rounded-full ${
            connectionState() === 'live'
              ? 'bg-status-ok animate-pulse'
              : connectionState() === 'stale'
                ? 'bg-status-warn'
                : connectionState() === 'disabled'
                  ? 'bg-neon-cyan/70'
                : 'bg-white/30'
          }`} />
          <span class="text-[10px] text-text-dim">
            {feedConnectionLabel(connectionState())}
          </span>
        </div>
      </div>

      <Show when={events().length === 0}>
        <div class="rounded-lg border border-dashed border-white/10 bg-white/5 px-3 py-4 text-xs text-text-dim">
          {props.emptyMessage || 'No activity yet. The feed will populate as agents heartbeat, claim files, and advance tasks.'}
        </div>
      </Show>

      <div class="flex flex-col gap-0.5 max-h-80 overflow-y-auto">
        <For each={events()}>
          {(event) => (
            <div class="flex items-start gap-2 py-1.5 border-b border-white/5 last:border-0">
              <div class="w-1 h-1 rounded-full mt-1.5 bg-white/20 flex-shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class={`rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.16em] ${eventTypeColor(event.type)}`}>
                    {event.type}
                  </span>
                  <span class="text-[10px] text-text-dim font-mono">{event.agentId}</span>
                  <span class="text-[10px] text-text-dim ml-auto flex-shrink-0">{formatTime(event.timestamp)}</span>
                </div>
                <div class="text-xs text-text-muted truncate">{event.summary}</div>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default HUDActivityFeed;
