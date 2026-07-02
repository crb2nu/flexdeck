import { Component, JSX, Show } from 'solid-js';

export interface ListRowProps {
  /** When set, the row renders as a real <button> (keyboard + focus for free). */
  onClick?: () => void;
  /** Tighter vertical padding for dense lists. */
  dense?: boolean;
  class?: string;
  /** Leading block; truncates via min-w-0. */
  children: JSX.Element;
  /** Right-aligned block (badges, timestamps); never shrinks. */
  trailing?: JSX.Element;
}

/**
 * The standard surface list row: leading content, optional trailing badges.
 * Clickable rows are native buttons with hover/focus affordances.
 */
const ListRow: Component<ListRowProps> = (props) => {
  const content = () => (
    <>
      <div class="min-w-0 flex-1">{props.children}</div>
      <Show when={props.trailing}>
        <div class="flex flex-shrink-0 items-center gap-2">{props.trailing}</div>
      </Show>
    </>
  );

  const pad = () => (props.dense ? 'px-3 py-1.5' : 'px-3 py-2');

  return (
    <Show
      when={props.onClick}
      fallback={
        <div class={`surface flex items-center justify-between gap-3 ${pad()} ${props.class ?? ''}`}>
          {content()}
        </div>
      }
    >
      <button
        type="button"
        onClick={() => props.onClick?.()}
        class={`surface flex w-full items-center justify-between gap-3 ${pad()} text-left transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.05] ${props.class ?? ''}`}
      >
        {content()}
      </button>
    </Show>
  );
};

export default ListRow;
