import { Component, JSX, Show, splitProps } from 'solid-js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-white/10 border-white/20 text-white hover:bg-white/15 hover:shadow-[0_0_12px_rgb(var(--info-rgb)/0.1)] active:bg-white/20',
  secondary: 'bg-white/5 border-white/10 text-text-dim hover:bg-white/10 hover:text-white hover:border-white/15',
  ghost: 'bg-transparent border-transparent text-text-dim hover:bg-white/5 hover:text-white',
  danger: 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 hover:shadow-[0_0_12px_rgb(var(--error-rgb)/0.1)]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1.5',
  md: 'px-3 py-1.5 text-sm gap-2',
};

const Button: Component<ButtonProps> = (props) => {
  const [local, rest] = splitProps(props, ['variant', 'size', 'loading', 'class', 'children', 'disabled']);
  const variant = () => local.variant || 'secondary';
  const size = () => local.size || 'md';

  return (
    <button
      class={`inline-flex items-center justify-center rounded-md border font-medium transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none ${sizeClasses[size()]} ${variantClasses[variant()]} ${local.class || ''}`}
      disabled={local.disabled || local.loading}
      {...rest}
    >
      <Show when={local.loading}>
        <span class={`${size() === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} animate-spin rounded-full border-2 border-current/20 border-t-current`} />
      </Show>
      {local.children}
    </button>
  );
};

export default Button;
