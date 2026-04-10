import { Component } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import type { K8sJob } from '../../lib/types';
import StatusDot from '../shared/StatusDot';
import type { Status } from '../shared/StatusDot';
import DataTable from '../shared/DataTable';
import type { ColumnDef } from '../shared/DataTable';

const getJobStatus = (j: K8sJob): Status => {
  if ((j.status?.succeeded || 0) > 0) return 'ok';
  if ((j.status?.failed || 0) > 0) return 'error';
  if ((j.status?.active || 0) > 0) return 'running';
  return 'pending';
};

const getJobDuration = (j: K8sJob): string => {
  if (!j.status?.startTime) return '-';
  const start = new Date(j.status.startTime);
  const end = j.status?.completionTime ? new Date(j.status.completionTime) : new Date();
  const diffSec = Math.floor((end.getTime() - start.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  return `${Math.floor(diffSec / 3600)}h`;
};

const columns: ColumnDef<K8sJob>[] = [
  {
    id: 'status',
    header: '',
    accessor: (j) => getJobStatus(j),
    cell: (_, j) => <StatusDot status={getJobStatus(j)} />,
    width: '2rem',
  },
  {
    id: 'name',
    header: 'Name',
    accessor: (j) => j.metadata?.name ?? '',
    cell: (v) => <span class="font-medium text-text-main">{v}</span>,
    sortable: true,
  },
  {
    id: 'namespace',
    header: 'Namespace',
    accessor: (j) => j.metadata?.namespace ?? '',
    sortable: true,
  },
  {
    id: 'phase',
    header: 'Status',
    accessor: (j) => getJobStatus(j),
    cell: (_, j) => {
      const status = getJobStatus(j);
      const label = status === 'ok' ? 'Complete' : status === 'error' ? 'Failed' : status === 'running' ? 'Running' : 'Pending';
      return (
        <span class={`px-2 py-0.5 rounded text-xs ${
          status === 'ok' ? 'bg-status-ok/10 text-status-ok' :
          status === 'error' ? 'bg-status-error/10 text-status-error' :
          status === 'running' ? 'bg-status-ok/10 text-status-ok' :
          'bg-white/5 text-text-muted'
        }`}>
          {label}
        </span>
      );
    },
  },
  {
    id: 'completions',
    header: 'Completions',
    accessor: (j) => j.status?.succeeded || 0,
    cell: (_, j) => (
      <span class="text-text-muted">
        {j.status?.succeeded || 0}/{j.spec?.completions || 1}
      </span>
    ),
  },
  {
    id: 'duration',
    header: 'Duration',
    accessor: (j) => getJobDuration(j),
    mono: true,
  },
  {
    id: 'age',
    header: 'Age',
    accessor: (j) => j.metadata?.creationTimestamp ?? '',
    cell: (v) => <span class="text-text-muted">{v ? formatRelativeTime(v) : '-'}</span>,
    sortable: true,
  },
];

const JobsTable: Component<{ jobs: K8sJob[] }> = (props) => (
  <DataTable
    data={props.jobs}
    columns={columns}
    rowKey={(j) => `${j.metadata?.namespace}/${j.metadata?.name}`}
    defaultSort={{ column: 'name', direction: 'asc' }}
    emptyTitle="No jobs found"
  />
);

export default JobsTable;
