import { Component, For, Show } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import type { K8sDaemonSet } from '../../lib/types';
import StatusDot from '../shared/StatusDot';
import type { Status } from '../shared/StatusDot';
import EmptyState from '../shared/EmptyState';

const DaemonSetsTable: Component<{ daemonsets: K8sDaemonSet[] }> = (props) => (
  <Show
    when={props.daemonsets.length > 0}
    fallback={
      <EmptyState
        size="sm"
        icon={
          <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
          </svg>
        }
        title="No daemonsets found"
      />
    }
  >
    <table class="w-full text-sm">
      <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-surface-dark/95 backdrop-blur">
        <tr>
          <th class="px-4 py-3 w-8" />
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Namespace</th>
          <th class="px-4 py-3">Ready</th>
          <th class="px-4 py-3">Scheduled</th>
          <th class="px-4 py-3">Age</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.daemonsets}>
          {(d) => {
            const ready = d.status?.numberReady || 0;
            const desired = d.status?.desiredNumberScheduled || 0;
            const status: Status = ready === desired && desired > 0 ? 'ok' : ready > 0 ? 'warn' : ready === 0 && desired > 0 ? 'error' : 'unknown';

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
                <td class="px-4 py-3 text-text-muted">
                  {d.status?.currentNumberScheduled || 0}/{d.status?.desiredNumberScheduled || 0}
                </td>
                <td class="px-4 py-3 text-text-muted">
                  {d.metadata?.creationTimestamp ? formatRelativeTime(d.metadata.creationTimestamp) : '-'}
                </td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  </Show>
);

export default DaemonSetsTable;
