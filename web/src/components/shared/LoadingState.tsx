import { Component, Show } from 'solid-js';

export interface LoadingStateProps {
  message?: string;
  variant?: 'spinner' | 'inline' | 'skeleton';
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_MAP = {
  sm: { spinner: 'h-4 w-4', text: 'text-xs', icon: 'text-2xl' },
  md: { spinner: 'h-6 w-6', text: 'text-sm', icon: 'text-4xl' },
  lg: { spinner: 'h-8 w-8', text: 'text-base', icon: 'text-4xl' },
} as const;

const LoadingState: Component<LoadingStateProps> = (props) => {
  const variant = () => props.variant ?? 'spinner';
  const size = () => props.size ?? 'md';

  if (variant() === 'skeleton') {
    return (
      <div class="flex flex-col gap-3 p-4 animate-fade-in">
        <div class="skeleton h-4 w-3/4 rounded" />
        <div class="skeleton h-4 w-1/2 rounded" />
        <div class="skeleton h-8 w-full rounded-md" />
        <div class="flex gap-3">
          <div class="skeleton h-20 flex-1 rounded-md" />
          <div class="skeleton h-20 flex-1 rounded-md" />
          <div class="skeleton h-20 flex-1 rounded-md" />
        </div>
      </div>
    );
  }

  return (
    <Show
      when={variant() === 'spinner'}
      fallback={
        <span class={`inline-flex items-center gap-2 ${SIZE_MAP[size()].text}`}>
          <span class={`${SIZE_MAP[size()].spinner} animate-spin rounded-full border-2 border-white/10 border-t-white/50`} />
          <Show when={props.message}>
            <span class="text-text-dim">{props.message}</span>
          </Show>
        </span>
      }
    >
      <div class="flex flex-1 items-center justify-center py-16">
        <div class="flex flex-col items-center gap-3">
          <div class={`${SIZE_MAP[size()].spinner} animate-spin rounded-full border-2 border-white/10 border-t-white/50`} />
          <Show when={props.message}>
            <p class={`text-text-dim ${SIZE_MAP[size()].text}`}>{props.message}</p>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default LoadingState;
