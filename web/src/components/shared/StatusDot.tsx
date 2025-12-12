import { Component } from 'solid-js';

type Status = 'ok' | 'warn' | 'error';

interface StatusDotProps {
  status: Status;
  class?: string;
}

const StatusDot: Component<StatusDotProps> = (props) => {
  const statusClasses: Record<Status, string> = {
    ok: 'status-dot-ok',
    warn: 'status-dot-warn',
    error: 'status-dot-error',
  };

  return <span class={`${statusClasses[props.status]} ${props.class || ''}`} />;
};

export default StatusDot;
