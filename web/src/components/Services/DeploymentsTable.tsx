import { Component, For, Show } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import type { K8sDeployment } from '../../lib/types';
import StatusDot from '../shared/StatusDot';
import type { Status } from '../shared/StatusDot';
import EmptyState from '../shared/EmptyState';

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

const DeploymentsTable: Component<DeploymentsTableProps> = (props) => (
  <Show
    when={props.deployments.length > 0}
    fallback={
      <EmptyState
        size="sm"
        icon={
          <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        }
        title="No deployments found"
      />
    }
  >
    <table class="w-full text-sm">
      <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-[#0b1020]">
        <tr>
          <th class="px-4 py-3 w-8" />
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Namespace</th>
          <th class="px-4 py-3">Ready</th>
          <th class="px-4 py-3">Image</th>
          <th class="px-4 py-3">Age</th>
          <Show when={!props.readOnly}>
            <th class="px-4 py-3">Actions</th>
          </Show>
        </tr>
      </thead>
      <tbody>
        <For each={props.deployments}>
        {(d) => {
          const ready = d.status?.readyReplicas || 0;
          const desired = d.spec?.replicas || 0;
          const status = getDeploymentStatus(d);
          const image = d.spec?.template?.spec?.containers?.[0]?.image || '-';
          const shortImage = image.split('/').pop()?.split('@')[0] || image;

          return (
            <tr class="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
              <td class="px-4 py-3">
                <StatusDot status={status} />
              </td>
              <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                {d.metadata?.name}
              </td>
              <td class="px-4 py-3 text-text-dim">{d.metadata?.namespace}</td>
              <td class="px-4 py-3">
                <span class={status === 'ok' ? 'text-status-ok' : status === 'error' ? 'text-status-error' : 'text-status-warn'}>
                  {ready}/{desired}
                </span>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-text-muted" title={image}>
                {shortImage}
              </td>
              <td class="px-4 py-3 text-text-muted">
                {d.metadata?.creationTimestamp
                  ? formatRelativeTime(d.metadata.creationTimestamp)
                  : '-'}
              </td>
              <Show when={!props.readOnly}>
                <td class="px-4 py-3">
                  <div class="flex gap-2">
                    <button
                      class="rounded px-2 py-1 text-xs text-neon-cyan hover:bg-neon-cyan/10 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onScale(d.metadata?.namespace || 'default', d.metadata?.name || '', desired + 1);
                      }}
                    >
                      +
                    </button>
                    <button
                      class="rounded px-2 py-1 text-xs text-neon-yellow hover:bg-neon-yellow/10 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onScale(d.metadata?.namespace || 'default', d.metadata?.name || '', Math.max(0, desired - 1));
                      }}
                    >
                      -
                    </button>
                    <button
                      class="rounded px-2 py-1 text-xs text-neon-purple hover:bg-neon-purple/10 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onRestart(d.metadata?.namespace || 'default', d.metadata?.name || '');
                      }}
                    >
                      ↻
                    </button>
                  </div>
                </td>
              </Show>
            </tr>
          );
        }}
        </For>
      </tbody>
    </table>
  </Show>
);

export default DeploymentsTable;
