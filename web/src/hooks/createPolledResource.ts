import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { createPolling } from './createPolling';

export interface PolledResourceOptions {
  /** Poll interval in milliseconds (default 15000). */
  interval?: number;
  /**
   * reconcile key for keyed list diffing (default 'id'). Pass 'ID' for
   * Go-struct JSON payloads. Items missing the key are simply replaced.
   */
  key?: string;
  /** Reactive gate; polling unregisters while false. */
  enabled?: boolean | (() => boolean);
}

export interface PolledResource<T> {
  data: () => T | null;
  error: () => string | null;
  loaded: () => boolean;
  /** Epoch ms of the last successful fetch (0 until one lands) — feeds freshness/staleness chips. */
  updatedAt: () => number;
  /** Fetch immediately, outside the poll schedule (e.g. after a filter change or mutation). */
  refresh: () => Promise<void>;
}

/**
 * The canonical poll-on-interval fetch primitive. Data lands in a store via
 * `reconcile`, so objects/arrays keep referential identity for unchanged
 * items across polls — <For> reuses row DOM instead of tearing it down every
 * tick (the poll-flicker class fixed app-wide in MRs !166–!171).
 *
 * Error semantics: the last good payload is retained while `error` is set, so
 * surfaces can render stale data alongside the failure instead of blanking.
 * Unregisters from the polling scheduler automatically on scope disposal.
 */
export function createPolledResource<T>(
  id: string,
  fetcher: () => Promise<T>,
  options: PolledResourceOptions = {},
): PolledResource<T> {
  const [state, setState] = createStore<{ value: T | null }>({ value: null });
  const [error, setError] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [updatedAt, setUpdatedAt] = createSignal(0);

  const run = async () => {
    try {
      const next = await fetcher();
      if (next !== null && typeof next === 'object') {
        setState('value', reconcile(next, { key: options.key ?? 'id' }));
      } else {
        setState('value', () => next);
      }
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setLoaded(true);
    }
  };

  createPolling(id, run, options.interval ?? 15000, options.enabled ?? true);

  return {
    data: () => state.value,
    error,
    loaded,
    updatedAt,
    refresh: run,
  };
}
