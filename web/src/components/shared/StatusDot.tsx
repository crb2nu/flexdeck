import { Component } from 'solid-js';

export type Status = 'ok' | 'warn' | 'error' | 'running' | 'pending' | 'scaling' | 'unknown';

interface StatusDotProps {
  status: Status;
  class?: string;
  animate?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const StatusDot: Component<StatusDotProps> = (props) => {
  const sizeClasses = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  };

  const statusStyles: Record<Status, { bg: string; glow: string }> = {
    ok: {
      bg: 'bg-status-ok',
      glow: 'shadow-[0_0_8px_rgba(34,197,94,0.5)]',
    },
    warn: {
      bg: 'bg-status-warn',
      glow: 'shadow-[0_0_8px_rgba(249,115,22,0.5)]',
    },
    error: {
      bg: 'bg-status-error',
      glow: 'shadow-[0_0_8px_rgba(239,68,68,0.5)]',
    },
    running: {
      bg: 'bg-neon-green',
      glow: 'shadow-[0_0_8px_rgba(10,255,104,0.5)]',
    },
    pending: {
      bg: 'bg-neon-yellow',
      glow: 'shadow-[0_0_8px_rgba(252,238,10,0.5)]',
    },
    scaling: {
      bg: 'bg-neon-purple',
      glow: 'shadow-[0_0_8px_rgba(189,0,255,0.5)]',
    },
    unknown: {
      bg: 'bg-gray-500',
      glow: '',
    },
  };

  const shouldAnimate = () => {
    if (props.animate !== undefined) return props.animate;
    // Auto-animate for running and scaling states
    return props.status === 'running' || props.status === 'scaling' || props.status === 'pending';
  };

  const style = statusStyles[props.status] || statusStyles.unknown;
  const size = sizeClasses[props.size || 'md'];

  return (
    <span
      class={`
        inline-block rounded-full
        ${size}
        ${style.bg}
        ${style.glow}
        ${shouldAnimate() ? 'animate-pulse' : ''}
        ${props.class || ''}
      `}
    />
  );
};

export default StatusDot;
