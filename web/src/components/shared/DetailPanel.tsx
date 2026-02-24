import { Component, For, Show, createSignal, JSX } from 'solid-js';

export interface DetailPanelTab {
  id: string;
  label: string;
  content: () => JSX.Element;
}

export interface DetailPanelAction {
  label: string;
  icon?: string;
  variant?: 'default' | 'primary' | 'danger';
  onClick: () => void;
}

export interface DetailPanelProps {
  title: string;
  subtitle?: string;
  status?: 'ok' | 'warn' | 'error' | 'running' | 'pending';
  icon?: string;
  tabs?: DetailPanelTab[];
  actions?: DetailPanelAction[];
  onClose: () => void;
  children?: JSX.Element;
}

const statusColors: Record<string, { bg: string; border: string; text: string; glow: string }> = {
  ok: {
    bg: 'rgba(0, 240, 255, 0.1)',
    border: 'rgba(0, 240, 255, 0.3)',
    text: '#00f0ff',
    glow: '0 0 20px rgba(0, 240, 255, 0.3)'
  },
  warn: {
    bg: 'rgba(252, 238, 10, 0.1)',
    border: 'rgba(252, 238, 10, 0.3)',
    text: '#fcee0a',
    glow: '0 0 20px rgba(252, 238, 10, 0.3)'
  },
  error: {
    bg: 'rgba(255, 0, 60, 0.1)',
    border: 'rgba(255, 0, 60, 0.3)',
    text: '#ff003c',
    glow: '0 0 20px rgba(255, 0, 60, 0.3)'
  },
  running: {
    bg: 'rgba(10, 255, 104, 0.1)',
    border: 'rgba(10, 255, 104, 0.3)',
    text: '#0aff68',
    glow: '0 0 20px rgba(10, 255, 104, 0.3)'
  },
  pending: {
    bg: 'rgba(189, 0, 255, 0.1)',
    border: 'rgba(189, 0, 255, 0.3)',
    text: '#bd00ff',
    glow: '0 0 20px rgba(189, 0, 255, 0.3)'
  }
};

const actionVariants: Record<string, { bg: string; border: string; hoverBg: string }> = {
  default: {
    bg: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.2)',
    hoverBg: 'rgba(255, 255, 255, 0.1)'
  },
  primary: {
    bg: 'rgba(0, 240, 255, 0.15)',
    border: 'rgba(0, 240, 255, 0.4)',
    hoverBg: 'rgba(0, 240, 255, 0.25)'
  },
  danger: {
    bg: 'rgba(255, 0, 60, 0.15)',
    border: 'rgba(255, 0, 60, 0.4)',
    hoverBg: 'rgba(255, 0, 60, 0.25)'
  }
};

const DetailPanel: Component<DetailPanelProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal(props.tabs?.[0]?.id || '');

  const statusStyle = () => props.status ? statusColors[props.status] : null;

  return (
    <div
      class="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-bg-panel/98 backdrop-blur-xl border-t border-neon-cyan/20 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] animate-slide-up max-h-[85vh] lg:max-h-[60vh]"
    >
      {/* Header */}
      <div class="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/10">
        <div class="flex items-center gap-3 sm:gap-4">
          {/* Status indicator */}
          <Show when={statusStyle()}>
            <div
              class="w-3 h-3 rounded-full flex-shrink-0"
              classList={{ 'animate-pulse': props.status === 'running' }}
              style={{
                background: statusStyle()!.text,
                'box-shadow': statusStyle()!.glow
              }}
            />
          </Show>

          {/* Icon */}
          <Show when={props.icon}>
            <span class="text-xl flex-shrink-0">{props.icon}</span>
          </Show>

          {/* Title & subtitle */}
          <div class="min-w-0">
            <h3 class="text-base sm:text-lg font-bold text-white font-mono tracking-wide truncate">
              {props.title}
            </h3>
            <Show when={props.subtitle}>
              <p class="text-[10px] sm:text-xs text-text-muted font-mono truncate">{props.subtitle}</p>
            </Show>
          </div>

          {/* Status badge */}
          <Show when={props.status && statusStyle()}>
            <div
              class="hidden sm:block px-3 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider border"
              style={{
                background: statusStyle()!.bg,
                'border-color': statusStyle()!.border,
                color: statusStyle()!.text
              }}
            >
              {props.status}
            </div>
          </Show>
        </div>

        {/* Close button */}
        <button
          onClick={props.onClose}
          class="w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all duration-200 hover:bg-white/10 border border-white/10 text-text-muted hover:text-white"
        >
          <span class="text-2xl sm:text-lg">×</span>
        </button>
      </div>

      {/* Tabs */}
      <Show when={props.tabs && props.tabs.length > 0}>
        <div class="flex gap-1 px-4 sm:px-6 py-2 border-b border-white/5 bg-white/[0.02] overflow-x-auto no-scrollbar">
          <For each={props.tabs}>
            {(tab) => (
              <button
                onClick={() => setActiveTab(tab.id)}
                class="flex-shrink-0 px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-all duration-200 border"
                classList={{
                  'bg-neon-cyan/15 border-neon-cyan/30 text-neon-cyan': activeTab() === tab.id,
                  'border-transparent text-white/60 hover:text-white': activeTab() !== tab.id
                }}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Content */}
      <div class="p-4 sm:p-6 overflow-y-auto flex-1">
        <Show when={props.tabs && props.tabs.length > 0} fallback={props.children}>
          <For each={props.tabs}>
            {(tab) => (
              <Show when={activeTab() === tab.id}>
                {tab.content()}
              </Show>
            )}
          </For>
        </Show>
      </div>

      {/* Actions footer */}
      <Show when={props.actions && props.actions.length > 0}>
        <div class="flex items-center justify-end gap-3 px-4 sm:px-6 py-4 border-t border-white/10 bg-black/20">
          <For each={props.actions}>
            {(action) => (
              <button
                onClick={action.onClick}
                class="flex-1 sm:flex-none px-4 py-3 sm:py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-all duration-200 flex items-center justify-center gap-2 border active:scale-95"
                classList={{
                  'bg-white/5 border-white/20 hover:bg-white/10': !action.variant || action.variant === 'default',
                  'bg-neon-cyan/15 border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/25': action.variant === 'primary',
                  'bg-status-error/15 border-status-error/40 text-status-error hover:bg-status-error/25': action.variant === 'danger'
                }}
              >
                <Show when={action.icon}>
                  <span>{action.icon}</span>
                </Show>
                {action.label}
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Corner accents */}
      <div class="absolute top-0 left-0 w-6 h-6 border-l-2 border-t-2 border-neon-cyan/40 pointer-events-none" />
      <div class="absolute top-0 right-0 w-6 h-6 border-r-2 border-t-2 border-neon-cyan/40 pointer-events-none" />
    </div>
  );
};

export default DetailPanel;
