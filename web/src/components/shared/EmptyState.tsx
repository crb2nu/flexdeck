import { Component, Show, JSX } from 'solid-js';

export interface EmptyStateProps {
  icon?: string | JSX.Element;
  title: string;
  subtitle?: string;
  size?: 'sm' | 'md';
  action?: {
    label: string;
    onClick: () => void;
  };
}

const EmptyState: Component<EmptyStateProps> = (props) => {
  const size = () => props.size ?? 'md';
  const isSmall = () => size() === 'sm';

  const renderIcon = () => {
    const icon = props.icon;
    if (!icon) return null;
    if (typeof icon === 'string') {
      return <div class={`${isSmall() ? 'mb-2 text-3xl' : 'mb-4 text-6xl'} text-text-muted/30`}>{icon}</div>;
    }
    return <div class={`${isSmall() ? 'mb-2' : 'mb-3'} opacity-30`}>{icon}</div>;
  };

  return (
    <div class={`flex items-center justify-center text-text-dim animate-fade-in ${isSmall() ? 'h-48' : 'flex-1 py-16'}`}>
      <div class="text-center">
        {renderIcon()}
        <h3 class={`${isSmall() ? 'text-sm' : 'text-xl'} font-medium text-text-main mb-1`}>
          {props.title}
        </h3>
        <Show when={props.subtitle}>
          <p class={`${isSmall() ? 'text-xs' : 'text-sm'} text-text-dim`}>{props.subtitle}</p>
        </Show>
        <Show when={props.action}>
          <button
            onClick={() => props.action!.onClick()}
            class="mt-4 rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/15"
          >
            {props.action!.label}
          </button>
        </Show>
      </div>
    </div>
  );
};

export default EmptyState;
