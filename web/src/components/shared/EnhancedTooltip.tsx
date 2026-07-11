import { Component, For, Show, JSX } from 'solid-js';

export interface TooltipItem {
  label: string;
  value: string | number;
  color?: string;
}

export interface EnhancedTooltipProps {
  title: string;
  subtitle?: string;
  status?: 'ok' | 'warn' | 'error' | 'running' | 'pending' | 'info';
  items?: TooltipItem[];
  hint?: string;
  position: { x: number; y: number };
  anchor?: 'top' | 'bottom' | 'left' | 'right';
  children?: JSX.Element;
}

const statusColors: Record<string, string> = {
  ok: 'var(--info)',
  warn: 'var(--warning)',
  error: 'var(--error)',
  running: 'var(--success)',
  pending: 'var(--color-violet)',
  info: 'rgb(var(--fg-primary-rgb) / 0.7)'
};

const EnhancedTooltip: Component<EnhancedTooltipProps> = (props) => {
  const anchor = () => props.anchor || 'top';
  const statusColor = () => props.status ? statusColors[props.status] : 'rgb(var(--info-rgb) / 0.5)';

  // Position styles based on anchor
  const positionStyle = (): JSX.CSSProperties => {
    const base: JSX.CSSProperties = {
      position: 'fixed',
      'z-index': 'var(--z-tooltip)'
    };

    switch (anchor()) {
      case 'top':
        return {
          ...base,
          left: `${props.position.x}px`,
          top: `${props.position.y}px`,
          transform: 'translate(-50%, -100%) translateY(-8px)'
        };
      case 'bottom':
        return {
          ...base,
          left: `${props.position.x}px`,
          top: `${props.position.y}px`,
          transform: 'translate(-50%, 8px)'
        };
      case 'left':
        return {
          ...base,
          left: `${props.position.x}px`,
          top: `${props.position.y}px`,
          transform: 'translate(-100%, -50%) translateX(-8px)'
        };
      case 'right':
        return {
          ...base,
          left: `${props.position.x}px`,
          top: `${props.position.y}px`,
          transform: 'translate(8px, -50%)'
        };
      default:
        return base;
    }
  };

  // Arrow position based on anchor
  const arrowStyle = (): JSX.CSSProperties => {
    const baseArrow: JSX.CSSProperties = {
      position: 'absolute',
      width: '10px',
      height: '10px',
      background: 'rgba(0, 0, 0, 0.95)',
      transform: 'rotate(45deg)',
      'border-color': `color-mix(in srgb, ${statusColor()} 25%, transparent)`
    };

    switch (anchor()) {
      case 'top':
        return {
          ...baseArrow,
          bottom: '-5px',
          left: '50%',
          'margin-left': '-5px',
          'border-bottom': '1px solid',
          'border-right': '1px solid'
        };
      case 'bottom':
        return {
          ...baseArrow,
          top: '-5px',
          left: '50%',
          'margin-left': '-5px',
          'border-top': '1px solid',
          'border-left': '1px solid'
        };
      case 'left':
        return {
          ...baseArrow,
          right: '-5px',
          top: '50%',
          'margin-top': '-5px',
          'border-top': '1px solid',
          'border-right': '1px solid'
        };
      case 'right':
        return {
          ...baseArrow,
          left: '-5px',
          top: '50%',
          'margin-top': '-5px',
          'border-bottom': '1px solid',
          'border-left': '1px solid'
        };
      default:
        return baseArrow;
    }
  };

  return (
    <div
      class="pointer-events-none animate-tooltip-appear"
      style={positionStyle()}
    >
      <div
        class="relative px-3 py-2 rounded-lg text-xs font-mono min-w-[140px] max-w-[280px]"
        style={{
          background: 'rgba(0, 0, 0, 0.95)',
          border: `1px solid color-mix(in srgb, ${statusColor()} 25%, transparent)`,
          'box-shadow': `0 4px 20px rgba(0, 0, 0, 0.5), 0 0 20px color-mix(in srgb, ${statusColor()} 8%, transparent)`
        }}
      >
        {/* Arrow */}
        <div style={arrowStyle()} />

        {/* Header */}
        <div class="flex items-center gap-2 mb-1">
          <Show when={props.status}>
            <div
              class="w-2 h-2 rounded-full flex-shrink-0"
              classList={{ 'animate-pulse': props.status === 'running' }}
              style={{
                background: statusColor(),
                'box-shadow': `0 0 8px ${statusColor()}`
              }}
            />
          </Show>
          <span class="font-bold text-white truncate">{props.title}</span>
        </div>

        {/* Subtitle */}
        <Show when={props.subtitle}>
          <div class="text-text-dim text-[10px] mb-2 truncate">
            {props.subtitle}
          </div>
        </Show>

        {/* Items */}
        <Show when={props.items && props.items.length > 0}>
          <div class="border-t border-white/10 pt-2 mt-1 space-y-1">
            <For each={props.items}>
              {(item) => (
                <div class="flex items-center justify-between gap-4">
                  <span class="text-text-muted">{item.label}</span>
                  <span
                    class="font-medium"
                    style={{ color: item.color || 'rgba(255, 255, 255, 0.9)' }}
                  >
                    {item.value}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Custom content */}
        <Show when={props.children}>
          <div class="border-t border-white/10 pt-2 mt-1">
            {props.children}
          </div>
        </Show>

        {/* Hint */}
        <Show when={props.hint}>
          <div class="border-t border-white/10 pt-2 mt-2 text-[10px] text-text-dim italic">
            {props.hint}
          </div>
        </Show>

        {/* Corner accents */}
        <div
          class="absolute top-0 left-0 w-2 h-2 border-l border-t pointer-events-none"
          style={{ 'border-color': statusColor() }}
        />
        <div
          class="absolute bottom-0 right-0 w-2 h-2 border-r border-b pointer-events-none"
          style={{ 'border-color': statusColor() }}
        />
      </div>

      <style>{`
        @keyframes tooltip-appear {
          from {
            opacity: 0;
            transform: translate(-50%, -100%) translateY(-12px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -100%) translateY(-8px) scale(1);
          }
        }

        .animate-tooltip-appear {
          animation: tooltip-appear 0.15s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default EnhancedTooltip;
