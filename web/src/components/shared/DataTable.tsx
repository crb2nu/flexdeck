import { Component, For, Show, JSX, createSignal, createMemo } from 'solid-js';
import EmptyState from './EmptyState';

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessor: (row: T) => any;
  cell?: (value: any, row: T) => JSX.Element;
  sortable?: boolean;
  align?: 'left' | 'right';
  mono?: boolean;
  width?: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  rowKey: (row: T) => string;
  defaultSort?: { column: string; direction: 'asc' | 'desc' };
  onRowClick?: (row: T) => void;
  loading?: boolean;
  emptyIcon?: JSX.Element;
  emptyTitle?: string;
  stickyHeader?: boolean;
}

function DataTable<T>(props: DataTableProps<T>): JSX.Element {
  const [sortCol, setSortCol] = createSignal(props.defaultSort?.column ?? '');
  const [sortDir, setSortDir] = createSignal<'asc' | 'desc'>(props.defaultSort?.direction ?? 'asc');

  const handleSort = (colId: string) => {
    if (sortCol() === colId) {
      setSortDir(sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(colId);
      setSortDir('asc');
    }
  };

  const sortedData = createMemo(() => {
    const col = props.columns.find((c) => c.id === sortCol());
    if (!col || !col.sortable) return props.data;

    const dir = sortDir() === 'asc' ? 1 : -1;
    return [...props.data].sort((a, b) => {
      const va = col.accessor(a);
      const vb = col.accessor(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  });

  return (
    <Show
      when={props.data.length > 0}
      fallback={
        <EmptyState size="sm" icon={props.emptyIcon} title={props.emptyTitle ?? 'No data'} />
      }
    >
      <table class="w-full text-sm">
        <thead
          class="border-b border-white/[0.08] text-left text-xs uppercase text-text-dim"
          classList={{ 'sticky top-0 bg-bg-dark z-10': props.stickyHeader !== false }}
        >
          <tr>
            <For each={props.columns}>
              {(col) => (
                <th
                  class="px-4 py-3 font-medium"
                  classList={{
                    'text-right': col.align === 'right',
                    'cursor-pointer select-none hover:text-text-dim transition-colors': !!col.sortable,
                    'text-text-muted border-b border-white/20': col.sortable && sortCol() === col.id,
                  }}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={col.sortable ? () => handleSort(col.id) : undefined}
                >
                  <span class="inline-flex items-center gap-1">
                    {col.header}
                    <Show when={col.sortable && sortCol() === col.id}>
                      <span class="text-text-dim">{sortDir() === 'asc' ? '\u2191' : '\u2193'}</span>
                    </Show>
                  </span>
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={sortedData()}>
            {(row) => (
              <tr
                class="border-b border-white/5 hover:bg-white/[0.03] transition-colors duration-100 even:bg-white/[0.02]"
                classList={{ 'cursor-pointer': !!props.onRowClick }}
                onClick={props.onRowClick ? () => props.onRowClick!(row) : undefined}
              >
                <For each={props.columns}>
                  {(col) => {
                    const value = col.accessor(row);
                    return (
                      <td
                        class="px-4 py-3"
                        classList={{
                          'text-right': col.align === 'right',
                          'font-mono text-xs': !!col.mono,
                        }}
                      >
                        {col.cell ? col.cell(value, row) : <span class="text-text-dim">{value ?? '-'}</span>}
                      </td>
                    );
                  }}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </Show>
  );
}

export default DataTable;
