import { batch, Component, createMemo, createResource, createSignal, For, Show } from 'solid-js';
import { grafanaApi, prom } from '../../lib/api';
import Sparkline from '../shared/Sparkline';
import LoadingState from '../shared/LoadingState';

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
const MAX_LIVE_PANEL_QUERIES = 12;
const LIVE_QUERY_CONCURRENCY = 4;

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

async function runConcurrently<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      await worker(items[currentIndex]);
    }
  });

  await Promise.all(runners);
}

const GrafanaDashboards: Component = () => {
  const [dashboardsResource, { refetch: refetchDashboards }] = createResource<DashboardListState>(async () => {
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
  const [searchQuery, setSearchQuery] = createSignal('');
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
  const filteredDashboards = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    if (!query) return dashboards();

    return dashboards().filter((dashboard) => {
      const haystacks = [
        dashboard.title,
        dashboard.folderTitle || '',
        dashboard.type,
        ...(dashboard.tags || []),
      ];
      return haystacks.some((value) => value.toLowerCase().includes(query));
    });
  });
  const dashboardSummary = createMemo(() => ({
    total: dashboards().length,
    filtered: filteredDashboards().length,
    folders: new Set(dashboards().map((dashboard) => dashboard.folderTitle).filter(Boolean)).size,
    tagged: dashboards().filter((dashboard) => (dashboard.tags || []).length > 0).length,
  }));
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

    await runConcurrently(candidates, LIVE_QUERY_CONCURRENCY, async (panel) => {
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
      });

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
      <div class="surface overflow-hidden border border-white/10 bg-[linear-gradient(135deg,rgba(34,211,238,0.14),rgba(255,255,255,0.04),rgba(168,85,247,0.12))]">
        <div class="flex flex-col gap-4 p-4 lg:flex-row lg:items-end lg:justify-between">
          <div class="space-y-3">
            <div class="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim">
              <span class="rounded-full border border-white/10 bg-white/8 px-2.5 py-1">Grafana explorer</span>
              <span class="rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-white">
                {dashboardSummary().filtered} visible
              </span>
              <span class="rounded-full border border-white/10 bg-black/20 px-2.5 py-1">
                {dashboardSummary().folders} folders
              </span>
            </div>
            <div>
              <h2 class="text-xl font-semibold tracking-tight text-text-main">Operational dashboard catalog</h2>
              <p class="mt-1 max-w-3xl text-sm leading-6 text-text-dim">
                Browse Grafana surfaces, open one focused dashboard at a time, and sample live Prometheus-backed panels without flooding the page with queries.
              </p>
            </div>
          </div>

          <div class="flex w-full flex-col gap-3 lg:max-w-md">
            <label class="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 px-3 py-2 transition-colors focus-within:border-border-focus">
              <span class="text-xs uppercase tracking-[0.18em] text-text-dim">Find</span>
              <input
                value={searchQuery()}
                onInput={(event) => setSearchQuery(event.currentTarget.value)}
                placeholder="Search dashboards, folders, tags"
                class="w-full bg-transparent text-sm text-text-main outline-none placeholder:text-text-dim"
              />
            </label>
            <div class="flex flex-wrap items-center justify-between gap-2 text-[11px] text-text-dim">
              <span>{dashboardSummary().tagged} tagged dashboards · live previews capped at {MAX_LIVE_PANEL_QUERIES}</span>
              <button
                type="button"
                onClick={() => void refetchDashboards()}
                class="rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/15"
              >
                Refresh catalog
              </button>
            </div>
          </div>
        </div>
      </div>

      <Show when={error()}>
        <div class="surface flex flex-col gap-2 p-4 text-sm text-status-error border border-status-error/20">
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
        <LoadingState size="sm" />
      </Show>

      <Show when={!loading() && dashboards().length === 0 && !error()}>
        <div class="surface p-8 text-center text-text-muted">
          <div class="text-lg mb-2 text-text-main">No Grafana Dashboards</div>
          <p class="text-sm text-text-dim max-w-md mx-auto">
            Ensure GRAFANA_URL is reachable and anonymous access or GRAFANA_TOKEN is correctly configured.
          </p>
        </div>
      </Show>

      <Show when={!loading() && dashboards().length > 0 && filteredDashboards().length === 0}>
        <div class="surface p-8 text-center">
          <div class="text-lg text-text-main">No dashboards match</div>
          <p class="mx-auto mt-2 max-w-md text-sm text-text-dim">
            Try a title, folder, datasource tag, or clear the search query to see the full catalog again.
          </p>
        </div>
      </Show>

      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <For each={filteredDashboards()}>
          {(dash) => (
            <div
              class={`surface-hover flex cursor-pointer flex-col overflow-hidden p-4 transition-colors duration-150 ${
                expandedUid() === dash.uid
                  ? 'border-white/20 md:col-span-2 xl:col-span-3'
                  : ''
              }`}
              onClick={() => toggleDashboard(dash.uid)}
            >
              <div class="mb-3 flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim">
                      {dash.type || 'dashboard'}
                    </span>
                    <Show when={dash.folderTitle}>
                      <span class="text-[10px] uppercase tracking-[0.18em] text-text-dim/80">
                        {dash.folderTitle}
                      </span>
                    </Show>
                  </div>
                  <h3 class="mt-2 text-sm font-medium text-text-main truncate">
                    {dash.title}
                  </h3>
                </div>
                <span class={`ml-2 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${
                  expandedUid() === dash.uid
                    ? 'border-white/20 bg-white/10 text-white'
                    : 'border-white/10 bg-black/20 text-text-dim'
                }`}>
                  {expandedUid() === dash.uid ? 'Open' : 'Preview'}
                </span>
              </div>

              <Show when={dash.tags && dash.tags.length > 0}>
                <div class="mb-2 flex flex-wrap gap-1">
                  <For each={dash.tags}>
                    {(tag) => (
                      <span class="px-1.5 py-0.5 text-[10px] rounded bg-white/10 text-text-muted">
                        {tag}
                      </span>
                    )}
                  </For>
                </div>
              </Show>

              {/* Expanded panel list */}
              <Show when={expandedUid() === dash.uid}>
                <div
                  class="mt-3 border-t border-white/5 pt-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Show when={panelsLoading()}>
                    <div class="flex items-center gap-2 text-xs text-text-dim">
                      <div class="h-3 w-3 animate-spin rounded-full border border-white/10 border-t-white/50" />
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
                        <span class="text-white">{liveSummary().ready} live</span>
                        <span>{liveSummary().loading} loading</span>
                        <Show when={liveSummary().unsupported > 0}>
                          <span>{liveSummary().unsupported} skipped</span>
                        </Show>
                        <Show when={liveSummary().error > 0}>
                          <span class="text-status-error">{liveSummary().error} errors</span>
                        </Show>
                      </Show>
                    </div>
                    <Show when={liveSummary().tracked > MAX_LIVE_PANEL_QUERIES}>
                      <div class="mb-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-text-dim">
                        Sampling live previews for the first {MAX_LIVE_PANEL_QUERIES} supported Prometheus panels to keep the page responsive.
                      </div>
                    </Show>
                    <Show when={templateVarEntries().length > 0}>
                      <div class="mb-2 flex flex-wrap items-center gap-1.5 text-[10px] text-text-dim">
                        <span class="uppercase tracking-wider">vars</span>
                        <For each={templateVarEntries()}>
                          {(entry) => (
                            <span class="rounded bg-white/10 px-1.5 py-0.5 text-white">
                              {entry[0]}={entry[1]}
                            </span>
                          )}
                        </For>
                      </div>
                    </Show>
                    <div class="max-h-[32rem] overflow-y-auto pr-1">
                      <div class="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
                        <For each={panels()}>
                          {(panel) => (
                            <div class="rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(0,0,0,0.18))] px-3 py-2 text-xs">
                              <div class="flex items-center gap-2">
                                <span class="text-text-muted font-mono">
                                  {panel.type}
                                </span>
                                <span class="flex-1 truncate font-medium text-text-main">
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
                                    <span class="rounded bg-white/10 px-1.5 py-0.5 text-text-muted">
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
                                <pre class="mt-1 max-h-24 overflow-auto rounded-xl bg-black/30 p-1.5 font-mono text-[10px] text-text-dim">
                                  {panel.queryPreview}
                                </pre>
                              </Show>

                              <Show when={liveDataByPanel()[panelKey(panel)]}>
                                {(live) => (
                                  <div class="mt-1.5 border-t border-white/5 pt-1.5">
                                    <Show when={live().state === 'ready'}>
                                      <div class="flex items-end justify-between gap-2">
                                        <div class="flex items-end gap-2">
                                          <span class="text-base font-semibold tabular-nums text-white">
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
                    class="inline-flex items-center gap-1 mt-2 text-xs text-white hover:text-white/80 transition-colors"
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
