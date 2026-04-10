import { Component } from 'solid-js';
import type { K8sService } from '../../lib/types';
import DataTable from '../shared/DataTable';
import type { ColumnDef } from '../shared/DataTable';

const columns: ColumnDef<K8sService>[] = [
  {
    id: 'name',
    header: 'Name',
    accessor: (s) => s.metadata?.name ?? '',
    cell: (v) => <span class="font-medium text-text-main">{v}</span>,
    sortable: true,
  },
  {
    id: 'namespace',
    header: 'Namespace',
    accessor: (s) => s.metadata?.namespace ?? '',
    sortable: true,
  },
  {
    id: 'type',
    header: 'Type',
    accessor: (s) => s.spec?.type ?? '',
    cell: (_, s) => (
      <span class={`rounded px-2 py-0.5 text-xs ${
        s.spec?.type === 'LoadBalancer'
          ? 'bg-white/5 text-text-main'
          : s.spec?.type === 'NodePort'
            ? 'bg-white/5 text-text-dim'
            : 'bg-white/5 text-text-muted'
      }`}>
        {s.spec?.type}
      </span>
    ),
    sortable: true,
  },
  {
    id: 'clusterIP',
    header: 'Cluster IP',
    accessor: (s) => s.spec?.clusterIP || '-',
    mono: true,
  },
  {
    id: 'ports',
    header: 'Ports',
    accessor: (s) => s.spec?.ports?.map((p) => `${p.port}/${p.protocol}`).join(', ') || '-',
    mono: true,
  },
];

const ServicesTable: Component<{ services: K8sService[] }> = (props) => (
  <DataTable
    data={props.services}
    columns={columns}
    rowKey={(s) => `${s.metadata?.namespace}/${s.metadata?.name}`}
    defaultSort={{ column: 'name', direction: 'asc' }}
    emptyTitle="No services found"
  />
);

export default ServicesTable;
