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
      class="absolute bottom-0 left-0 right-0 z-50 animate-slide-up"
      style={{
        background: 'linear-gradient(180deg, rgba(10, 16, 32, 0.98) 0%, rgba(5, 10, 20, 0.99) 100%)',
        'border-top': '1px solid rgba(0, 240, 255, 0.2)',
        'backdrop-filter': 'blur(20px)',
        'max-height': '60vh',
        'box-shadow': '0 -10px 40px rgba(0, 0, 0, 0.5)'
      }}
    >
      {/* Header */}
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <div class="flex items-center gap-4">
          {/* Status indicator */}
          <Show when={statusStyle()}>
            <div
              class="w-3 h-3 rounded-full"
              classList={{ 'animate-pulse': props.status === 'running' }}
              style={{
                background: statusStyle()!.text,
                'box-shadow': statusStyle()!.glow
              }}
            />
          </Show>

          {/* Icon */}
          <Show when={props.icon}>
            <span class="text-xl">{props.icon}</span>
          </Show>

          {/* Title & subtitle */}
          <div>
            <h3 class="text-lg font-bold text-white font-mono tracking-wide">
              {props.title}
            </h3>
            <Show when={props.subtitle}>
              <p class="text-xs text-text-muted font-mono">{props.subtitle}</p>
            </Show>
          </div>

          {/* Status badge */}
          <Show when={props.status && statusStyle()}>
            <div
              class="px-3 py-1 rounded-full text-xs font-mono uppercase tracking-wider"
              style={{
                background: statusStyle()!.bg,
                border: `1px solid ${statusStyle()!.border}`,
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
          class="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200 hover:bg-white/10"
          style={{
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}
        >
          <span class="text-text-muted text-lg">×</span>
        </button>
      </div>

      {/* Tabs */}
      <Show when={props.tabs && props.tabs.length > 0}>
        <div class="flex gap-1 px-6 py-2 border-b border-white/5 bg-white/2">
          <For each={props.tabs}>
            {(tab) => (
              <button
                onClick={() => setActiveTab(tab.id)}
                class="px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-all duration-200"
                style={{
                  background: activeTab() === tab.id
                    ? 'rgba(0, 240, 255, 0.15)'
                    : 'transparent',
                  border: activeTab() === tab.id
                    ? '1px solid rgba(0, 240, 255, 0.3)'
                    : '1px solid transparent',
                  color: activeTab() === tab.id
                    ? '#00f0ff'
                    : 'rgba(255, 255, 255, 0.6)'
                }}
              >
                {tab.label}
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* Content */}
      <div class="p-6 overflow-y-auto" style={{ 'max-height': 'calc(60vh - 140px)' }}>
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
        <div class="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10">
          <For each={props.actions}>
            {(action) => {
              const variant = actionVariants[action.variant || 'default'];
              return (
                <button
                  onClick={action.onClick}
                  class="px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-wider transition-all duration-200 flex items-center gap-2 hover:scale-105"
                  style={{
                    background: variant.bg,
                    border: `1px solid ${variant.border}`
                  }}
                >
                  <Show when={action.icon}>
                    <span>{action.icon}</span>
                  </Show>
                  {action.label}
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Corner accents */}
      <div class="absolute top-0 left-0 w-6 h-6 border-l-2 border-t-2 border-neon-cyan/40 pointer-events-none" />
      <div class="absolute top-0 right-0 w-6 h-6 border-r-2 border-t-2 border-neon-cyan/40 pointer-events-none" />

      <style>{`
        @keyframes slide-up {
          from {
            transform: translateY(100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .animate-slide-up {
          animation: slide-up 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default DetailPanel;
