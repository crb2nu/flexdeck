import { Component, For, splitProps, JSX } from 'solid-js';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<JSX.SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
  placeholder?: string;
}

const Select: Component<SelectProps> = (props) => {
  const [local, rest] = splitProps(props, ['options', 'placeholder', 'class']);

  return (
    <div class={`relative ${local.class || ''}`}>
      <select
        class="w-full rounded-md border border-white/10 bg-white/5 text-sm text-white transition-all duration-150 focus:border-white/20 focus:bg-white/[0.07] focus:shadow-[0_0_0_1px_rgba(255,255,255,0.1)] focus:outline-none pl-3 pr-8 py-1.5 appearance-none cursor-pointer hover:border-white/15 hover:bg-white/[0.06]"
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
};

export default Select;
