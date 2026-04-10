import { Component } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import type { K8sDaemonSet } from '../../lib/types';
import StatusDot from '../shared/StatusDot';
import type { Status } from '../shared/StatusDot';
import DataTable from '../shared/DataTable';
import type { ColumnDef } from '../shared/DataTable';

const getStatus = (d: K8sDaemonSet): Status => {
  const ready = d.status?.numberReady || 0;
  const desired = d.status?.desiredNumberScheduled || 0;
  if (ready === desired && desired > 0) return 'ok';
  if (ready > 0) return 'warn';
  if (ready === 0 && desired > 0) return 'error';
  return 'unknown';
};

const columns: ColumnDef<K8sDaemonSet>[] = [
  {
    id: 'status',
    header: '',
    accessor: (d) => getStatus(d),
    cell: (_, d) => <StatusDot status={getStatus(d)} />,
    width: '2rem',
  },
  {
    id: 'name',
    header: 'Name',
    accessor: (d) => d.metadata?.name ?? '',
    cell: (v) => <span class="font-medium text-text-main">{v}</span>,
    sortable: true,
  },
  {
    id: 'namespace',
    header: 'Namespace',
    accessor: (d) => d.metadata?.namespace ?? '',
    sortable: true,
  },
  {
    id: 'ready',
    header: 'Ready',
    accessor: (d) => d.status?.numberReady || 0,
    cell: (_, d) => {
      const ready = d.status?.numberReady || 0;
      const desired = d.status?.desiredNumberScheduled || 0;
      const status = getStatus(d);
      return (
        <span class={status === 'ok' ? 'text-status-ok' : status === 'error' ? 'text-status-error' : 'text-status-warn'}>
          {ready}/{desired}
        </span>
      );
    },
    sortable: true,
  },
  {
    id: 'scheduled',
    header: 'Scheduled',
    accessor: (d) => d.status?.currentNumberScheduled || 0,
    cell: (_, d) => (
      <span class="text-text-muted">
        {d.status?.currentNumberScheduled || 0}/{d.status?.desiredNumberScheduled || 0}
      </span>
    ),
  },
  {
    id: 'age',
    header: 'Age',
    accessor: (d) => d.metadata?.creationTimestamp ?? '',
    cell: (v) => <span class="text-text-muted">{v ? formatRelativeTime(v) : '-'}</span>,
    sortable: true,
  },
];

const DaemonSetsTable: Component<{ daemonsets: K8sDaemonSet[] }> = (props) => (
  <DataTable
    data={props.daemonsets}
    columns={columns}
    rowKey={(d) => `${d.metadata?.namespace}/${d.metadata?.name}`}
    defaultSort={{ column: 'name', direction: 'asc' }}
    emptyTitle="No daemonsets found"
  />
);

export default DaemonSetsTable;
