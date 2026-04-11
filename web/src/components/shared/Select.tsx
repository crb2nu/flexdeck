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
    <select
      class={`rounded-md border border-white/10 bg-white/5 text-sm text-white transition-colors duration-100 focus:border-white/20 focus:bg-white/[0.07] focus:outline-none px-3 py-1.5 appearance-none cursor-pointer ${local.class || ''}`}
      {...rest}
    >
      {local.placeholder && <option value="">{local.placeholder}</option>}
      <For each={local.options}>
        {(opt) => <option value={opt.value}>{opt.label}</option>}
      </For>
    </select>
  );
};

export default Select;
