import { Component, JSX } from 'solid-js';

export type BadgeTone = 'default' | 'ok' | 'warn' | 'error' | 'info';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  class?: string;
  children: JSX.Element;
}

// Tints derived from canonical tokens via color-mix so they actually render
// (bare var() tokens drop Tailwind /opacity). No decorative hover glow — per
// the glow-discipline rule, badges are static status, not live/critical signals.
const toneClasses: Record<BadgeTone, string> = {
  default: 'bg-white/5 border-white/10 text-text-dim',
  ok: 'border-[color-mix(in_srgb,var(--status-ok)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-ok)_12%,transparent)] text-status-ok',
  warn: 'border-[color-mix(in_srgb,var(--status-warn)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-warn)_12%,transparent)] text-status-warn',
  error: 'border-[color-mix(in_srgb,var(--status-error)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-error)_12%,transparent)] text-status-error',
  info: 'border-[color-mix(in_srgb,var(--color-violet)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-violet)_12%,transparent)] text-semantic-violet',
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-xs',
};

const Badge: Component<BadgeProps> = (props) => {
  const tone = () => props.tone || 'default';
  const size = () => props.size || 'sm';

  return (
    <span
      class={`inline-flex items-center rounded-md border font-medium transition-all duration-150 ${sizeClasses[size()]} ${toneClasses[tone()]} ${props.class || ''}`}
    >
      {props.children}
    </span>
  );
};

export default Badge;
