import { Component, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import type { HUDTimelineEvent } from '../../lib/types';
import { hudApi } from '../../lib/api';

const HUDActivityFeed: Component<{ initialEvents?: HUDTimelineEvent[] }> = (props) => {
  const [events, setEvents] = createSignal<HUDTimelineEvent[]>(props.initialEvents || []);
  const [connected, setConnected] = createSignal(false);

  createEffect(() => {
    if (props.initialEvents && props.initialEvents.length > 0) {
      setEvents(props.initialEvents);
    }
  });

  createEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const url = hudApi.eventsSSEUrl();
      eventSource = new EventSource(url);

      eventSource.onopen = () => setConnected(true);

      eventSource.onmessage = (e) => {
        try {
          const event: HUDTimelineEvent = JSON.parse(e.data);
          setEvents(prev => [event, ...prev].slice(0, 50));
        } catch {
          // Skip non-JSON messages
        }
      };

      eventSource.onerror = () => {
        setConnected(false);
        eventSource?.close();
        // Reconnect after 5 seconds
        reconnectTimer = setTimeout(connect, 5000);
      };
    };

    connect();

    onCleanup(() => {
      eventSource?.close();
      clearTimeout(reconnectTimer);
    });
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
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-medium text-text-main">Activity Feed</h3>
        <div class="flex items-center gap-2">
          <div class={`w-1.5 h-1.5 rounded-full ${connected() ? 'bg-status-ok animate-pulse' : 'bg-white/30'}`} />
          <span class="text-[10px] text-text-dim">{connected() ? 'Live' : 'Connecting...'}</span>
        </div>
      </div>

      <Show when={events().length === 0}>
        <div class="text-xs text-text-dim py-4 text-center">No activity events yet</div>
      </Show>

      <div class="flex flex-col gap-0.5 max-h-80 overflow-y-auto">
        <For each={events()}>
          {(event) => (
            <div class="flex items-start gap-2 py-1.5 border-b border-white/5 last:border-0">
              <div class="w-1 h-1 rounded-full mt-1.5 bg-white/20 flex-shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class={`text-[10px] font-mono ${eventTypeColor(event.type)}`}>{event.type}</span>
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
