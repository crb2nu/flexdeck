import { Component } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import type { K8sStatefulSet } from '../../lib/types';
import StatusDot from '../shared/StatusDot';
import type { Status } from '../shared/StatusDot';
import DataTable from '../shared/DataTable';
import type { ColumnDef } from '../shared/DataTable';

const getStatus = (s: K8sStatefulSet): Status => {
  const ready = s.status?.readyReplicas || 0;
  const desired = s.spec?.replicas || 0;
  if (ready === desired && desired > 0) return 'ok';
  if (ready > 0) return 'warn';
  if (ready === 0 && desired > 0) return 'error';
  return 'unknown';
};

const columns: ColumnDef<K8sStatefulSet>[] = [
  {
    id: 'status',
    header: '',
    accessor: (s) => getStatus(s),
    cell: (_, s) => <StatusDot status={getStatus(s)} />,
    width: '2rem',
  },
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
    id: 'ready',
    header: 'Ready',
    accessor: (s) => s.status?.readyReplicas || 0,
    cell: (_, s) => {
      const ready = s.status?.readyReplicas || 0;
      const desired = s.spec?.replicas || 0;
      const status = getStatus(s);
      return (
        <span class={status === 'ok' ? 'text-status-ok' : status === 'error' ? 'text-status-error' : 'text-status-warn'}>
          {ready}/{desired}
        </span>
      );
    },
    sortable: true,
  },
  {
    id: 'service',
    header: 'Service',
    accessor: (s) => s.spec?.serviceName || '-',
    mono: true,
  },
  {
    id: 'age',
    header: 'Age',
    accessor: (s) => s.metadata?.creationTimestamp ?? '',
    cell: (v) => <span class="text-text-muted">{v ? formatRelativeTime(v) : '-'}</span>,
    sortable: true,
  },
];

const StatefulSetsTable: Component<{ statefulsets: K8sStatefulSet[] }> = (props) => (
  <DataTable
    data={props.statefulsets}
    persistKey="services.statefulsets"
    columns={columns}
    rowKey={(s) => `${s.metadata?.namespace}/${s.metadata?.name}`}
    defaultSort={{ column: 'name', direction: 'asc' }}
    emptyTitle="No statefulsets found"
  />
);

export default StatefulSetsTable;
