import { Component, For, Show } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import StatusDot from '../shared/StatusDot';
import type { Status } from '../shared/StatusDot';
import EmptyState from '../shared/EmptyState';

const PVCTable: Component<{ pvcs: any[] }> = (props) => (
  <Show
    when={props.pvcs.length > 0}
    fallback={
      <EmptyState
        size="sm"
        icon={
          <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 4 4 5 4 7z" />
          </svg>
        }
        title="No PVCs found"
      />
    }
  >
    <table class="w-full text-sm">
      <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-surface-dark/95 backdrop-blur">
        <tr>
          <th class="px-4 py-3 w-8" />
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Namespace</th>
          <th class="px-4 py-3">Status</th>
          <th class="px-4 py-3">Capacity</th>
          <th class="px-4 py-3">Storage Class</th>
          <th class="px-4 py-3">Age</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.pvcs}>
          {(pvc) => {
            const phase = pvc.status?.phase || 'Unknown';
            const status: Status = phase === 'Bound' ? 'ok' : phase === 'Pending' ? 'pending' : 'warn';
            const capacity = pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage || '-';
            const storageClass = pvc.spec?.storageClassName || '-';

            return (
              <tr class="border-b border-white/5 hover:bg-white/5 transition-colors group">
                <td class="px-4 py-3">
                  <StatusDot status={status} />
                </td>
                <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                  {pvc.metadata?.name}
                </td>
                <td class="px-4 py-3 text-text-dim">{pvc.metadata?.namespace}</td>
                <td class="px-4 py-3">
                  <span class={`px-2 py-0.5 rounded text-xs ${
                    phase === 'Bound' ? 'bg-status-ok/10 text-status-ok' :
                    phase === 'Pending' ? 'bg-status-warn/10 text-status-warn' :
                    'bg-white/5 text-text-muted'
                  }`}>
                    {phase}
                  </span>
                </td>
                <td class="px-4 py-3 font-mono text-xs text-text-muted">{capacity}</td>
                <td class="px-4 py-3 font-mono text-xs text-text-muted">{storageClass}</td>
                <td class="px-4 py-3 text-text-muted">
                  {pvc.metadata?.creationTimestamp ? formatRelativeTime(pvc.metadata.creationTimestamp) : '-'}
                </td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  </Show>
);

export default PVCTable;
