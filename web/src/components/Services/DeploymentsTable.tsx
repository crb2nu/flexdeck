import { Component } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import type { K8sDeployment } from '../../lib/types';
import StatusDot from '../shared/StatusDot';
import type { Status } from '../shared/StatusDot';
import Button from '../shared/Button';
import DataTable from '../shared/DataTable';
import type { ColumnDef } from '../shared/DataTable';

const getDeploymentStatus = (d: K8sDeployment): Status => {
  const ready = d.status?.readyReplicas || 0;
  const desired = d.spec?.replicas || 0;
  const updated = d.status?.updatedReplicas || 0;

  if (ready === desired && desired > 0) return 'ok';
  if (updated < desired) return 'scaling';
  if (ready > 0) return 'warn';
  if (ready === 0 && desired > 0) return 'error';
  return 'unknown';
};

export interface DeploymentsTableProps {
  deployments: K8sDeployment[];
  readOnly: boolean;
  onScale: (ns: string, name: string, replicas: number) => void;
  onRestart: (ns: string, name: string) => void;
}

const DeploymentsTable: Component<DeploymentsTableProps> = (props) => {
  const columns = (): ColumnDef<K8sDeployment>[] => {
    const cols: ColumnDef<K8sDeployment>[] = [
      {
        id: 'status',
        header: '',
        accessor: (d) => getDeploymentStatus(d),
        cell: (_, d) => <StatusDot status={getDeploymentStatus(d)} />,
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
        accessor: (d) => d.status?.readyReplicas || 0,
        cell: (_, d) => {
          const ready = d.status?.readyReplicas || 0;
          const desired = d.spec?.replicas || 0;
          const status = getDeploymentStatus(d);
          return (
            <span class={status === 'ok' ? 'text-status-ok' : status === 'error' ? 'text-status-error' : 'text-status-warn'}>
              {ready}/{desired}
            </span>
          );
        },
        sortable: true,
      },
      {
        id: 'image',
        header: 'Image',
        accessor: (d) => {
          const image = d.spec?.template?.spec?.containers?.[0]?.image || '-';
          return image.split('/').pop()?.split('@')[0] || image;
        },
        mono: true,
      },
      {
        id: 'age',
        header: 'Age',
        accessor: (d) => d.metadata?.creationTimestamp ?? '',
        cell: (v) => <span class="text-text-muted">{v ? formatRelativeTime(v) : '-'}</span>,
        sortable: true,
      },
    ];

    if (!props.readOnly) {
      cols.push({
        id: 'actions',
        header: 'Actions',
        accessor: () => null,
        cell: (_, d) => {
          const desired = d.spec?.replicas || 0;
          return (
            <div class="flex gap-1">
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); props.onScale(d.metadata?.namespace || 'default', d.metadata?.name || '', desired + 1); }}>+</Button>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); props.onScale(d.metadata?.namespace || 'default', d.metadata?.name || '', Math.max(0, desired - 1)); }}>-</Button>
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); props.onRestart(d.metadata?.namespace || 'default', d.metadata?.name || ''); }}>↻</Button>
            </div>
          );
        },
      });
    }

    return cols;
  };

  return (
    <DataTable
      data={props.deployments}
      columns={columns()}
      rowKey={(d) => `${d.metadata?.namespace}/${d.metadata?.name}`}
      defaultSort={{ column: 'name', direction: 'asc' }}
      emptyTitle="No deployments found"
    />
  );
};

export default DeploymentsTable;
