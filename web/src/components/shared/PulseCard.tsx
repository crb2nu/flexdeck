import { Component, Show } from 'solid-js';

interface PulseCardProps {
  title: string;
  value: string;
  sub?: string;
  meta?: string;
  loading?: boolean;
  error?: string;
  icon?: string;
}

const PulseCard: Component<PulseCardProps> = (props) => {
  return (
    <div class="glass-panel-hover group flex min-h-[120px] flex-col gap-2 p-4 transition-transform hover:-translate-y-0.5">
      {/* Header */}
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {props.title}
        </span>
        <Show when={props.icon}>
          <span class="text-lg opacity-50 group-hover:opacity-100 transition-opacity">
            {props.icon}
          </span>
        </Show>
      </div>

      {/* Content */}
      <div class="flex flex-1 flex-col justify-center">
        <Show when={props.loading}>
          <div class="h-5 w-5 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
        </Show>

        <Show when={!props.loading && props.error}>
          <div class="text-xs text-status-error">{props.error}</div>
        </Show>

        <Show when={!props.loading && !props.error}>
          <div class="font-mono text-[28px] font-bold tracking-tight text-text-main [text-shadow:0_0_20px_rgba(0,240,255,0.2)]">
            {props.value}
          </div>
          <Show when={props.sub}>
            <div class="text-[13px] text-text-muted">{props.sub}</div>
          </Show>
        </Show>
      </div>

      {/* Meta */}
      <Show when={props.meta && !props.loading && !props.error}>
        <div class="mt-auto font-mono text-[11px] text-text-dim">
          {props.meta}
        </div>
      </Show>
    </div>
  );
};

export default PulseCard;
