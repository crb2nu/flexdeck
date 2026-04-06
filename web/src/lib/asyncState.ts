import { batch, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';

export interface AsyncValueState<T> {
  value: () => T;
  setValue: (value: T) => void;
  loading: () => boolean;
  setLoading: (loading: boolean) => void;
  error: () => string;
  setError: (error: string) => void;
  updatedAt: () => number;
  setUpdatedAt: (updatedAt: number) => void;
}

export interface AsyncStatusState {
  loading: boolean;
  refreshing: boolean;
  error: string;
}

type AsyncStatusExtras<T extends object> = T & {
  loading?: never;
  refreshing?: never;
  error?: never;
};

export function createAsyncValueState<T>(initialValue: T): AsyncValueState<T> {
  const [value, setValue] = createSignal<T>(initialValue);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [updatedAt, setUpdatedAt] = createSignal(0);

  return {
    value,
    setValue,
    loading,
    setLoading,
    error,
    setError,
    updatedAt,
    setUpdatedAt,
  };
}

export function resetAsyncValueState<T>(state: AsyncValueState<T>, value: T): void {
  batch(() => {
    state.setValue(value);
    state.setLoading(true);
    state.setError('');
    state.setUpdatedAt(0);
  });
}

export function clearAsyncValueState<T>(state: AsyncValueState<T>, value: T): void {
  batch(() => {
    state.setValue(value);
    state.setLoading(false);
    state.setError('');
    state.setUpdatedAt(0);
  });
}

export function startAsyncValueState<T>(state: AsyncValueState<T>): void {
  state.setLoading(true);
}

export function completeAsyncValueState<T>(state: AsyncValueState<T>, value: T): void {
  batch(() => {
    state.setValue(value);
    state.setError('');
    state.setUpdatedAt(Date.now());
    state.setLoading(false);
  });
}

export function failAsyncValueState<T>(state: AsyncValueState<T>, error: string): void {
  batch(() => {
    state.setError(error);
    state.setLoading(false);
  });
}

export interface AsyncStatusController<T extends object> {
  state: AsyncStatusState & T;
  patch: (patch: Partial<AsyncStatusState> & Partial<T>) => void;
  start: () => boolean;
  succeed: (patch?: Partial<AsyncStatusState> & Partial<T>) => void;
  fail: (error: string, patch?: Partial<AsyncStatusState> & Partial<T>) => void;
}

export function createAsyncStatusController<T extends object>(
  initialState: AsyncStatusExtras<T>,
): AsyncStatusController<T> {
  type StatusStore = AsyncStatusState & T;

  const [state, setState] = createStore<StatusStore>({
    loading: true,
    refreshing: false,
    error: '',
    ...initialState,
  });

  const patch = (nextPatch: Partial<AsyncStatusState> & Partial<T>) => {
    setState((current) => ({
      ...current,
      ...nextPatch,
    }));
  };

  return {
    state,
    patch,
    start: () => {
      const isInitialLoad = state.loading;
      if (!isInitialLoad) {
        setState((current) => ({
          ...current,
          refreshing: true,
        }));
      }
      return isInitialLoad;
    },
    succeed: (nextPatch = {}) => {
      setState((current) => ({
        ...current,
        ...nextPatch,
        loading: false,
        refreshing: false,
      }));
    },
    fail: (error, nextPatch = {}) => {
      setState((current) => ({
        ...current,
        ...nextPatch,
        error,
        loading: false,
        refreshing: false,
      }));
    },
  };
}
