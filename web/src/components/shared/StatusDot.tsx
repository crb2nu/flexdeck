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

  const statusBg: Record<Status, string> = {
    ok: 'bg-status-ok',
    warn: 'bg-status-warn',
    error: 'bg-status-error',
    running: 'bg-status-ok',
    pending: 'bg-yellow-400',
    scaling: 'bg-violet-400',
    unknown: 'bg-gray-500',
  };

  const shouldAnimate = () => {
    if (props.animate !== undefined) return props.animate;
    return props.status === 'running' || props.status === 'scaling' || props.status === 'pending';
  };

  const bg = statusBg[props.status] || statusBg.unknown;
  const size = sizeClasses[props.size || 'md'];

  return (
    <span
      class={`inline-block rounded-full ${size} ${bg} ${shouldAnimate() ? 'animate-pulse' : ''} ${props.class || ''}`}
    />
  );
};

export default StatusDot;
