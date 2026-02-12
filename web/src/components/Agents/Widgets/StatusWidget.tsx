import { Component, For, Show, createMemo } from 'solid-js';

interface StatusWidgetProps {
  data: {
    status: 'healthy' | 'warning' | 'critical';
    message: string;
    metrics?: Record<string, string>;
    subsystems?: { name: string; status: 'ok' | 'warn' | 'error' }[];
  };
}

const StatusWidget: Component<StatusWidgetProps> = (props) => {
  const statusConfig = createMemo(() => {
    switch (props.data.status) {
      case 'healthy':
        return {
          color: 'text-status-ok',
          border: 'border-status-ok/30',
          bg: 'bg-status-ok/10',
          ring: 'var(--color-ok)',
          label: 'OPERATIONAL',
          icon: '✓',
          pingClass: 'animate-ping-slow',
        };
      case 'warning':
        return {
          color: 'text-status-warn',
          border: 'border-status-warn/30',
          bg: 'bg-status-warn/10',
          ring: 'var(--color-warn)',
          label: 'DEGRADED',
          icon: '⚠',
          pingClass: 'animate-ping-normal',
        };
      case 'critical':
        return {
          color: 'text-status-error',
          border: 'border-status-error/30',
          bg: 'bg-status-error/10',
          ring: 'var(--color-error)',
          label: 'CRITICAL',
          icon: '✕',
          pingClass: 'animate-ping-fast',
        };
      default:
        return {
          color: 'text-text-dim',
          border: 'border-white/10',
          bg: 'bg-white/5',
          ring: '#666',
          label: 'UNKNOWN',
          icon: '?',
          pingClass: '',
        };
    }
  });

  // Circumference for ring indicator (radius=20)
  const CIRCUMFERENCE = 2 * Math.PI * 20;

  const ringPercent = createMemo(() => {
    switch (props.data.status) {
      case 'healthy': return 100;
      case 'warning': return 65;
      case 'critical': return 25;
      default: return 0;
    }
  });

  const subsystemIcon = (status: string) => {
    switch (status) {
      case 'ok': return { icon: '●', cls: 'text-status-ok' };
      case 'warn': return { icon: '●', cls: 'text-status-warn' };
      case 'error': return { icon: '●', cls: 'text-status-error' };
      default: return { icon: '○', cls: 'text-text-dim' };
    }
  };

  return (
    <div class={`rounded-lg border p-4 ${statusConfig().border} ${statusConfig().bg}`}>
      {/* Header with animated status ring */}
      <div class="flex items-center gap-3 mb-3">
        {/* Animated ring indicator */}
        <div class="relative flex-shrink-0">
          <svg width="48" height="48" viewBox="0 0 48 48" class="transform -rotate-90">
            {/* Track */}
            <circle
              cx="24" cy="24" r="20"
              fill="none"
              stroke="white" stroke-opacity="0.08"
              stroke-width="3"
            />
            {/* Progress ring */}
            <circle
              cx="24" cy="24" r="20"
              fill="none"
              stroke={statusConfig().ring}
              stroke-width="3"
              stroke-linecap="round"
              stroke-dasharray={`${(ringPercent() / 100) * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              class="transition-all duration-1000 ease-out"
            />
          </svg>
          {/* Center icon */}
          <div class={`absolute inset-0 flex items-center justify-center text-sm font-bold ${statusConfig().color}`}>
            {statusConfig().icon}
          </div>
          {/* Ping ring */}
          <div
            class={`absolute inset-0 rounded-full border-2 ${statusConfig().pingClass}`}
            style={{ 'border-color': statusConfig().ring }}
          />
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-0.5">
            <span class={`font-bold uppercase tracking-wider text-xs ${statusConfig().color}`}>
              {statusConfig().label}
            </span>
            <span class="relative flex h-2 w-2">
              <span class={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${statusConfig().color} bg-current`} />
              <span class={`relative inline-flex rounded-full h-2 w-2 ${statusConfig().color} bg-current`} />
            </span>
          </div>
          <div class="text-sm font-mono text-text-main truncate">
            {props.data.message}
          </div>
        </div>
      </div>

      {/* Subsystems grid */}
      <Show when={props.data.subsystems && props.data.subsystems.length > 0}>
        <div class="border-t border-black/20 pt-2 mt-2 mb-2">
          <div class="text-[9px] uppercase tracking-wider text-text-dim mb-1.5 font-bold">Subsystems</div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1">
            <For each={props.data.subsystems}>
              {(sub) => {
                const s = subsystemIcon(sub.status);
                return (
                  <div class="flex items-center gap-1.5 text-xs">
                    <span class={`text-[8px] ${s.cls}`}>{s.icon}</span>
                    <span class="text-text-dim capitalize">{sub.name}</span>
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </Show>

      {/* Metrics */}
      <Show when={props.data.metrics && Object.keys(props.data.metrics).length > 0}>
        <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-black/20 pt-3 mt-2">
          <For each={Object.entries(props.data.metrics!)}>
            {([key, val]) => (
              <div class="flex items-center justify-between text-xs">
                <span class="opacity-60 capitalize font-mono">{key}</span>
                <span class={`font-bold font-mono ${statusConfig().color}`}>{val}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default StatusWidget;
