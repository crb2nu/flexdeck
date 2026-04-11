import { Component, JSX } from 'solid-js';

export type BadgeTone = 'default' | 'ok' | 'warn' | 'error' | 'info';
export type BadgeSize = 'sm' | 'md';

export interface BadgeProps {
  tone?: BadgeTone;
  size?: BadgeSize;
  class?: string;
  children: JSX.Element;
}

const toneClasses: Record<BadgeTone, string> = {
  default: 'bg-white/5 border-white/10 text-text-dim',
  ok: 'bg-status-ok/10 border-status-ok/20 text-status-ok',
  warn: 'bg-status-warn/10 border-status-warn/20 text-status-warn',
  error: 'bg-status-error/10 border-status-error/20 text-status-error',
  info: 'bg-violet-500/10 border-violet-500/20 text-violet-400',
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
      class={`inline-flex items-center rounded-md border font-medium ${sizeClasses[size()]} ${toneClasses[tone()]} ${props.class || ''}`}
    >
      {props.children}
    </span>
  );
};

export default Badge;
