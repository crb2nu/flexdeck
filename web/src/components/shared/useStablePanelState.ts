import { Accessor, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

export type StablePanelStatus = 'refreshing' | 'stale' | 'updated' | null;

interface UseStablePanelStateOptions<T> {
  value: Accessor<T>;
  loading: Accessor<boolean>;
  error: Accessor<unknown>;
  signature: (value: T) => string;
  hasValue?: (value: T) => boolean;
  pulseMs?: number;
}

export function stablePanelStatusClasses(status: StablePanelStatus): string {
  switch (status) {
    case 'refreshing':
      return 'text-white border-white/20 bg-white/10';
    case 'stale':
      return 'text-status-warn border-status-warn/20 bg-status-warn/10';
    case 'updated':
      return 'text-status-ok border-status-ok/20 bg-status-ok/10';
    default:
      return '';
  }
}

export function useStablePanelState<T>(options: UseStablePanelStateOptions<T>) {
  const pulseMs = options.pulseMs ?? 320;
  const hasValue = options.hasValue ?? (() => true);

  const [stableValue, setStableValue] = createSignal<T | null>(null);
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  let refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastSignature = '';

  const currentValue = createMemo(() => options.value());
  const hasStableValue = createMemo(() => stableValue() !== null);
  const effectiveValue = createMemo(() => stableValue() ?? currentValue());

  createEffect(() => {
    if (options.loading()) return;
    if (options.error()) return;

    const nextValue = currentValue();
    if (!hasValue(nextValue)) return;

    const signature = options.signature(nextValue);
    if (!hasStableValue()) {
      setStableValue(() => nextValue);
      lastSignature = signature;
      return;
    }

    if (signature === lastSignature) return;
    lastSignature = signature;
    setStableValue(() => nextValue);

    if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
    setIsRefreshing(true);
    refreshTimeoutId = setTimeout(() => {
      refreshTimeoutId = null;
      setIsRefreshing(false);
    }, pulseMs);
  });

  onCleanup(() => {
    if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
  });

  const status = createMemo<StablePanelStatus>(() => {
    if (options.loading() && hasStableValue()) return 'refreshing';
    if (options.error() && hasStableValue()) return 'stale';
    if (isRefreshing()) return 'updated';
    return null;
  });

  return {
    effectiveValue,
    hasStableValue,
    isRefreshing,
    status,
    showBlockingLoading: createMemo(() => options.loading() && !hasStableValue()),
    showBlockingError: createMemo(() => Boolean(options.error()) && !hasStableValue()),
  };
}
