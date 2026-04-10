import { Component, createSignal, createEffect, For, Show } from 'solid-js';
import { modelsApi } from '../../lib/api';
import type { ModelEvent } from '../../lib/types';
import { formatRelativeTime } from '../../lib/format';

const ModelEventsTimeline: Component<{ namespace: string; name: string }> = (props) => {
  const [events, setEvents] = createSignal<ModelEvent[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [showAll, setShowAll] = createSignal(false);

  const fetchEvents = async () => {
    try {
      const data = await modelsApi.crdEvents(props.namespace, props.name);
      setEvents(data.events || []);
    } catch (err) {
      console.warn('Failed to fetch model events:', err);
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    // Re-fetch when props change
    const _ns = props.namespace;
    const _name = props.name;
    setLoading(true);
    fetchEvents();
  });

  const displayed = () => showAll() ? events() : events().slice(0, 20);

  return (
    <div class="mt-2 border-t border-white/5 pt-2">
      <Show when={loading()}>
        <div class="py-2 text-xs text-text-dim animate-pulse">Loading events...</div>
      </Show>
      <Show when={!loading() && events().length === 0}>
        <div class="py-2 text-xs text-text-dim">No events found</div>
      </Show>
      <Show when={!loading() && events().length > 0}>
        <div class="space-y-1">
          <For each={displayed()}>
            {(event) => (
              <div class="flex items-start gap-2 py-1 px-1 text-xs">
                <div class={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  event.type === 'Warning' ? 'bg-status-error' : 'bg-status-ok'
                }`} />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <span class={`font-mono font-medium ${
                      event.type === 'Warning' ? 'text-status-error' : 'text-text-dim'
                    }`}>
                      {event.reason}
                    </span>
                    <Show when={event.count > 1}>
                      <span class="text-text-dim/50">x{event.count}</span>
                    </Show>
                    <span class="text-text-dim/40 ml-auto flex-shrink-0">
                      {formatRelativeTime(event.lastTimestamp)}
                    </span>
                  </div>
                  <div class="text-text-dim/70 truncate">{event.message}</div>
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

export default ModelEventsTimeline;
