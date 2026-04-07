import { batch, Component, createMemo, createResource, createSignal, For, Show } from 'solid-js';
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
  resolution?: 'direct' | 'templated' | 'fallback';
  value?: number;
  series?: number[];
  message?: string;
}

interface ResolvedPromExpr {
  expr: string;
  unresolvedVars: string[];
  resolution: 'direct' | 'templated' | 'fallback';
}

interface DashboardCacheEntry {
  panels: Panel[];
  templateVars: Record<string, string>;
  liveDataByPanel: Record<string, PanelLiveData>;
  detailFetchedAt: number;
  liveFetchedAt: number;
}

interface DashboardListState {
  dashboards: Dashboard[];
  error: string;
}

const DASHBOARD_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const DASHBOARD_LIVE_CACHE_TTL_MS = 60 * 1000;
const MAX_LIVE_PANEL_QUERIES = 24;

function isPrometheusDatasourceName(name?: string): boolean {
  if (!name) return true; // Treat inherited/default datasource as potentially Prometheus.
  const normalized = name.toLowerCase();
  return (
    normalized.includes('prom') ||
    normalized.includes('mimir') ||
    normalized.includes('thanos')
  );
}

function looksLikePromExpr(expr?: string): boolean {
  if (!expr) return false;
  const trimmed = expr.trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();

  // Avoid obvious non-PromQL query languages.
  if (
    lowered.includes('select ') ||
    lowered.includes(' from ') ||
    lowered.includes(' where ') ||
    lowered.includes('| json') ||
    lowered.includes('|=') ||
    lowered.includes('lucene')
  ) {
    return false;
  }

  return (
    /[a-zA-Z_:][a-zA-Z0-9_:]*/.test(trimmed) &&
    (trimmed.includes('{') ||
      trimmed.includes('(') ||
      trimmed.includes('[') ||
      trimmed.includes('_total') ||
      trimmed.includes('_seconds'))
  );
}

function collectTemplateTokens(expr: string): string[] {
  const tokens: string[] = [];
  const tokenRegex = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}|\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let match: RegExpExecArray | null = null;
  while ((match = tokenRegex.exec(expr)) !== null) {
    const token = match[1] || match[2];
    if (token) tokens.push(token);
  }
  return tokens;
}

function normalizeTemplateValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => (item == null ? '' : String(item).trim()))
      .filter(Boolean);
    if (normalized.length === 0) return undefined;
    if (normalized.some((item) => item === '$__all' || item === 'All')) return '.*';
    return normalized.length === 1 ? normalized[0] : normalized.join('|');
  }
  if (value == null) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (text === '$__all' || text === 'All') return '.*';
  return text;
}

function extractTemplateVariables(dashboard: Record<string, any>): Record<string, string> {
  const templatingList = Array.isArray(dashboard?.templating?.list)
    ? dashboard.templating.list
    : [];
  const values: Record<string, string> = {};

  for (const variable of templatingList) {
    if (!variable || typeof variable !== 'object') continue;
    const name = typeof variable.name === 'string' ? variable.name.trim() : '';
    if (!name) continue;

    const current = variable.current;
    let normalized = normalizeTemplateValue(current?.value);
    if (!normalized) normalized = normalizeTemplateValue(current?.text);

    if (!normalized && Array.isArray(variable.options)) {
      const selected =
        variable.options.find((opt: any) => opt?.selected) || variable.options[0];
      normalized = normalizeTemplateValue(selected?.value) || normalizeTemplateValue(selected?.text);
    }

    if (normalized && !normalized.includes('$')) {
      values[name] = normalized;
    }
  }

  return values;
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

function replaceTemplateToken(expr: string, token: string, value: string): string {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const curly = new RegExp(`\\$\\{${escapedToken}\\}`, 'g');
  const plain = new RegExp(`\\$${escapedToken}(?![a-zA-Z0-9_])`, 'g');
  return expr.replace(curly, () => value).replace(plain, () => value);
}

function fallbackTemplateToken(expr: string, token: string): string {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tokenPattern = `\\$\\{?${escapedToken}\\}?`;

  const doubleQuotedMatcher = new RegExp(
    `([a-zA-Z_:][a-zA-Z0-9_:]*)\\s*(=|=~|!=|!~)\\s*"${tokenPattern}"`,
    'g',
  );
  const singleQuotedMatcher = new RegExp(
    `([a-zA-Z_:][a-zA-Z0-9_:]*)\\s*(=|=~|!=|!~)\\s*'${tokenPattern}'`,
    'g',
  );
  const bareToken = new RegExp(tokenPattern, 'g');

  return expr
    .replace(doubleQuotedMatcher, (_m, label) => `${label}=~".*"`)
    .replace(singleQuotedMatcher, (_m, label) => `${label}=~".*"`)
    .replace(bareToken, '.*');
}

function resolvePromExpr(
  rawExpr: string,
  templateVars: Record<string, string>,
): ResolvedPromExpr {
  let expr = normalizePromExpr(rawExpr);
  const tokens = Array.from(new Set(collectTemplateTokens(expr))).filter(
    (token) => !token.startsWith('__'),
  );

  let usedTemplated = false;
  let usedFallback = false;

  for (const token of tokens) {
    const replacement = templateVars[token];
    if (replacement) {
      expr = replaceTemplateToken(expr, token, replacement);
      usedTemplated = true;
      continue;
    }
    expr = fallbackTemplateToken(expr, token);
    usedFallback = true;
  }

  const unresolvedVars = Array.from(
    new Set(collectTemplateTokens(expr).filter((token) => !token.startsWith('__'))),
  );

  return {
    expr,
    unresolvedVars,
    resolution: usedFallback ? 'fallback' : usedTemplated ? 'templated' : 'direct',
  };
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

function resolutionBadgeLabel(resolution?: PanelLiveData['resolution']): string | undefined {
  switch (resolution) {
    case 'direct':
      return 'direct';
    case 'templated':
      return 'templated';
    case 'fallback':
      return 'fallback';
    default:
      return undefined;
  }
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

    const datasource = extractDatasourceName(panel.datasource);
    const queryPreview = extractQueryPreview(panel);
    const rawExpr = extractPromExpr(panel);
    const queryExpr = looksLikePromExpr(rawExpr)
      ? rawExpr
      : looksLikePromExpr(queryPreview)
        ? queryPreview
        : undefined;

    flat.push({
      id: typeof panel.id === 'number' ? panel.id : -1,
      title: panelTitle,
      type: panelType,
      description:
        typeof panel.description === 'string' ? panel.description : undefined,
      datasource,
      queryPreview,
      queryExpr,
      section,
    });
  }

  return flat;
}

const GrafanaDashboards: Component = () => {
  const [dashboardsResource] = createResource<DashboardListState>(async () => {
    try {
      const data = await grafanaApi.dashboards();
      return {
        dashboards: data || [],
        error: '',
      };
    } catch (err) {
      return {
        dashboards: [],
        error: err instanceof Error ? err.message : 'Failed to load dashboards',
      };
    }
  });
  const [expandedUid, setExpandedUid] = createSignal<string | null>(null);
  const [panels, setPanels] = createSignal<Panel[]>([]);
  const [panelsLoading, setPanelsLoading] = createSignal(false);
  const [templateVars, setTemplateVars] = createSignal<Record<string, string>>({});
  const [liveDataByPanel, setLiveDataByPanel] = createSignal<
    Record<string, PanelLiveData>
  >({});
  const [dashboardCache, setDashboardCache] = createSignal<Record<string, DashboardCacheEntry>>({});
  let liveFetchGeneration = 0;
  let detailFetchGeneration = 0;
  const panelSummary = createMemo(() => {
    const list = panels();
    return {
      total: list.length,
      sections: new Set(list.map((panel) => panel.section).filter(Boolean)).size,
      datasources: new Set(list.map((panel) => panel.datasource).filter(Boolean)).size,
    };
  });
  const templateVarEntries = createMemo(() => Object.entries(templateVars()));
  const liveSummary = createMemo(() => {
    const values = Object.values(liveDataByPanel());
    return {
      tracked: values.length,
      ready: values.filter((value) => value.state === 'ready').length,
      loading: values.filter((value) => value.state === 'loading').length,
      unsupported: values.filter((value) => value.state === 'unsupported').length,
      error: values.filter((value) => value.state === 'error').length,
    };
  });
  const dashboards = createMemo(() => dashboardsResource()?.dashboards || []);
  const loading = () => dashboardsResource.loading;
  const error = () => dashboardsResource()?.error || '';

  const sanitizeError = (msg: string) => {
    if (!msg) return '';
    // Client-side safety: if it looks like HTML, don't show the raw tags
    if (msg.toLowerCase().includes('<!doctype') || msg.toLowerCase().includes('<html')) {
      return 'Received an invalid response from the server (HTML instead of JSON). Please check your Grafana configuration.';
    }
    return msg;
  };

  const panelKey = (panel: Panel) => `${panel.id}:${panel.title}`;

  const applyExpandedDashboardState = (
    nextPanels: Panel[],
    resolvedTemplateVars: Record<string, string>,
    nextLiveDataByPanel: Record<string, PanelLiveData>,
  ) => {
    batch(() => {
      setPanels(nextPanels);
      setTemplateVars(resolvedTemplateVars);
      setLiveDataByPanel(nextLiveDataByPanel);
    });
  };

  const resetExpandedDashboardState = () => {
    applyExpandedDashboardState([], {}, {});
  };

  const loadLivePanelData = async (
    uid: string,
    nextPanels: Panel[],
    resolvedTemplateVars: Record<string, string>,
  ) => {
    const generation = ++liveFetchGeneration;
    const liveState: Record<string, PanelLiveData> = {};
    const resolvedExprByPanelKey: Record<string, string> = {};

    for (const panel of nextPanels) {
      const key = panelKey(panel);
      if (!panel.queryExpr) {
        const hasAnyQuery = typeof panel.queryPreview === 'string' && panel.queryPreview.trim().length > 0;
        liveState[key] = {
          state: 'unsupported',
          message: hasAnyQuery
            ? 'Unsupported query language for live preview (PromQL only)'
            : 'Live preview unavailable for this panel type',
        };
        continue;
      }

      if (!isPrometheusDatasourceName(panel.datasource)) {
        liveState[key] = {
          state: 'unsupported',
          message: 'Live preview currently supports Prometheus datasource panels',
        };
        continue;
      }

      const resolved = resolvePromExpr(panel.queryExpr, resolvedTemplateVars);
      if (resolved.unresolvedVars.length > 0) {
        liveState[key] = {
          state: 'unsupported',
          message: `Unresolved variables: ${resolved.unresolvedVars.join(', ')}`,
        };
        continue;
      }

      resolvedExprByPanelKey[key] = resolved.expr;
      liveState[key] = {
        state: 'loading',
        resolution: resolved.resolution,
        message:
          resolved.resolution === 'fallback'
            ? 'Auto-resolved variables using wildcard fallback'
            : undefined,
      };
    }
    setLiveDataByPanel(liveState);

    const candidates = nextPanels
      .filter((panel) => liveState[panelKey(panel)]?.state === 'loading')
      .slice(0, MAX_LIVE_PANEL_QUERIES);

    if (candidates.length === 0) {
      setDashboardCache((current) => ({
        ...current,
        [uid]: {
          panels: nextPanels,
          templateVars: resolvedTemplateVars,
          liveDataByPanel: liveState,
          detailFetchedAt: current[uid]?.detailFetchedAt || Date.now(),
          liveFetchedAt: Date.now(),
        },
      }));
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const start = now - 3600;
    const end = now;
    const step = '120';

    await Promise.all(
      candidates.map(async (panel) => {
        const key = panelKey(panel);
        const expr = resolvedExprByPanelKey[key] || '';
        if (!expr || expr.includes('$')) return;
        const resolution = liveState[key]?.resolution;

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
          liveState[key] = { state: 'ready', value, series, resolution };
        } catch (err) {
          if (generation !== liveFetchGeneration) return;
          liveState[key] = {
            state: 'error',
            resolution,
            message:
              err instanceof Error ? err.message : 'Live query failed',
          };
        }
      }),
    );

    if (generation !== liveFetchGeneration) return;
    setLiveDataByPanel({ ...liveState });
    const fetchedAt = Date.now();
    setDashboardCache((current) => ({
      ...current,
      [uid]: {
        panels: nextPanels,
        templateVars: resolvedTemplateVars,
        liveDataByPanel: { ...liveState },
        detailFetchedAt: current[uid]?.detailFetchedAt || fetchedAt,
        liveFetchedAt: fetchedAt,
      },
    }));
  };

  const toggleDashboard = async (uid: string) => {
    if (expandedUid() === uid) {
      setExpandedUid(null);
      resetExpandedDashboardState();
      liveFetchGeneration++;
      return;
    }

    const now = Date.now();
    const cached = dashboardCache()[uid];
    const hasFreshDetail =
      cached && now - cached.detailFetchedAt < DASHBOARD_DETAIL_CACHE_TTL_MS;
    const hasFreshLive =
      cached && now - cached.liveFetchedAt < DASHBOARD_LIVE_CACHE_TTL_MS;

    setExpandedUid(uid);
    if (cached) {
      applyExpandedDashboardState(cached.panels, cached.templateVars, cached.liveDataByPanel);
    } else {
      resetExpandedDashboardState();
    }

    if (hasFreshDetail) {
      setPanelsLoading(false);
      if (!hasFreshLive) {
        void loadLivePanelData(uid, cached.panels, cached.templateVars);
      }
      return;
    }

    const detailGeneration = ++detailFetchGeneration;
    setPanelsLoading(true);

    try {
      const detail = await grafanaApi.dashboard(uid);
      if (detailGeneration !== detailFetchGeneration || expandedUid() !== uid) return;
      const dashPanels: Panel[] = flattenPanels(detail?.dashboard?.panels || []);
      const resolvedTemplateVars = extractTemplateVariables(detail?.dashboard || {});
      applyExpandedDashboardState(dashPanels, resolvedTemplateVars, {});
      setDashboardCache((current) => ({
        ...current,
        [uid]: {
          panels: dashPanels,
          templateVars: resolvedTemplateVars,
          liveDataByPanel: current[uid]?.liveDataByPanel || {},
          detailFetchedAt: Date.now(),
          liveFetchedAt: current[uid]?.liveFetchedAt || 0,
        },
      }));
      void loadLivePanelData(uid, dashPanels, resolvedTemplateVars);
    } catch {
      if (detailGeneration !== detailFetchGeneration || expandedUid() !== uid) return;
      resetExpandedDashboardState();
    } finally {
      if (detailGeneration === detailFetchGeneration && expandedUid() === uid) {
        setPanelsLoading(false);
      }
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
                      <Show when={liveSummary().tracked > 0}>
                        <span class="text-neon-cyan">{liveSummary().ready} live</span>
                        <span>{liveSummary().loading} loading</span>
                        <Show when={liveSummary().unsupported > 0}>
                          <span>{liveSummary().unsupported} skipped</span>
                        </Show>
                        <Show when={liveSummary().error > 0}>
                          <span class="text-status-error">{liveSummary().error} errors</span>
                        </Show>
                      </Show>
                    </div>
                    <Show when={templateVarEntries().length > 0}>
                      <div class="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-text-dim">
                        <span class="uppercase tracking-wider">vars</span>
                        <For each={templateVarEntries()}>
                          {(entry) => (
                            <span class="rounded bg-neon-cyan/10 px-1.5 py-0.5 text-neon-cyan">
                              {entry[0]}={entry[1]}
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>
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
                                        <div class="flex items-end gap-2">
                                          <span class="text-base font-semibold tabular-nums text-neon-cyan">
                                            {formatMetricValue(live().value)}
                                          </span>
                                          <Show when={live().resolution}>
                                            <span class="rounded bg-status-warn/10 px-1 py-0.5 text-[9px] uppercase tracking-wider text-status-warn">
                                              {resolutionBadgeLabel(live().resolution)}
                                            </span>
                                          </Show>
                                        </div>
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
                                      <div class="flex items-center gap-1.5 text-[10px] text-text-dim">
                                        <span>{live().message || 'Loading live stats...'}</span>
                                        <Show when={live().resolution}>
                                          <span class="rounded bg-white/10 px-1 py-0.5 uppercase tracking-wider text-[9px]">
                                            {resolutionBadgeLabel(live().resolution)}
                                          </span>
                                        </Show>
                                      </div>
                                    </Show>
                                    <Show when={live().state === 'unsupported'}>
                                      <div class="text-[10px] text-text-dim">
                                        {live().message || 'Live preview unavailable'}
                                      </div>
                                    </Show>
                                    <Show when={live().state === 'error'}>
                                      <div class="flex items-center gap-1.5 text-[10px] text-status-error">
                                        <span>{live().message || 'Live query failed'}</span>
                                        <Show when={live().resolution}>
                                          <span class="rounded bg-status-error/20 px-1 py-0.5 uppercase tracking-wider text-[9px]">
                                            {resolutionBadgeLabel(live().resolution)}
                                          </span>
                                        </Show>
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
