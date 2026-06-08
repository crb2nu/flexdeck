import { createMemo, type Accessor } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import {
  isOfflineError,
  operatorStateBadgeClass,
  operatorStateLabel,
  type OperatorState,
} from './freshness';

export interface SnapshotSurfaceState<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  updatedAt: number;
  sourceUpdatedAt: number;
}

export interface SnapshotSurfaceController<T> {
  state: SnapshotSurfaceState<T>;
  data: Accessor<T | null>;
  hasData: Accessor<boolean>;
  status: Accessor<OperatorState>;
  statusLabel: Accessor<string>;
  statusClass: Accessor<string>;
  showBlockingLoading: Accessor<boolean>;
  showBlockingError: Accessor<boolean>;
  start: () => void;
  succeed: (data: T, options?: SnapshotSurfaceSuccessOptions) => void;
  fail: (error: string) => void;
}

export interface SnapshotSurfaceOptions<T> {
  staleAfterMs: number;
  initialData?: T | null;
  initialUpdatedAt?: number;
  initialSourceUpdatedAt?: number;
  now?: () => number;
  statusDetail?: (state: SnapshotSurfaceState<T>, status: OperatorState) => string | undefined;
}

export interface SnapshotSurfaceSuccessOptions {
  updatedAt?: number;
  sourceUpdatedAt?: number;
}

export function resolveSnapshotSurfaceStatus<T>(
  state: SnapshotSurfaceState<T>,
  staleAfterMs: number,
  nowMs = Date.now(),
): OperatorState {
  const hasData = state.data !== null;

  if (!hasData && state.loading) return 'connecting';
  if (!hasData && state.error) return isOfflineError(state.error) ? 'offline' : 'partial';
  if (!hasData) return 'stale';
  if (state.error) return 'stale';

  const freshnessUpdatedAt = state.sourceUpdatedAt || state.updatedAt;
  if (!freshnessUpdatedAt || nowMs - freshnessUpdatedAt > staleAfterMs) return 'stale';
  if (state.refreshing || state.loading) return 'partial';
  return 'ready';
}

export function createSnapshotSurfaceController<T>(
  options: SnapshotSurfaceOptions<T>,
): SnapshotSurfaceController<T> {
  const now = options.now ?? (() => Date.now());
  const [state, setState] = createStore<SnapshotSurfaceState<T>>({
    data: options.initialData ?? null,
    loading: !options.initialData,
    refreshing: false,
    error: '',
    updatedAt: options.initialUpdatedAt ?? 0,
    sourceUpdatedAt: options.initialSourceUpdatedAt ?? 0,
  });

  const data = createMemo(() => state.data);
  const hasData = createMemo(() => state.data !== null);
  const status = createMemo(() => resolveSnapshotSurfaceStatus(state, options.staleAfterMs, now()));

  return {
    state,
    data,
    hasData,
    status,
    statusLabel: createMemo(() => operatorStateLabel(status(), options.statusDetail?.(state, status()))),
    statusClass: createMemo(() => operatorStateBadgeClass(status())),
    showBlockingLoading: createMemo(() => state.loading && !hasData()),
    showBlockingError: createMemo(() => Boolean(state.error) && !hasData()),
    start: () => {
      const hasSnapshot = hasData();
      setState({
        loading: !hasSnapshot,
        refreshing: hasSnapshot,
        error: '',
      });
    },
    succeed: (nextData, successOptions = {}) => {
      const updatedAt = successOptions.updatedAt ?? now();
      setState({
        loading: false,
        refreshing: false,
        error: '',
        updatedAt,
        sourceUpdatedAt: successOptions.sourceUpdatedAt ?? updatedAt,
      });
      // Reconcile rather than replace the snapshot payload. A plain
      // `data: nextData` swaps in a brand-new object tree every poll, so every
      // <For> over a nested list (nodes, pvcs, ingresses, …) sees fresh refs
      // and tears down/remounts each row — the snapshot flickers on refresh.
      // reconcile diffs in place so unchanged rows keep their identity and only
      // changed leaves update. merge:true reconciles positionally, which keeps
      // refs stable for our keyless DTO arrays (no top-level `id` field).
      if (state.data == null) {
        setState('data', () => nextData);
      } else {
        setState('data', reconcile(nextData, { merge: true }));
      }
    },
    fail: (error) => {
      setState({
        loading: false,
        refreshing: false,
        error,
      });
    },
  };
}
