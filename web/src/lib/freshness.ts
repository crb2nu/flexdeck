export type OperatorState =
  | 'connecting'
  | 'ready'
  | 'partial'
  | 'fallback'
  | 'stale'
  | 'offline'
  | 'disabled';
export type FreshnessState = Extract<OperatorState, 'ready' | 'stale' | 'offline'>;

export interface ResolveOperatorStateInput {
  loading?: boolean;
  error?: string | null;
  lastUpdateMs?: number;
  staleAfterMs: number;
  nowMs?: number;
  disabled?: boolean;
  partial?: boolean;
  fallback?: boolean;
  loadingState?: Extract<OperatorState, 'connecting' | 'partial'>;
}

const OFFLINE_ERROR_TOKENS = ['offline', 'unavailable', 'timeout', 'refused'];

const OPERATOR_STATE_LABELS: Record<OperatorState, string> = {
  connecting: 'CONNECTING',
  ready: 'READY',
  partial: 'PARTIAL',
  fallback: 'FALLBACK',
  stale: 'STALE',
  offline: 'OFFLINE',
  disabled: 'DISABLED',
};

const OPERATOR_STATE_BADGE_CLASSES: Record<OperatorState, string> = {
  connecting: 'bg-white/10 text-text-dim',
  ready: 'bg-status-ok/20 text-status-ok',
  partial: 'bg-neon-cyan/20 text-neon-cyan',
  fallback: 'bg-status-warn/15 text-status-warn',
  stale: 'bg-status-warn/20 text-status-warn',
  offline: 'bg-white/10 text-text-dim',
  disabled: 'bg-white/10 text-text-dim',
};

export function isOfflineError(error: string): boolean {
  const normalized = error.trim().toLowerCase();
  if (!normalized) return false;
  return OFFLINE_ERROR_TOKENS.some((token) => normalized.includes(token));
}

export function resolveOperatorState(
  input: ResolveOperatorStateInput,
): OperatorState {
  const {
    loading = false,
    error = '',
    lastUpdateMs = 0,
    staleAfterMs,
    nowMs = Date.now(),
    disabled = false,
    partial = false,
    fallback = false,
    loadingState = 'connecting',
  } = input;

  if (disabled) return 'disabled';

  const normalizedError = (error || '').trim();
  if (normalizedError) {
    return isOfflineError(normalizedError) ? 'offline' : 'partial';
  }

  if (loading && !lastUpdateMs) return loadingState;
  if (!lastUpdateMs || nowMs - lastUpdateMs > staleAfterMs) return 'stale';
  if (fallback) return 'fallback';
  if (partial || loading) return 'partial';
  return 'ready';
}

/**
 * Determine how fresh a piece of data is relative to its expected refresh interval.
 *
 * @param lastUpdatedMs Timestamp (ms since epoch) of the last successful fetch.
 * @param intervalMs    Expected polling interval in milliseconds.
 * @param multiplier    How many intervals before data is considered stale (default 2.5).
 */
export function resolveFreshness(
  lastUpdatedMs: number,
  intervalMs: number,
  multiplier = 2.5,
): FreshnessState {
  if (!lastUpdatedMs) return 'offline';
  const age = Date.now() - lastUpdatedMs;
  if (age > intervalMs * multiplier) return 'stale';
  return 'ready';
}

export function operatorStateLabel(state: OperatorState, detail?: string): string {
  const baseLabel = OPERATOR_STATE_LABELS[state];
  if (!detail) return baseLabel;
  return `${baseLabel} · ${detail}`;
}

export function operatorStateBadgeClass(state: OperatorState): string {
  return OPERATOR_STATE_BADGE_CLASSES[state];
}
