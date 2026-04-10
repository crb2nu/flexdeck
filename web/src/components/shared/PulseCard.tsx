import { Component, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import Sparkline from './Sparkline';

interface PulseCardProps {
  title: string;
  value: string;
  sub?: string;
  meta?: string;
  loading?: boolean;
  error?: string;
  icon?: string;
  trend?: 'up' | 'down' | 'stable';
  color?: 'cyan' | 'purple' | 'green' | 'orange';
  sparkData?: number[];
}

interface StablePulseCardState {
  value: string;
  sub?: string;
  meta?: string;
  trend?: 'up' | 'down' | 'stable';
  sparkData?: number[];
}

const PulseCard: Component<PulseCardProps> = (props) => {
  const [stableState, setStableState] = createSignal<StablePulseCardState | null>(null);
  const [isRefreshing, setIsRefreshing] = createSignal(false);
  let refreshTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastStableSignature = '';

  const currentState = createMemo<StablePulseCardState>(() => ({
    value: props.value,
    sub: props.sub,
    meta: props.meta,
    trend: props.trend,
    sparkData: props.sparkData,
  }));

  const effectiveState = createMemo(() => stableState() ?? currentState());

  createEffect(() => {
    if (props.loading || !!props.error) return;
    const nextState = currentState();
    const sparkData = nextState.sparkData || [];
    const signature = [
      nextState.value,
      nextState.sub || '',
      nextState.meta || '',
      nextState.trend || '',
      sparkData.length,
      sparkData[sparkData.length - 1] ?? '',
    ].join('|');

    if (!stableState()) {
      setStableState(nextState);
      lastStableSignature = signature;
      return;
    }

    if (signature === lastStableSignature) return;
    lastStableSignature = signature;
    setStableState(nextState);
    if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
    setIsRefreshing(true);
    refreshTimeoutId = setTimeout(() => {
      refreshTimeoutId = null;
      setIsRefreshing(false);
    }, 320);
  });

  onCleanup(() => {
    if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
  });

  const trendIcon = createMemo(() => {
    switch (effectiveState().trend) {
      case 'up': return '↑';
      case 'down': return '↓';
      default: return null;
    }
  });

  const trendColor = createMemo(() => {
    switch (effectiveState().trend) {
      case 'up': return 'text-status-ok';
      case 'down': return 'text-status-error';
      default: return 'text-text-dim';
    }
  });

  const statusChip = createMemo(() => {
    if (props.loading && stableState()) return { label: 'refreshing', class: 'text-text-dim border-white/10 bg-white/5' };
    if (props.error && stableState()) return { label: 'stale', class: 'text-status-warn border-status-warn/20 bg-status-warn/10' };
    if (isRefreshing()) return { label: 'updated', class: 'text-status-ok border-status-ok/20 bg-status-ok/10' };
    return null;
  });

  return (
    <div class="glass-panel-hover group relative flex min-h-[100px] sm:min-h-[120px] flex-col gap-1 sm:gap-2 p-3 sm:p-4 transition-colors overflow-hidden">
      {/* Header */}
      <div class="relative flex items-center justify-between">
        <span class="text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-text-muted">
          {props.title}
        </span>
        <div class="flex items-center gap-2">
          <Show when={statusChip()}>
            {(chip) => (
              <span class={`rounded-full border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider transition-opacity duration-150 ${chip().class}`}>
                {chip().label}
              </span>
            )}
          </Show>
          <Show when={props.icon}>
            <span class="text-lg sm:text-xl text-text-muted opacity-40 group-hover:opacity-70 transition-opacity">
              {props.icon}
            </span>
          </Show>
        </div>
      </div>

      {/* Content */}
      <div class="relative flex flex-1 flex-col justify-center">
        <Show when={props.loading && !stableState()}>
          <div class="flex items-center gap-2 sm:gap-3">
            <div class="h-4 w-4 sm:h-6 sm:w-6 animate-spin rounded-full border-2 border-white/10 border-t-white/50" />
            <span class="text-[10px] sm:text-xs text-text-dim">Loading...</span>
          </div>
        </Show>

        <Show when={!!props.error && !stableState()}>
          <div class="flex items-center gap-2 text-[11px] sm:text-sm text-status-error">
            <span>⚠</span>
            <span class="truncate">{props.error}</span>
          </div>
        </Show>

        <Show when={stableState() || (!props.loading && !props.error)}>
          <div class="flex items-baseline gap-1 sm:gap-2">
            <div class={`font-mono text-2xl sm:text-[32px] font-bold tracking-tight text-text-main transition-opacity ${isRefreshing() ? 'opacity-90' : 'opacity-100'}`}>
              {effectiveState().value}
            </div>
            <Show when={effectiveState().trend && trendIcon()}>
              <span class={`text-base sm:text-lg font-bold ${trendColor()}`}>
                {trendIcon()}
              </span>
            </Show>
          </div>
          <Show when={effectiveState().sub}>
            <div class={`text-[11px] sm:text-[13px] text-text-muted mt-0 sm:mt-0.5 truncate transition-opacity ${isRefreshing() ? 'opacity-80' : 'opacity-100'}`}>
              {effectiveState().sub}
            </div>
          </Show>
          <Show when={effectiveState().sparkData && effectiveState().sparkData!.length >= 2}>
            <div class={`mt-1 sm:mt-2 h-4 sm:h-5 transition-opacity ${isRefreshing() ? 'opacity-80' : 'opacity-100'}`}>
              <Sparkline
                data={effectiveState().sparkData!}
                width={typeof window !== 'undefined' && window.innerWidth < 640 ? 80 : 120}
                height={typeof window !== 'undefined' && window.innerWidth < 640 ? 16 : 20}
                color={props.color === 'purple' ? '#a855f7' : props.color === 'green' ? '#22c55e' : props.color === 'orange' ? '#f97316' : '#00d9ff'}
                trend={effectiveState().trend}
              />
            </div>
          </Show>
        </Show>
      </div>

      {/* Meta */}
      <Show when={effectiveState().meta && (stableState() || (!props.loading && !props.error))}>
        <div class="relative mt-auto font-mono text-[11px] text-text-dim border-t border-white/5 pt-2">
          {effectiveState().meta}
        </div>
      </Show>
    </div>
  );
};

export default PulseCard;
