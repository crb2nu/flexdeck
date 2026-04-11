import { Component, createMemo, createSignal, For, Show } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { k8s } from '../../lib/api';
import { stablePanelStatusClasses, useStablePanelState } from '../shared/useStablePanelState';

interface K8sEvent {
  metadata: { name: string; namespace: string; creationTimestamp: string };
  involvedObject: { kind: string; name: string; namespace?: string };
  reason: string;
  message: string;
  type: string; // "Normal" | "Warning"
  lastTimestamp?: string;
  count?: number;
}

const POLL_INTERVAL = 30_000;

const EventsFeed: Component = () => {
  const [events, setEvents] = createSignal<K8sEvent[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const stablePanel = useStablePanelState({
    value: events,
    loading,
    error,
    signature: (items) =>
      items.map((evt) => `${evt.metadata?.name}:${evt.count ?? 0}:${evt.lastTimestamp || evt.metadata?.creationTimestamp || ''}`).join('|'),
  });
  const displayEvents = createMemo(() => stablePanel.effectiveValue());

  const fetchEvents = async () => {
    try {
      const data = await k8s.getEvents(undefined, 15);
      setEvents(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  createPolling('dash-events', fetchEvents, POLL_INTERVAL);

  const typeColor = (type: string) =>
    type === 'Warning' ? 'text-yellow-400' : 'text-text-dim';

  const typeDot = (type: string) =>
    type === 'Warning' ? 'bg-yellow-500' : 'bg-white/30';

  const timeAgo = (ts?: string) => {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
    return `${Math.floor(diff / 86_400_000)}d`;
  };

  return (
    <div class="surface flex flex-col overflow-hidden" style={{ 'max-height': '280px' }}>
      <div class="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div class="flex items-center gap-2">
          <span class="text-xs text-text-dim">⚡</span>
          <span class="text-xs font-mono text-text-main uppercase tracking-wider">Cluster Events</span>
          <Show when={stablePanel.status()}>
            {(status) => (
              <span class={`rounded-full border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider ${stablePanelStatusClasses(status())}`}>
                {status()}
              </span>
            )}
          </Show>
        </div>
        <span class="text-[10px] text-text-dim">{displayEvents().length} recent</span>
      </div>

      <div class={`relative flex-1 overflow-y-auto transition-opacity duration-300 ${stablePanel.isRefreshing() ? 'opacity-90' : 'opacity-100'}`}>
        <div class={`pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20 transition-opacity duration-150 ${stablePanel.isRefreshing() ? 'opacity-100' : 'opacity-0'}`} />
        <Show
          when={!stablePanel.showBlockingLoading()}
          fallback={
            <div class="flex items-center justify-center py-6">
              <span class="text-xs text-text-dim animate-pulse">Loading events...</span>
            </div>
          }
        >
          <Show when={stablePanel.showBlockingError()}>
            <div class="px-3 py-2 text-xs text-red-400">{error()}</div>
          </Show>

          <Show when={error() && stablePanel.hasStableValue()}>
            <div class="px-3 py-2 text-[10px] text-status-warn/90 border-b border-status-warn/10 bg-status-warn/5">
              Event refresh delayed. Showing last good snapshot.
            </div>
          </Show>

          <Show
            when={displayEvents().length > 0}
            fallback={
              <div class="px-3 py-4 text-center text-xs text-text-dim">No recent events</div>
            }
          >
            <div class="divide-y divide-white/5">
              <For each={displayEvents()}>
                {(evt) => (
                  <div class="px-3 py-2 hover:bg-white/[0.02] transition-colors group">
                    <div class="flex items-start gap-2">
                      <span class={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${typeDot(evt.type)}`} />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-1.5 mb-0.5">
                          <span class={`text-[10px] font-mono ${typeColor(evt.type)}`}>
                            {evt.reason}
                          </span>
                          <span class="text-[10px] text-text-dim">·</span>
                          <span class="text-[10px] text-text-dim font-mono">
                            {evt.involvedObject?.kind}/{evt.involvedObject?.name}
                          </span>
                          <Show when={evt.count && evt.count > 1}>
                            <span class="text-[9px] text-text-dim ml-auto">×{evt.count}</span>
                          </Show>
                        </div>
                        <p class="text-[11px] text-text-muted truncate group-hover:whitespace-normal group-hover:break-words">
                          {evt.message}
                        </p>
                      </div>
                      <span class="text-[9px] text-text-dim ml-1 flex-shrink-0 whitespace-nowrap">
                        {timeAgo(evt.lastTimestamp || evt.metadata?.creationTimestamp)}
                      </span>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default EventsFeed;
