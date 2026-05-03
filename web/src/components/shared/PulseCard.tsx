import { Component, Show, createEffect, createMemo, createSignal } from 'solid-js';
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
    return null;
  });

  return (
    <div
      class="surface-hover group relative flex min-h-[80px] sm:min-h-[96px] flex-col gap-1 sm:gap-1.5 p-2.5 sm:p-3 border-l-2"
      style={{
        'border-left-color': props.color === 'purple' ? 'rgba(189, 0, 255, 0.3)'
          : props.color === 'green' ? 'rgba(10, 255, 104, 0.3)'
          : props.color === 'orange' ? 'rgba(249, 115, 22, 0.3)'
          : 'rgba(0, 240, 255, 0.3)',
      }}
    >
      {/* Header */}
      <div class="relative flex items-center justify-between">
        <span class="heading-label">
          {props.title}
        </span>
        <div class="flex items-center gap-2">
          <Show when={statusChip()}>
            {(chip) => (
              <span class={`rounded-md border px-1.5 py-0.5 text-[9px] font-medium transition-opacity duration-150 ${chip().class}`}>
                {chip().label}
              </span>
            )}
          </Show>
          <Show when={props.icon}>
            <span class="text-lg sm:text-xl text-text-muted opacity-30 group-hover:opacity-50 transition-opacity duration-150">
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
          <div class="flex min-w-0 items-start gap-2 text-status-error">
            <span class="flex-shrink-0 text-base leading-none mt-0.5">⚠</span>
            <div class="min-w-0 flex-1">
              <div class="text-xs sm:text-sm font-semibold uppercase tracking-wide">Unavailable</div>
              <div
                class="mt-0.5 truncate text-[11px] text-status-error/80"
                title={formatPulseCardError(props.error || '')}
              >
                {formatPulseCardError(props.error || '')}
              </div>
            </div>
          </div>
        </Show>

        <Show when={stableState() || (!props.loading && !props.error)}>
          <div class="flex items-baseline gap-1 sm:gap-2">
            <div class="font-mono tabular-nums text-xl sm:text-2xl font-bold tracking-tight text-text-main">
              {effectiveState().value}
            </div>
            <Show when={effectiveState().trend && trendIcon()}>
              <span class={`text-base sm:text-lg font-bold ${trendColor()}`}>
                {trendIcon()}
              </span>
            </Show>
          </div>
          <Show when={effectiveState().sub}>
            <div class="text-[11px] sm:text-[13px] tabular-nums text-text-muted mt-0 sm:mt-0.5 truncate">
              {effectiveState().sub}
            </div>
          </Show>
          <Show when={effectiveState().sparkData && effectiveState().sparkData!.length >= 2}>
            <div class="mt-1 sm:mt-2 h-4 sm:h-5">
              <Sparkline
                data={effectiveState().sparkData!}
                width={typeof window !== 'undefined' && window.innerWidth < 640 ? 80 : 120}
                height={typeof window !== 'undefined' && window.innerWidth < 640 ? 16 : 20}
                color={props.color === 'purple' ? '#b06cde' : props.color === 'green' ? '#22e076' : props.color === 'orange' ? '#ff6b35' : '#00c8ff'}
                trend={effectiveState().trend}
              />
            </div>
          </Show>
        </Show>
      </div>

      {/* Meta */}
      <Show when={effectiveState().meta && (stableState() || (!props.loading && !props.error))}>
        <div class="relative mt-auto font-mono text-[10px] text-text-dim">
          {effectiveState().meta}
        </div>
      </Show>
    </div>
  );
};

// Defense-in-depth: even if a raw `{"error":"..."}` body or `[object Object]`
// sneaks through the API client, present it as a tidy human message instead of
// dumping the serialized JSON into the card.
function formatPulseCardError(raw: string): string {
  if (!raw) return "Unavailable";
  const trimmed = raw.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      const candidate =
        (typeof parsed?.error === "string" && parsed.error) ||
        (typeof parsed?.error?.message === "string" && parsed.error.message) ||
        (typeof parsed?.message === "string" && parsed.message) ||
        "";
      if (candidate) return candidate;
    } catch {
      // fall through
    }
  }
  if (trimmed === "[object Object]") return "Unavailable";
  return trimmed;
}

export default PulseCard;
