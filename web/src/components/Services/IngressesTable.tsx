import { Component, For } from 'solid-js';
import type { K8sIngress } from '../../lib/types';
import DataTable from '../shared/DataTable';
import type { ColumnDef } from '../shared/DataTable';

const columns: ColumnDef<K8sIngress>[] = [
  {
    id: 'name',
    header: 'Name',
    accessor: (i) => i.metadata?.name ?? '',
    cell: (v) => <span class="font-medium text-text-main">{v}</span>,
    sortable: true,
  },
  {
    id: 'namespace',
    header: 'Namespace',
    accessor: (i) => i.metadata?.namespace ?? '',
    sortable: true,
  },
  {
    id: 'hosts',
    header: 'Hosts',
    accessor: (i) => i.spec?.rules?.map((r) => r.host).filter(Boolean).join(', ') || '-',
    cell: (_, i) => {
      const hosts = i.spec?.rules?.map((r) => r.host).filter(Boolean) || [];
      return (
        <div class="flex flex-wrap gap-2">
          <For each={hosts}>
            {(host) => (
              <a
                href={`https://${host}`}
                target="_blank"
                rel="noopener noreferrer"
                class="text-text-dim hover:text-white hover:underline transition-colors"
              >
                {host}
              </a>
            )}
          </For>
        </div>
      );
    },
  },
  {
    id: 'class',
    header: 'Class',
    accessor: (i) => i.spec?.ingressClassName || '-',
  },
];

const IngressesTable: Component<{ ingresses: K8sIngress[] }> = (props) => (
  <DataTable
    data={props.ingresses}
    columns={columns}
    rowKey={(i) => `${i.metadata?.namespace}/${i.metadata?.name}`}
    defaultSort={{ column: 'name', direction: 'asc' }}
    emptyTitle="No ingresses found"
  />
);

export default IngressesTable;
