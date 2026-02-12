import { Component, Show, createMemo } from 'solid-js';
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

const PulseCard: Component<PulseCardProps> = (props) => {
  const colorClasses = createMemo(() => {
    switch (props.color) {
      case 'purple':
        return {
          icon: 'text-neon-purple',
          glow: 'group-hover:[box-shadow:0_0_30px_rgba(168,85,247,0.15)]',
          border: 'group-hover:border-neon-purple/30',
          textShadow: '[text-shadow:0_0_20px_rgba(168,85,247,0.3)]',
        };
      case 'green':
        return {
          icon: 'text-status-ok',
          glow: 'group-hover:[box-shadow:0_0_30px_rgba(34,197,94,0.15)]',
          border: 'group-hover:border-status-ok/30',
          textShadow: '[text-shadow:0_0_20px_rgba(34,197,94,0.3)]',
        };
      case 'orange':
        return {
          icon: 'text-status-warn',
          glow: 'group-hover:[box-shadow:0_0_30px_rgba(249,115,22,0.15)]',
          border: 'group-hover:border-status-warn/30',
          textShadow: '[text-shadow:0_0_20px_rgba(249,115,22,0.3)]',
        };
      default:
        return {
          icon: 'text-neon-cyan',
          glow: 'group-hover:[box-shadow:0_0_30px_rgba(0,217,255,0.15)]',
          border: 'group-hover:border-neon-cyan/30',
          textShadow: '[text-shadow:0_0_20px_rgba(0,217,255,0.3)]',
        };
    }
  });

  const trendIcon = createMemo(() => {
    switch (props.trend) {
      case 'up': return '↑';
      case 'down': return '↓';
      default: return null;
    }
  });

  const trendColor = createMemo(() => {
    switch (props.trend) {
      case 'up': return 'text-status-ok';
      case 'down': return 'text-status-error';
      default: return 'text-text-dim';
    }
  });

  return (
    <div class={`glass-panel-hover group relative flex min-h-[120px] flex-col gap-2 p-4 transition-all duration-300 hover:-translate-y-0.5 overflow-hidden ${colorClasses().glow} ${colorClasses().border}`}>
      {/* Subtle gradient overlay on hover */}
      <div class="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

      {/* Header */}
      <div class="relative flex items-center justify-between">
        <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
          {props.title}
        </span>
        <Show when={props.icon}>
          <span class={`text-xl opacity-40 group-hover:opacity-100 transition-all duration-300 ${colorClasses().icon}`}>
            {props.icon}
          </span>
        </Show>
      </div>

      {/* Content */}
      <div class="relative flex flex-1 flex-col justify-center">
        <Show when={props.loading}>
          <div class="flex items-center gap-3">
            <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
            <span class="text-xs text-text-dim animate-pulse">Loading...</span>
          </div>
        </Show>

        <Show when={!props.loading && props.error}>
          <div class="flex items-center gap-2 text-sm text-status-error">
            <span>⚠</span>
            <span>{props.error}</span>
          </div>
        </Show>

        <Show when={!props.loading && !props.error}>
          <div class="flex items-baseline gap-2">
            <div class={`font-mono text-[32px] font-bold tracking-tight text-text-main transition-all duration-300 ${colorClasses().textShadow}`}>
              {props.value}
            </div>
            <Show when={trendIcon()}>
              <span class={`text-lg font-bold ${trendColor()}`}>
                {trendIcon()}
              </span>
            </Show>
          </div>
          <Show when={props.sub}>
            <div class="text-[13px] text-text-muted mt-0.5">{props.sub}</div>
          </Show>
          <Show when={props.sparkData && props.sparkData.length >= 2}>
            <div class="mt-1">
              <Sparkline
                data={props.sparkData!}
                width={120}
                height={20}
                color={props.color === 'purple' ? '#a855f7' : props.color === 'green' ? '#22c55e' : props.color === 'orange' ? '#f97316' : '#00d9ff'}
                trend={props.trend}
              />
            </div>
          </Show>
        </Show>
      </div>

      {/* Meta */}
      <Show when={props.meta && !props.loading && !props.error}>
        <div class="relative mt-auto font-mono text-[11px] text-text-dim border-t border-white/5 pt-2">
          {props.meta}
        </div>
      </Show>

      {/* Animated corner accent */}
      <div class="absolute top-0 right-0 w-12 h-12 overflow-hidden pointer-events-none">
        <div class={`absolute top-0 right-0 w-px h-8 bg-gradient-to-b from-transparent via-current to-transparent opacity-20 group-hover:opacity-60 transition-opacity ${colorClasses().icon}`} />
        <div class={`absolute top-0 right-0 h-px w-8 bg-gradient-to-l from-transparent via-current to-transparent opacity-20 group-hover:opacity-60 transition-opacity ${colorClasses().icon}`} />
      </div>
    </div>
  );
};

export default PulseCard;
