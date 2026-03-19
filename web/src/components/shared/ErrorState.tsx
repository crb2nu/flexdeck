import { Component, Show } from 'solid-js';

export interface ErrorStateProps {
  message: string;
  variant?: 'banner' | 'inline' | 'full';
  onRetry?: () => void;
}

const ErrorState: Component<ErrorStateProps> = (props) => {
  const variant = () => props.variant ?? 'banner';

  if (variant() === 'inline') {
    return (
      <span class="inline-flex items-center gap-2 text-sm text-status-error">
        <span>{props.message}</span>
        <Show when={props.onRetry}>
          <button onClick={props.onRetry} class="text-xs underline hover:text-status-error/80 transition-colors">
            Retry
          </button>
        </Show>
      </span>
    );
  }

  if (variant() === 'full') {
    return (
      <div class="flex flex-1 items-center justify-center py-16">
        <div class="glass-panel flex flex-col items-center gap-3 p-6 text-center max-w-sm">
          <span class="text-2xl">&#9888;</span>
          <p class="text-sm text-status-error">{props.message}</p>
          <Show when={props.onRetry}>
            <button
              onClick={props.onRetry}
              class="mt-2 rounded border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-text-muted hover:bg-white/10 hover:text-text-main transition-colors"
            >
              Retry
            </button>
          </Show>
        </div>
      </div>
    );
  }

  // banner (default)
  return (
    <div class="glass-panel flex items-center justify-between p-4 text-sm text-status-error">
      <span>{props.message}</span>
      <Show when={props.onRetry}>
        <button
          onClick={props.onRetry}
          class="rounded border border-white/10 bg-white/5 px-3 py-1 text-xs text-text-muted hover:bg-white/10 hover:text-text-main transition-colors"
        >
          Retry
        </button>
      </Show>
    </div>
  );
};

export default ErrorState;
