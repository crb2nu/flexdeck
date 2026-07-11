import { Component, Show, createUniqueId, splitProps, JSX } from 'solid-js';

export interface InputProps extends Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'children'> {
  icon?: JSX.Element;
  onClear?: () => void;
  /** Renders an associated <label> above the input, wired via for/id. */
  label?: string;
  /** Visual density. 'sm' matches compact toolbar rows. */
  size?: 'md' | 'sm';
  /** Extra classes on the <input> itself (e.g. font-mono). `class` styles the wrapper. */
  inputClass?: string;
}

const Input: Component<InputProps> = (props) => {
  const [local, rest] = splitProps(props, ['icon', 'onClear', 'class', 'value', 'label', 'size', 'id', 'inputClass']);
  const autoId = createUniqueId();
  const inputId = () => local.id ?? (local.label ? `input-${autoId}` : undefined);
  const sm = () => local.size === 'sm';

  const field = (
    <div class={`relative flex items-center ${local.label ? '' : local.class || ''}`}>
      <Show when={local.icon}>
        <span class="absolute left-2.5 text-text-muted pointer-events-none">{local.icon}</span>
      </Show>
      <input
        id={inputId()}
        class={`w-full rounded-md border border-white/10 bg-white/5 text-white placeholder:text-text-muted transition-all duration-150 hover:border-white/15 focus:border-white/20 focus:bg-white/[0.07] focus:shadow-[0_0_0_1px_rgba(255,255,255,0.1)] focus:outline-none ${sm() ? 'text-xs py-1' : 'text-sm py-1.5'} ${local.icon ? 'pl-8' : sm() ? 'pl-2' : 'pl-3'} ${local.onClear && local.value ? 'pr-8' : sm() ? 'pr-2' : 'pr-3'} ${local.inputClass || ''}`}
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

  return (
    <Show when={local.label} fallback={field}>
      <div class={local.class || ''}>
        <label for={inputId()} class="mb-1 block text-[10px] uppercase tracking-wide text-text-dim">
          {local.label}
        </label>
        {field}
      </div>
    </Show>
  );
};

export default Input;
