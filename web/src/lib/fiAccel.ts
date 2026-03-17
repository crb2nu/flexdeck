export type FiAccelLogLevel = 'error' | 'warn' | 'info' | 'debug';
export type FiAccelCiStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'manual'
  | 'skipped'
  | 'canceled';

export interface FiAccelLogFilter {
  levels?: string[];
  searchTerm?: string;
  searchRegex?: boolean;
}

interface WasmLogAnalysisMatch {
  index: number;
  level: FiAccelLogLevel;
  matches_filter: boolean;
  matches_search: boolean;
}

export interface FiAccelLogAnalysisMatch {
  index: number;
  level: FiAccelLogLevel;
  matchesFilter: boolean;
  matchesSearch: boolean;
}

export interface FiAccelMetricsSnapshot {
  initState: 'loading' | 'ready' | 'fallback';
  initAttempts: number;
  initFailures: number;
  logAnalyzeCalls: number;
  logAnalyzeFallbackCalls: number;
  logAnalyzeLines: number;
  logAnalyzeWasmMs: number;
  logAnalyzeFallbackMs: number;
  selectorFilterCalls: number;
  selectorFilterFallbackCalls: number;
  selectorFilterCandidates: number;
  selectorFilterWasmMs: number;
  selectorFilterFallbackMs: number;
}

export interface FiAccelMetricsDelta {
  initState: FiAccelMetricsSnapshot['initState'];
  logAnalyzeCalls: number;
  logAnalyzeFallbackCalls: number;
  logAnalyzeLines: number;
  logAnalyzeMs: number;
  selectorFilterCalls: number;
  selectorFilterFallbackCalls: number;
  selectorFilterCandidates: number;
  selectorFilterMs: number;
}

interface FiAccelBindings {
  surface_analyze_logs: (payload: unknown) => WasmLogAnalysisMatch[];
  surface_detect_log_level: (line: string) => FiAccelLogLevel;
  surface_filter_label_selector: (payload: unknown) => number[];
  surface_matches_label_selector: (
    selector: Record<string, string>,
    labels: Record<string, string>,
  ) => boolean;
  surface_normalize_ci_job_status: (status: string) => FiAccelCiStatus;
  surface_normalize_ci_pipeline_status: (status: string) => FiAccelCiStatus;
}

const VALID_LOG_LEVELS = new Set<FiAccelLogLevel>(['error', 'warn', 'info', 'debug']);

let fiAccelBindings: FiAccelBindings | null = null;
let fiAccelInitPromise: Promise<void> | null = null;
const fiAccelMetrics: FiAccelMetricsSnapshot = {
  initState: 'loading',
  initAttempts: 0,
  initFailures: 0,
  logAnalyzeCalls: 0,
  logAnalyzeFallbackCalls: 0,
  logAnalyzeLines: 0,
  logAnalyzeWasmMs: 0,
  logAnalyzeFallbackMs: 0,
  selectorFilterCalls: 0,
  selectorFilterFallbackCalls: 0,
  selectorFilterCandidates: 0,
  selectorFilterWasmMs: 0,
  selectorFilterFallbackMs: 0,
};

const normalizeLogLevels = (levels?: string[]): FiAccelLogLevel[] =>
  (levels ?? []).filter((level): level is FiAccelLogLevel => VALID_LOG_LEVELS.has(level as FiAccelLogLevel));

const normalizeLabelSet = (labels?: Record<string, string> | null): Record<string, string> => labels ?? {};

const fallbackDetectLogLevel = (line: string): FiAccelLogLevel => {
  const lower = line.toLowerCase();

  if (
    lower.includes('error') ||
    lower.includes('fatal') ||
    lower.includes('panic') ||
    lower.includes('exception') ||
    lower.includes('fail')
  ) {
    return 'error';
  }

  if (lower.includes('warn') || lower.includes('warning')) {
    return 'warn';
  }

  if (lower.includes('debug') || lower.includes('trace')) {
    return 'debug';
  }

  return 'info';
};

const fallbackAnalyzeLogLines = (
  lines: string[],
  filter?: FiAccelLogFilter,
): FiAccelLogAnalysisMatch[] => {
  const levelFilter = new Set(normalizeLogLevels(filter?.levels));
  const hasLevelFilter = levelFilter.size > 0;
  const searchTerm = filter?.searchTerm?.trim() ?? '';
  const regex = searchTerm && filter?.searchRegex
    ? (() => {
        try {
          return new RegExp(searchTerm, 'i');
        } catch {
          return null;
        }
      })()
    : null;
  const normalizedSearch = searchTerm.toLowerCase();

  return lines.map((line, index) => {
    const level = fallbackDetectLogLevel(line);
    const matchesFilter = !hasLevelFilter || levelFilter.has(level);
    const matchesSearch = normalizedSearch.length > 0
      ? regex
        ? regex.test(line)
        : line.toLowerCase().includes(normalizedSearch)
      : false;

    return {
      index,
      level,
      matchesFilter,
      matchesSearch,
    };
  });
};

const fallbackMatchesLabelSelector = (
  selector: Record<string, string>,
  labels: Record<string, string>,
): boolean => Object.entries(selector).every(([key, value]) => labels[key] === value);

const fallbackNormalizeCiJobStatus = (status: string | undefined | null): FiAccelCiStatus => {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'running':
      return 'running';
    case 'success':
      return 'success';
    case 'failed':
      return 'failed';
    case 'manual':
      return 'manual';
    case 'skipped':
      return 'skipped';
    case 'canceled':
    case 'cancelled':
    case 'canceling':
      return 'failed';
    case 'pending':
    case 'created':
    case 'preparing':
    case 'waiting_for_resource':
    case 'scheduled':
      return 'pending';
    default:
      return 'pending';
  }
};

const fallbackNormalizeCiPipelineStatus = (status: string | undefined | null): FiAccelCiStatus => {
  switch ((status ?? '').trim().toLowerCase()) {
    case 'running':
      return 'running';
    case 'success':
      return 'success';
    case 'failed':
      return 'failed';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    case 'skipped':
      return 'canceled';
    case 'pending':
    case 'created':
    case 'preparing':
    case 'waiting_for_resource':
    case 'scheduled':
    case 'manual':
      return 'pending';
    default:
      return 'pending';
  }
};

const ensureFiAccel = (): Promise<void> => {
  if (fiAccelBindings) return Promise.resolve();
  if (fiAccelInitPromise) return fiAccelInitPromise;

  fiAccelInitPromise = (async () => {
    fiAccelMetrics.initAttempts += 1;
    fiAccelMetrics.initState = 'loading';
    try {
      // Use the generated wrapper module so wasm-bindgen owns the import-object wiring
      // in both the window and worker bundles.
      const wasmModule = await import('../../vendor/fi-accel/fi_accel_wasm.js');
      fiAccelBindings = wasmModule as unknown as FiAccelBindings;
      fiAccelMetrics.initState = 'ready';
    } catch (error) {
      fiAccelMetrics.initFailures += 1;
      fiAccelMetrics.initState = 'fallback';
      console.warn('[fi-accel] Falling back to TypeScript helpers:', error);
    }
  })();

  return fiAccelInitPromise;
};

if (import.meta.env.MODE !== 'test') {
  void ensureFiAccel();
}

export const detectLogLevel = (line: string): FiAccelLogLevel =>
  fiAccelBindings?.surface_detect_log_level(line) ?? fallbackDetectLogLevel(line);

export const getFiAccelMetricsSnapshot = (): FiAccelMetricsSnapshot => ({ ...fiAccelMetrics });

export const diffFiAccelMetrics = (
  before: FiAccelMetricsSnapshot,
  after: FiAccelMetricsSnapshot,
): FiAccelMetricsDelta => ({
  initState: after.initState,
  logAnalyzeCalls: after.logAnalyzeCalls - before.logAnalyzeCalls,
  logAnalyzeFallbackCalls: after.logAnalyzeFallbackCalls - before.logAnalyzeFallbackCalls,
  logAnalyzeLines: after.logAnalyzeLines - before.logAnalyzeLines,
  logAnalyzeMs:
    (after.logAnalyzeWasmMs + after.logAnalyzeFallbackMs) -
    (before.logAnalyzeWasmMs + before.logAnalyzeFallbackMs),
  selectorFilterCalls: after.selectorFilterCalls - before.selectorFilterCalls,
  selectorFilterFallbackCalls:
    after.selectorFilterFallbackCalls - before.selectorFilterFallbackCalls,
  selectorFilterCandidates: after.selectorFilterCandidates - before.selectorFilterCandidates,
  selectorFilterMs:
    (after.selectorFilterWasmMs + after.selectorFilterFallbackMs) -
    (before.selectorFilterWasmMs + before.selectorFilterFallbackMs),
});

export const analyzeLogLines = (
  lines: string[],
  filter?: FiAccelLogFilter,
): FiAccelLogAnalysisMatch[] => {
  if (lines.length === 0) return [];

  const bindings = fiAccelBindings;
  if (!bindings) {
    const startedAt = performance.now();
    const result = fallbackAnalyzeLogLines(lines, filter);
    fiAccelMetrics.logAnalyzeCalls += 1;
    fiAccelMetrics.logAnalyzeFallbackCalls += 1;
    fiAccelMetrics.logAnalyzeLines += lines.length;
    fiAccelMetrics.logAnalyzeFallbackMs += performance.now() - startedAt;
    return result;
  }

  const startedAt = performance.now();
  const result = bindings.surface_analyze_logs({
    lines,
    filter: filter
      ? {
          levels: normalizeLogLevels(filter.levels),
          search_term: filter.searchTerm ?? null,
          search_regex: filter.searchRegex ?? false,
        }
      : undefined,
  });
  fiAccelMetrics.logAnalyzeCalls += 1;
  fiAccelMetrics.logAnalyzeLines += lines.length;
  fiAccelMetrics.logAnalyzeWasmMs += performance.now() - startedAt;

  return result.map((match) => ({
    index: match.index,
    level: match.level,
    matchesFilter: match.matches_filter,
    matchesSearch: match.matches_search,
  }));
};

export const matchesLabelSelector = (
  selector: Record<string, string> | undefined | null,
  labels: Record<string, string> | undefined | null,
): boolean => {
  const normalizedSelector = normalizeLabelSet(selector);
  if (Object.keys(normalizedSelector).length === 0) return true;

  const normalizedLabels = normalizeLabelSet(labels);
  return fiAccelBindings?.surface_matches_label_selector(normalizedSelector, normalizedLabels)
    ?? fallbackMatchesLabelSelector(normalizedSelector, normalizedLabels);
};

export const filterLabelSelectorMatches = (
  selector: Record<string, string> | undefined | null,
  labelSets: Array<Record<string, string> | undefined | null>,
): number[] => {
  const normalizedSelector = normalizeLabelSet(selector);
  if (Object.keys(normalizedSelector).length === 0) {
    return labelSets.map((_, index) => index);
  }

  const normalizedLabelSets = labelSets.map((labels) => normalizeLabelSet(labels));
  fiAccelMetrics.selectorFilterCalls += 1;
  fiAccelMetrics.selectorFilterCandidates += normalizedLabelSets.length;

  if (fiAccelBindings) {
    const startedAt = performance.now();
    const result = fiAccelBindings.surface_filter_label_selector({
      selector: normalizedSelector,
      label_sets: normalizedLabelSets,
    });
    fiAccelMetrics.selectorFilterWasmMs += performance.now() - startedAt;
    return result;
  }

  const startedAt = performance.now();
  const result = normalizedLabelSets.flatMap((labels, index) =>
    fallbackMatchesLabelSelector(normalizedSelector, labels) ? [index] : [],
  );
  fiAccelMetrics.selectorFilterFallbackCalls += 1;
  fiAccelMetrics.selectorFilterFallbackMs += performance.now() - startedAt;
  return result;
};

export const normalizeCiJobStatus = (status: string | undefined | null): FiAccelCiStatus =>
  fiAccelBindings?.surface_normalize_ci_job_status(status ?? '') ?? fallbackNormalizeCiJobStatus(status);

export const normalizeCiPipelineStatus = (status: string | undefined | null): FiAccelCiStatus =>
  fiAccelBindings?.surface_normalize_ci_pipeline_status(status ?? '') ?? fallbackNormalizeCiPipelineStatus(status);
