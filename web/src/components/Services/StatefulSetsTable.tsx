import { Component, For, Show } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import type { K8sStatefulSet } from '../../lib/types';
import StatusDot from '../shared/StatusDot';
import type { Status } from '../shared/StatusDot';
import EmptyState from '../shared/EmptyState';

const StatefulSetsTable: Component<{ statefulsets: K8sStatefulSet[] }> = (props) => (
  <Show
    when={props.statefulsets.length > 0}
    fallback={
      <EmptyState
        size="sm"
        icon={
          <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        }
        title="No statefulsets found"
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
          <th class="px-4 py-3">Service</th>
          <th class="px-4 py-3">Age</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.statefulsets}>
          {(s) => {
            const ready = s.status?.readyReplicas || 0;
            const desired = s.spec?.replicas || 0;
            const status: Status = ready === desired && desired > 0 ? 'ok' : ready > 0 ? 'warn' : ready === 0 && desired > 0 ? 'error' : 'unknown';

            return (
              <tr class="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
                <td class="px-4 py-3">
                  <StatusDot status={status} />
                </td>
                <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                  {s.metadata?.name}
                </td>
                <td class="px-4 py-3 text-text-dim">{s.metadata?.namespace}</td>
                <td class="px-4 py-3">
                  <span class={status === 'ok' ? 'text-status-ok' : status === 'error' ? 'text-status-error' : 'text-status-warn'}>
                    {ready}/{desired}
                  </span>
                </td>
                <td class="px-4 py-3 text-text-muted font-mono text-xs">
                  {s.spec?.serviceName || '-'}
                </td>
                <td class="px-4 py-3 text-text-muted">
                  {s.metadata?.creationTimestamp ? formatRelativeTime(s.metadata.creationTimestamp) : '-'}
                </td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  </Show>
);

export default StatefulSetsTable;
