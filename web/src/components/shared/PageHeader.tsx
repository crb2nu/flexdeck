import { Component, Show, JSX } from 'solid-js';

export interface PageHeaderProps {
  title: string;
  accent?: string;
  subtitle?: string;
  lastUpdated?: string | Date | null;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  children?: JSX.Element;
}

const PageHeader: Component<PageHeaderProps> = (props) => {
  const fmtUpdated = () => {
    const v = props.lastUpdated;
    if (!v) return null;
    if (v instanceof Date) return v.toLocaleTimeString();
    // Assume numeric ms timestamp
    const n = typeof v === 'string' ? Number(v) : null;
    if (n && !isNaN(n)) {
      const diff = Date.now() - n;
      if (diff < 5000) return 'just now';
      if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
      return `${Math.round(diff / 60000)}m ago`;
    }
    return String(v);
  };

  return (
    <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="heading-page">
          {props.title}
          <Show when={props.accent}>
            <span class="text-white">{props.accent}</span>
          </Show>
        </h1>
        <Show when={props.subtitle}>
          <p class="text-xs text-text-dim">{props.subtitle}</p>
        </Show>
      </div>
      <div class="flex items-center gap-3">
        <Show when={fmtUpdated()}>
          <span class="font-mono text-[10px] text-text-dim/70">Updated <span class="text-text-dim">{fmtUpdated()}</span></span>
        </Show>
        <Show when={props.onRefresh}>
          <button
            class="group/refresh inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs text-text-muted transition-all duration-150 hover:bg-white/10 hover:text-text-main hover:border-white/15 disabled:opacity-50 disabled:pointer-events-none"
            onClick={() => props.onRefresh!()}
            disabled={props.refreshDisabled}
          >
            <svg class="h-3 w-3 transition-transform duration-300 group-hover/refresh:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </Show>
        {props.children}
      </div>
    </div>
  );
};

export default PageHeader;
