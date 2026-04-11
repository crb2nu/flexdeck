import { Component, Show, splitProps, JSX } from 'solid-js';

export interface InputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'children'> {
  icon?: JSX.Element;
  onClear?: () => void;
}

const Input: Component<InputProps> = (props) => {
  const [local, rest] = splitProps(props, ['icon', 'onClear', 'class', 'value']);

  return (
    <div class={`relative flex items-center ${local.class || ''}`}>
      <Show when={local.icon}>
        <span class="absolute left-2.5 text-text-muted pointer-events-none">{local.icon}</span>
      </Show>
      <input
        class={`w-full rounded-md border border-white/10 bg-white/5 text-sm text-white placeholder:text-text-muted transition-all duration-150 hover:border-white/15 focus:border-white/20 focus:bg-white/[0.07] focus:shadow-[0_0_0_1px_rgba(255,255,255,0.1)] focus:outline-none ${local.icon ? 'pl-8' : 'pl-3'} ${local.onClear && local.value ? 'pr-8' : 'pr-3'} py-1.5`}
        value={local.value}
        {...rest}
      />
      <Show when={local.onClear && local.value}>
        <button
          type="button"
          onClick={local.onClear}
          class="absolute right-2 text-text-muted hover:text-white transition-colors"
          aria-label="Clear"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </Show>
    </div>
  );
};

export default Input;
