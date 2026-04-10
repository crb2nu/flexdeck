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
        <h1 class="text-lg font-bold text-text-main">
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
          <span class="font-mono text-[10px] text-text-dim">Updated {fmtUpdated()}</span>
        </Show>
        <Show when={props.onRefresh}>
          <button
            class="rounded border border-white/10 bg-white/5 px-3 py-1 text-xs text-text-muted transition-colors hover:bg-white/10 hover:text-text-main disabled:opacity-50"
            onClick={() => props.onRefresh!()}
            disabled={props.refreshDisabled}
          >
            Refresh
          </button>
        </Show>
        {props.children}
      </div>
    </div>
  );
};

export default PageHeader;
