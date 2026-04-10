/* @vitest-environment jsdom */

import { render } from 'solid-js/web';
import { describe, expect, it, afterEach } from 'vitest';
import DataTable from './DataTable';
import type { ColumnDef } from './DataTable';

interface Row {
  id: string;
  name: string;
  value: number;
}

const columns: ColumnDef<Row>[] = [
  { id: 'name', header: 'Name', accessor: (r) => r.name, sortable: true },
  { id: 'value', header: 'Value', accessor: (r) => r.value, sortable: true, align: 'right' },
];

const data: Row[] = [
  { id: '1', name: 'Charlie', value: 30 },
  { id: '2', name: 'Alice', value: 10 },
  { id: '3', name: 'Bob', value: 20 },
];

describe('DataTable', () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  function mount(props?: Partial<{ defaultSort: { column: string; direction: 'asc' | 'desc' } }>) {
    container = document.createElement('div');
    document.body.appendChild(container);
    dispose = render(
      () => (
        <DataTable
          data={data}
          columns={columns}
          rowKey={(r) => r.id}
          defaultSort={props?.defaultSort}
        />
      ),
      container,
    );
  }

  afterEach(() => {
    dispose?.();
    container?.remove();
    document.body.innerHTML = '';
  });

  it('renders rows in original order without default sort', () => {
    mount();
    const cells = container.querySelectorAll('tbody td:first-child');
    expect(cells[0].textContent).toBe('Charlie');
    expect(cells[1].textContent).toBe('Alice');
    expect(cells[2].textContent).toBe('Bob');
  });

  it('sorts ascending by name when defaultSort is set', () => {
    mount({ defaultSort: { column: 'name', direction: 'asc' } });
    const cells = container.querySelectorAll('tbody td:first-child');
    expect(cells[0].textContent).toBe('Alice');
    expect(cells[1].textContent).toBe('Bob');
    expect(cells[2].textContent).toBe('Charlie');
  });

  it('toggles sort direction on header click', () => {
    mount({ defaultSort: { column: 'name', direction: 'asc' } });

    // Click Name header to toggle to descending
    const nameHeader = container.querySelector('thead th') as HTMLElement;
    nameHeader.click();

    const cells = container.querySelectorAll('tbody td:first-child');
    expect(cells[0].textContent).toBe('Charlie');
    expect(cells[1].textContent).toBe('Bob');
    expect(cells[2].textContent).toBe('Alice');
  });

  it('sorts by a different column on header click', () => {
    mount();

    // Click Value header (second th)
    const headers = container.querySelectorAll('thead th');
    (headers[1] as HTMLElement).click();

    const valueCells = container.querySelectorAll('tbody td:nth-child(2)');
    expect(valueCells[0].textContent).toBe('10');
    expect(valueCells[1].textContent).toBe('20');
    expect(valueCells[2].textContent).toBe('30');
  });

  it('shows empty state when data is empty', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    dispose = render(
      () => (
        <DataTable
          data={[]}
          columns={columns}
          rowKey={(r: Row) => r.id}
          emptyTitle="Nothing here"
        />
      ),
      container,
    );

    expect(container.textContent).toContain('Nothing here');
  });
});
