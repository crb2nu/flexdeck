import { Component, For, Show, createUniqueId, splitProps, JSX } from 'solid-js';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  placeholder?: string;
  /** Renders an associated <label> above the select, wired via for/id. */
  label?: string;
  /** Visual density. 'sm' matches compact toolbar rows. */
  size?: 'md' | 'sm';
  /** Extra classes on the <select> itself (e.g. font-mono). `class` styles the wrapper. */
  selectClass?: string;
}

const Select: Component<SelectProps> = (props) => {
  const [local, rest] = splitProps(props, ['options', 'placeholder', 'class', 'label', 'size', 'id', 'selectClass']);
  const autoId = createUniqueId();
  const selectId = () => local.id ?? (local.label ? `select-${autoId}` : undefined);
  const sm = () => local.size === 'sm';

  const field = (
    <div class={`relative ${local.label ? '' : local.class || ''}`}>
      <select
        id={selectId()}
        class={`w-full rounded-md border border-white/10 bg-white/5 text-white transition-all duration-150 focus:border-white/20 focus:bg-white/[0.07] focus:shadow-[0_0_0_1px_rgba(255,255,255,0.1)] focus:outline-none appearance-none cursor-pointer hover:border-white/15 hover:bg-white/[0.06] ${sm() ? 'text-xs pl-2 pr-7 py-1' : 'text-sm pl-3 pr-8 py-1.5'} ${local.selectClass || ''}`}
        {...rest}
      >
        {local.placeholder && <option value="">{local.placeholder}</option>}
        <For each={local.options}>
          {(opt) => <option value={opt.value}>{opt.label}</option>}
        </For>
      </select>
      <svg
        class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  );

  return (
    <Show when={local.label} fallback={field}>
      <div class={local.class || ''}>
        <label for={selectId()} class="mb-1 block text-[10px] uppercase tracking-wide text-text-dim">
          {local.label}
        </label>
        {field}
      </div>
    </Show>
  );
};

export default Select;
