import { Component, createMemo, createSignal, onMount, For, Show } from 'solid-js';
import { grafanaApi, prom } from '../../lib/api';
import Sparkline from '../shared/Sparkline';

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
  datasource?: string;
  queryPreview?: string;
  queryExpr?: string;
  section?: string;
}

interface PanelLiveData {
  state: 'loading' | 'ready' | 'unsupported' | 'error';
  value?: number;
  series?: number[];
  message?: string;
}

function extractDatasourceName(datasource: unknown): string | undefined {
  if (typeof datasource === 'string' && datasource.trim()) {
    return datasource;
  }
  if (datasource && typeof datasource === 'object') {
    const source = datasource as Record<string, unknown>;
    const name = source.name;
    if (typeof name === 'string' && name.trim()) return name;
    const uid = source.uid;
    if (typeof uid === 'string' && uid.trim()) return uid;
    const typ = source.type;
    if (typeof typ === 'string' && typ.trim()) return typ;
  }
  return undefined;
}

function extractQueryPreview(panel: Record<string, any>): string | undefined {
  const targets = Array.isArray(panel.targets) ? panel.targets : [];
  for (const target of targets) {
    if (!target || typeof target !== 'object') continue;
    const candidate =
      target.expr ||
      target.query ||
      target.rawSql ||
      target.lucene ||
      target.target ||
      target.measurement;
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function extractPromExpr(panel: Record<string, any>): string | undefined {
  const targets = Array.isArray(panel.targets) ? panel.targets : [];
  for (const target of targets) {
    if (!target || typeof target !== 'object') continue;
    const candidate = target.expr || target.query;
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function normalizePromExpr(expr: string): string {
  let normalized = expr;
  const replacements: Record<string, string> = {
    '$__rate_interval': '5m',
    '$__interval': '1m',
    '$__interval_ms': '60000',
    '$__range': '1h',
    '$__range_s': '3600',
  };
  for (const [token, value] of Object.entries(replacements)) {
    normalized = normalized.split(token).join(value);
  }
  return normalized;
}

function parsePromSeries(payload: any): number[] {
  const results = payload?.data?.result;
  if (!Array.isArray(results) || results.length === 0) return [];

  let selected: any = null;
  let selectedLen = -1;
  for (const result of results) {
    const values = Array.isArray(result?.values) ? result.values : [];
    if (values.length > selectedLen) {
      selected = result;
      selectedLen = values.length;
    }
  }

  const values = Array.isArray(selected?.values) ? selected.values : [];
  const series = values
    .map((point: any) => Number.parseFloat(point?.[1] ?? ''))
    .filter((n: number) => Number.isFinite(n));

  return series;
}

function parsePromInstantValue(payload: any): number | undefined {
  const results = payload?.data?.result;
  if (!Array.isArray(results) || results.length === 0) return undefined;

  const value = Number.parseFloat(results[0]?.value?.[1] ?? '');
  return Number.isFinite(value) ? value : undefined;
}

function formatMetricValue(value?: number): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  const abs = Math.abs(value);
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function flattenPanels(rawPanels: any[], section?: string): Panel[] {
  if (!Array.isArray(rawPanels)) return [];

  const flat: Panel[] = [];

  for (const panel of rawPanels) {
    if (!panel || typeof panel !== 'object') continue;

    const panelTitle =
      typeof panel.title === 'string' && panel.title.trim()
        ? panel.title.trim()
        : 'Untitled';
    const panelType =
      typeof panel.type === 'string' && panel.type.trim()
        ? panel.type.trim()
        : 'unknown';

    // Grafana row panels can nest child panels under `panels`, including collapsed rows.
    if (panelType === 'row') {
      const rowSection = section ? `${section} / ${panelTitle}` : panelTitle;
      const rowChildren = flattenPanels(panel.panels || [], rowSection);
      flat.push(...rowChildren);
      continue;
    }

    flat.push({
      id: typeof panel.id === 'number' ? panel.id : -1,
      title: panelTitle,
      type: panelType,
      description:
        typeof panel.description === 'string' ? panel.description : undefined,
      datasource: extractDatasourceName(panel.datasource),
      queryPreview: extractQueryPreview(panel),
      section,
    });
  }

  return flat;
}

const GrafanaDashboards: Component = () => {
  const [dashboards, setDashboards] = createSignal<Dashboard[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [expandedUid, setExpandedUid] = createSignal<string | null>(null);
  const [panels, setPanels] = createSignal<Panel[]>([]);
  const [panelsLoading, setPanelsLoading] = createSignal(false);
  const [liveDataByPanel, setLiveDataByPanel] = createSignal<
    Record<string, PanelLiveData>
  >({});
  let liveFetchGeneration = 0;
  const panelSummary = createMemo(() => {
    const list = panels();
    return {
      total: list.length,
      sections: new Set(list.map((panel) => panel.section).filter(Boolean)).size,
      datasources: new Set(list.map((panel) => panel.datasource).filter(Boolean)).size,
    };
  });

  const sanitizeError = (msg: string) => {
    if (!msg) return '';
    // Client-side safety: if it looks like HTML, don't show the raw tags
    if (msg.toLowerCase().includes('<!doctype') || msg.toLowerCase().includes('<html')) {
      return 'Received an invalid response from the server (HTML instead of JSON). Please check your Grafana configuration.';
    }
    return msg;
  };

  const panelKey = (panel: Panel) => `${panel.id}:${panel.title}`;

  const loadLivePanelData = async (nextPanels: Panel[]) => {
    const generation = ++liveFetchGeneration;
    const liveState: Record<string, PanelLiveData> = {};

    const candidates = nextPanels
      .filter((panel) => typeof panel.queryExpr === 'string' && panel.queryExpr.trim().length > 0)
      .slice(0, 24);

    for (const panel of nextPanels) {
      const key = panelKey(panel);
      if (!panel.queryExpr) {
        liveState[key] = { state: 'unsupported', message: 'No query on panel' };
        continue;
      }

      const normalized = normalizePromExpr(panel.queryExpr);
      if (normalized.includes('$')) {
        liveState[key] = {
          state: 'unsupported',
          message: 'Templated query variable not resolvable here',
        };
        continue;
      }

      liveState[key] = { state: 'loading' };
    }
    setLiveDataByPanel(liveState);

    const now = Math.floor(Date.now() / 1000);
    const start = now - 3600;
    const end = now;
    const step = '120';

    await Promise.all(
      candidates.map(async (panel) => {
        const key = panelKey(panel);
        const expr = normalizePromExpr(panel.queryExpr || '');
        if (!expr || expr.includes('$')) return;

        try {
          const range = await prom.queryRange(expr, start, end, step);
          const series = parsePromSeries(range);
          let value =
            series.length > 0 ? series[series.length - 1] : undefined;

          if (value == null) {
            const instant = await prom.query(expr);
            value = parsePromInstantValue(instant);
          }

          if (generation !== liveFetchGeneration) return;
          setLiveDataByPanel((current) => ({
            ...current,
            [key]: { state: 'ready', value, series },
          }));
        } catch (err) {
          if (generation !== liveFetchGeneration) return;
          setLiveDataByPanel((current) => ({
            ...current,
            [key]: {
              state: 'error',
              message:
                err instanceof Error ? err.message : 'Live query failed',
            },
          }));
        }
      }),
    );
  };

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
      setLiveDataByPanel({});
      liveFetchGeneration++;
      return;
    }

    setExpandedUid(uid);
    setPanelsLoading(true);
    setPanels([]);
    setLiveDataByPanel({});

    try {
      const detail = await grafanaApi.dashboard(uid);
      const dashPanels: Panel[] = flattenPanels(detail?.dashboard?.panels || []);
      setPanels(dashPanels);
      void loadLivePanelData(dashPanels);
    } catch {
      setPanels([]);
      setLiveDataByPanel({});
    } finally {
      setPanelsLoading(false);
    }
  };

  return (
    <div class="flex flex-col gap-4">
      <Show when={error()}>
        <div class="glass-panel flex flex-col gap-2 p-4 text-sm text-status-error border border-status-error/20">
          <div class="flex items-center gap-3">
            <span class="text-lg font-bold">!</span>
            <span class="font-bold uppercase tracking-widest">Connection Error</span>
          </div>
          <div class="font-mono text-xs opacity-80 break-all max-h-[100px] overflow-y-auto bg-black/20 p-2 rounded">
            {sanitizeError(error())}
          </div>
        </div>
      </Show>

      <Show when={loading()}>
        <div class="flex items-center justify-center py-12">
          <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
        </div>
      </Show>

      <Show when={!loading() && dashboards().length === 0 && !error()}>
        <div class="glass-panel p-8 text-center text-text-muted">
          <div class="text-lg mb-2 text-text-main">No Grafana Dashboards</div>
          <p class="text-sm text-text-dim max-w-md mx-auto">
            Ensure GRAFANA_URL is reachable and anonymous access or GRAFANA_TOKEN is correctly configured.
          </p>
        </div>
      </Show>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <For each={dashboards()}>
          {(dash) => (
            <div
              class={`glass-panel-hover flex flex-col p-4 cursor-pointer transition-all ${
                expandedUid() === dash.uid
                  ? 'border-neon-cyan/30 md:col-span-2 xl:col-span-3'
                  : ''
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
                    <div class="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-wider text-text-dim">
                      <span>{panelSummary().total} panels</span>
                      <Show when={panelSummary().sections > 0}>
                        <span>{panelSummary().sections} sections</span>
                      </Show>
                      <Show when={panelSummary().datasources > 0}>
                        <span>{panelSummary().datasources} datasources</span>
                      </Show>
                    </div>
                    <div class="max-h-[32rem] overflow-y-auto pr-1">
                      <div class="grid grid-cols-1 gap-1.5 lg:grid-cols-2 2xl:grid-cols-3">
                        <For each={panels()}>
                          {(panel) => (
                            <div class="rounded bg-white/5 px-2 py-1.5 text-xs">
                              <div class="flex items-center gap-2">
                                <span class="text-neon-cyan font-mono">
                                  {panel.type}
                                </span>
                                <span class="text-text-main truncate flex-1 font-medium">
                                  {panel.title}
                                </span>
                                <span class="text-[10px] text-text-dim">
                                  #{panel.id}
                                </span>
                              </div>

                              <Show when={panel.section || panel.datasource}>
                                <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-dim">
                                  <Show when={panel.section}>
                                    <span class="rounded bg-white/5 px-1.5 py-0.5">
                                      {panel.section}
                                    </span>
                                  </Show>
                                  <Show when={panel.datasource}>
                                    <span class="rounded bg-neon-purple/10 px-1.5 py-0.5 text-neon-purple">
                                      ds: {panel.datasource}
                                    </span>
                                  </Show>
                                </div>
                              </Show>

                              <Show when={panel.description}>
                                <div class="mt-1 text-[11px] text-text-dim">
                                  {panel.description}
                                </div>
                              </Show>

                              <Show when={panel.queryPreview}>
                                <pre class="mt-1 max-h-24 overflow-auto rounded bg-black/30 p-1.5 font-mono text-[10px] text-text-dim">
                                  {panel.queryPreview}
                                </pre>
                              </Show>

                              <Show when={liveDataByPanel()[panelKey(panel)]}>
                                {(live) => (
                                  <div class="mt-1.5 border-t border-white/5 pt-1.5">
                                    <Show when={live().state === 'ready'}>
                                      <div class="flex items-end justify-between gap-2">
                                        <span class="text-base font-semibold tabular-nums text-neon-cyan">
                                          {formatMetricValue(live().value)}
                                        </span>
                                        <Show when={(live().series?.length || 0) > 1}>
                                          <Sparkline
                                            data={live().series || []}
                                            width={110}
                                            height={24}
                                            color="#22d3ee"
                                          />
                                        </Show>
                                      </div>
                                    </Show>
                                    <Show when={live().state === 'loading'}>
                                      <div class="text-[10px] text-text-dim">
                                        Loading live stats...
                                      </div>
                                    </Show>
                                    <Show when={live().state === 'unsupported'}>
                                      <div class="text-[10px] text-text-dim">
                                        {live().message || 'Live preview unavailable'}
                                      </div>
                                    </Show>
                                    <Show when={live().state === 'error'}>
                                      <div class="text-[10px] text-status-error">
                                        {live().message || 'Live query failed'}
                                      </div>
                                    </Show>
                                  </div>
                                )}
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
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
