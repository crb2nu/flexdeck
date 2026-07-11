import { Component, For, Show, createSignal, onCleanup, onMount, JSX } from 'solid-js';
import TabBar from './TabBar';

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

const statusColors: Record<string, { bg: string; border: string; text: string }> = {
  ok: { bg: 'rgb(var(--color-blue-rgb) / 0.08)', border: 'rgb(var(--color-blue-rgb) / 0.2)', text: 'var(--color-blue)' },
  warn: { bg: 'rgb(var(--color-amber-rgb) / 0.08)', border: 'rgb(var(--color-amber-rgb) / 0.2)', text: 'var(--color-amber)' },
  error: { bg: 'rgb(var(--color-red-rgb) / 0.08)', border: 'rgb(var(--color-red-rgb) / 0.2)', text: 'var(--color-red)' },
  running: { bg: 'rgb(var(--color-emerald-rgb) / 0.08)', border: 'rgb(var(--color-emerald-rgb) / 0.2)', text: 'var(--color-emerald)' },
  pending: { bg: 'rgb(var(--color-violet-rgb) / 0.08)', border: 'rgb(var(--color-violet-rgb) / 0.2)', text: 'var(--color-violet)' },
};

const DetailPanel: Component<DetailPanelProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal(props.tabs?.[0]?.id || '');
  let panelRef: HTMLDivElement | undefined;

  const statusStyle = () => props.status ? statusColors[props.status] : null;

  onMount(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    });
  });

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      tabindex="-1"
      class="fixed inset-x-0 bottom-0 z-modal flex flex-col bg-bg-dark border-t border-white/[0.08] shadow-elevated animate-slide-up max-h-[85dvh] lg:max-h-[60dvh] focus:outline-none"
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
              }}
            />
          </Show>

          {/* Icon */}
          <Show when={props.icon}>
            <span class="text-xl flex-shrink-0">{props.icon}</span>
          </Show>

          {/* Title & subtitle */}
          <div class="min-w-0">
            <h3 class="text-base sm:text-lg font-semibold text-white tracking-tight truncate">
              {props.title}
            </h3>
            <Show when={props.subtitle}>
              <p class="text-[10px] sm:text-xs text-text-muted truncate">{props.subtitle}</p>
            </Show>
          </div>

          {/* Status badge */}
          <Show when={props.status && statusStyle()}>
            <div
              class="hidden sm:block px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wide border"
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
          aria-label="Close panel"
          class="w-10 h-10 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center transition-all duration-200 hover:bg-white/10 border border-white/10 text-text-muted hover:text-white"
        >
          <span class="text-2xl sm:text-lg">×</span>
        </button>
      </div>

      {/* Tabs */}
      <Show when={props.tabs && props.tabs.length > 0}>
        <div class="px-4 sm:px-6 py-2 border-b border-white/5 bg-white/[0.02]">
          <TabBar
            tabs={props.tabs!.map((tab) => ({ id: tab.id, label: tab.label }))}
            active={activeTab()}
            onChange={setActiveTab}
            variant="pill"
            size="sm"
          />
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
                class="flex-1 sm:flex-none px-3 py-2 sm:py-1.5 rounded-md text-xs font-medium transition-all duration-150 flex items-center justify-center gap-2 border active:scale-95"
                classList={{
                  'bg-white/5 border-white/20 hover:bg-white/10': !action.variant || action.variant === 'default',
                  'bg-white/10 border-white/20 text-white hover:bg-white/15': action.variant === 'primary',
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

    </div>
  );
};

export default DetailPanel;
