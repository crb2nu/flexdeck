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
        <svg class="h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
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
      <div class="flex flex-1 items-center justify-center py-16 animate-fade-in">
        <div class="surface flex flex-col items-center gap-4 p-8 text-center max-w-sm">
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-status-error/10 border border-status-error/20">
            <svg class="h-6 w-6 text-status-error" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p class="text-sm text-status-error font-medium">{props.message}</p>
          <Show when={props.onRetry}>
            <button
              onClick={props.onRetry}
              class="mt-1 rounded-md border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-text-muted hover:bg-white/10 hover:text-text-main transition-all duration-150"
            >
              Try again
            </button>
          </Show>
        </div>
      </div>
    );
  }

  // banner (default)
  return (
    <div class="surface flex items-center gap-3 p-4 text-sm text-status-error animate-fade-in">
      <svg class="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
      <span class="flex-1">{props.message}</span>
      <Show when={props.onRetry}>
        <button
          onClick={props.onRetry}
          class="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs text-text-muted hover:bg-white/10 hover:text-text-main transition-all duration-150 flex-shrink-0"
        >
          Retry
        </button>
      </Show>
    </div>
  );
};

export default ErrorState;
