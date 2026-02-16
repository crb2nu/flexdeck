import { Component, createSignal, onMount, For, Show } from 'solid-js';
import { grafanaApi } from '../../lib/api';

interface Dashboard {
  uid: string;
  title: string;
  url: string;
  type: string;
  tags: string[];
  folderTitle?: string;
}

interface Panel {
  id: number;
  title: string;
  type: string;
  description?: string;
}

const GrafanaDashboards: Component = () => {
  const [dashboards, setDashboards] = createSignal<Dashboard[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [expandedUid, setExpandedUid] = createSignal<string | null>(null);
  const [panels, setPanels] = createSignal<Panel[]>([]);
  const [panelsLoading, setPanelsLoading] = createSignal(false);

  onMount(async () => {
    try {
      const data = await grafanaApi.dashboards();
      setDashboards(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboards');
    } finally {
      setLoading(false);
    }
  });

  const toggleDashboard = async (uid: string) => {
    if (expandedUid() === uid) {
      setExpandedUid(null);
      setPanels([]);
      return;
    }

    setExpandedUid(uid);
    setPanelsLoading(true);
    setPanels([]);

    try {
      const detail = await grafanaApi.dashboard(uid);
      const dashPanels: Panel[] = (detail?.dashboard?.panels || []).map(
        (p: any) => ({
          id: p.id,
          title: p.title || 'Untitled',
          type: p.type || 'unknown',
          description: p.description,
        }),
      );
      setPanels(dashPanels);
    } catch {
      setPanels([]);
    } finally {
      setPanelsLoading(false);
    }
  };

  return (
    <div class="flex flex-col gap-4">
      <Show when={error()}>
        <div class="glass-panel flex items-center gap-3 p-4 text-sm text-status-error border border-status-error/20">
          <span class="text-lg">!</span>
          {error()}
        </div>
      </Show>

      <Show when={loading()}>
        <div class="flex items-center justify-center py-12">
          <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
        </div>
      </Show>

      <Show when={!loading() && dashboards().length === 0 && !error()}>
        <div class="glass-panel p-8 text-center text-text-muted">
          <div class="text-lg mb-2">No Grafana Dashboards</div>
          <div class="text-sm text-text-dim">
            Configure GRAFANA_URL and GRAFANA_TOKEN to enable dashboard integration.
          </div>
        </div>
      </Show>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <For each={dashboards()}>
          {(dash) => (
            <div
              class={`glass-panel-hover flex flex-col p-4 cursor-pointer transition-all ${
                expandedUid() === dash.uid ? 'border-neon-cyan/30' : ''
              }`}
              onClick={() => toggleDashboard(dash.uid)}
            >
              <div class="flex items-start justify-between mb-2">
                <div class="flex-1 min-w-0">
                  <h3 class="text-sm font-medium text-text-main truncate">
                    {dash.title}
                  </h3>
                  <Show when={dash.folderTitle}>
                    <div class="text-[10px] text-text-dim mt-0.5">
                      {dash.folderTitle}
                    </div>
                  </Show>
                </div>
                <span class="text-[10px] text-text-dim ml-2 shrink-0">
                  {expandedUid() === dash.uid ? '[-]' : '[+]'}
                </span>
              </div>

              <Show when={dash.tags && dash.tags.length > 0}>
                <div class="flex flex-wrap gap-1 mb-2">
                  <For each={dash.tags}>
                    {(tag) => (
                      <span class="px-1.5 py-0.5 text-[10px] rounded bg-neon-purple/20 text-neon-purple">
                        {tag}
                      </span>
                    )}
                  </For>
                </div>
              </Show>

              {/* Expanded panel list */}
              <Show when={expandedUid() === dash.uid}>
                <div
                  class="mt-3 pt-3 border-t border-white/5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Show when={panelsLoading()}>
                    <div class="flex items-center gap-2 text-xs text-text-dim">
                      <div class="h-3 w-3 animate-spin rounded-full border border-white/10 border-t-neon-cyan" />
                      Loading panels...
                    </div>
                  </Show>

                  <Show when={!panelsLoading() && panels().length > 0}>
                    <div class="space-y-1.5">
                      <For each={panels()}>
                        {(panel) => (
                          <div class="flex items-center gap-2 px-2 py-1 rounded bg-white/5 text-xs">
                            <span class="text-neon-cyan font-mono">
                              {panel.type}
                            </span>
                            <span class="text-text-main truncate flex-1">
                              {panel.title}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>

                  <Show when={!panelsLoading() && panels().length === 0}>
                    <div class="text-xs text-text-dim">No panels found</div>
                  </Show>

                  <a
                    href={dash.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 mt-2 text-xs text-neon-cyan hover:text-neon-cyan/80 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open in Grafana
                    <span class="text-[10px]">&nearr;</span>
                  </a>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default GrafanaDashboards;
