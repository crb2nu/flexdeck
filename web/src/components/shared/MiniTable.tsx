import { For, JSX } from 'solid-js';

export interface MiniColumn<T> {
  header: string;
  align?: 'left' | 'right';
  /** Extra classes for body cells (e.g. 'tabular-nums text-text-main'). */
  class?: string;
  cell: (row: T) => JSX.Element;
}

export interface MiniTableProps<T> {
  columns: MiniColumn<T>[];
  each: readonly T[];
  /** Makes rows interactive: click, Enter/Space, hover + focus affordances. */
  onRowClick?: (row: T) => void;
  /** Tighter row padding for dense read-only tables. */
  dense?: boolean;
  class?: string;
}

/**
 * A lightweight surface table for the common read-only case: column defs in,
 * keyed rows out. Pair with createPolledResource so row data keeps referential
 * identity across polls and <For> reuses the DOM. For sortable/searchable
 * tables, use DataTable instead.
 */
function MiniTable<T>(props: MiniTableProps<T>): JSX.Element {
  const cellPad = () => (props.dense ? 'px-3 py-1.5' : 'px-3 py-2');
  const alignClass = (col: MiniColumn<T>) => (col.align === 'right' ? 'text-right' : '');

  const handleKey = (e: KeyboardEvent, row: T) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      props.onRowClick?.(row);
    }
  };

  return (
    <div class={`surface overflow-hidden ${props.class ?? ''}`}>
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-white/8 text-left text-[11px] uppercase tracking-wide text-text-muted">
            <For each={props.columns}>
              {(col) => <th class={`px-3 py-2 font-medium ${alignClass(col)}`}>{col.header}</th>}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.each}>
            {(row) => (
              <tr
                class={`border-b border-white/5 last:border-0 ${
                  props.onRowClick
                    ? 'cursor-pointer hover:bg-white/[0.03] focus-visible:bg-white/[0.05] focus-visible:outline-none'
                    : ''
                }`}
                tabindex={props.onRowClick ? 0 : undefined}
                onClick={props.onRowClick ? () => props.onRowClick?.(row) : undefined}
                onKeyDown={props.onRowClick ? (e: KeyboardEvent) => handleKey(e, row) : undefined}
              >
                <For each={props.columns}>
                  {(col) => (
                    <td class={`${cellPad()} ${alignClass(col)} ${col.class ?? ''}`}>{col.cell(row)}</td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}

export default MiniTable;
