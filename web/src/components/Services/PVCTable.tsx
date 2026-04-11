import { Component } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import StatusDot from '../shared/StatusDot';
import type { Status } from '../shared/StatusDot';
import Badge from '../shared/Badge';
import type { BadgeTone } from '../shared/Badge';
import DataTable from '../shared/DataTable';
import type { ColumnDef } from '../shared/DataTable';

const columns: ColumnDef<any>[] = [
  {
    id: 'status',
    header: '',
    accessor: (pvc) => {
      const phase = pvc.status?.phase || 'Unknown';
      return phase === 'Bound' ? 'ok' : phase === 'Pending' ? 'pending' : 'warn';
    },
    cell: (status: Status) => <StatusDot status={status} />,
    width: '2rem',
  },
  {
    id: 'name',
    header: 'Name',
    accessor: (pvc) => pvc.metadata?.name ?? '',
    cell: (v) => <span class="font-medium text-text-main">{v}</span>,
    sortable: true,
  },
  {
    id: 'namespace',
    header: 'Namespace',
    accessor: (pvc) => pvc.metadata?.namespace ?? '',
    sortable: true,
  },
  {
    id: 'phase',
    header: 'Status',
    accessor: (pvc) => pvc.status?.phase || 'Unknown',
    cell: (phase: string) => {
      const tone: BadgeTone = phase === 'Bound' ? 'ok' : phase === 'Pending' ? 'warn' : 'default';
      return <Badge tone={tone} size="md">{phase}</Badge>;
    },
  },
  {
    id: 'capacity',
    header: 'Capacity',
    accessor: (pvc) => pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage || '-',
    mono: true,
  },
  {
    id: 'storageClass',
    header: 'Storage Class',
    accessor: (pvc) => pvc.spec?.storageClassName || '-',
    mono: true,
    sortable: true,
  },
  {
    id: 'age',
    header: 'Age',
    accessor: (pvc) => pvc.metadata?.creationTimestamp ?? '',
    cell: (v) => <span class="text-text-muted">{v ? formatRelativeTime(v) : '-'}</span>,
    sortable: true,
  },
];

const PVCTable: Component<{ pvcs: any[] }> = (props) => (
  <DataTable
    data={props.pvcs}
    columns={columns}
    rowKey={(pvc) => `${pvc.metadata?.namespace}/${pvc.metadata?.name}`}
    defaultSort={{ column: 'name', direction: 'asc' }}
    emptyTitle="No PVCs found"
  />
);

export default PVCTable;
