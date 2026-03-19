import { Component, For, Show } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import type { K8sJob } from '../../lib/types';
import StatusDot from '../shared/StatusDot';
import type { Status } from '../shared/StatusDot';
import EmptyState from '../shared/EmptyState';

const JobsTable: Component<{ jobs: K8sJob[] }> = (props) => {
  const getJobStatus = (j: K8sJob): Status => {
    if ((j.status?.succeeded || 0) > 0) return 'ok';
    if ((j.status?.failed || 0) > 0) return 'error';
    if ((j.status?.active || 0) > 0) return 'running';
    return 'pending';
  };

  return (
    <Show
      when={props.jobs.length > 0}
      fallback={
        <EmptyState
          size="sm"
          icon={
            <svg class="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          }
          title="No jobs found"
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
            <th class="px-4 py-3">Completions</th>
            <th class="px-4 py-3">Duration</th>
            <th class="px-4 py-3">Age</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.jobs}>
            {(j) => {
              const status = getJobStatus(j);
              const succeeded = j.status?.succeeded || 0;
              const completions = j.spec?.completions || 1;

              // Calculate duration
              let duration = '-';
              if (j.status?.startTime) {
                const start = new Date(j.status.startTime);
                const end = j.status?.completionTime ? new Date(j.status.completionTime) : new Date();
                const diffSec = Math.floor((end.getTime() - start.getTime()) / 1000);
                if (diffSec < 60) duration = `${diffSec}s`;
                else if (diffSec < 3600) duration = `${Math.floor(diffSec / 60)}m`;
                else duration = `${Math.floor(diffSec / 3600)}h`;
              }

              return (
                <tr class="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
                  <td class="px-4 py-3">
                    <StatusDot status={status} />
                  </td>
                  <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                    {j.metadata?.name}
                  </td>
                  <td class="px-4 py-3 text-text-dim">{j.metadata?.namespace}</td>
                  <td class="px-4 py-3">
                    <span class={`px-2 py-0.5 rounded text-xs ${
                      status === 'ok' ? 'bg-status-ok/10 text-status-ok' :
                      status === 'error' ? 'bg-status-error/10 text-status-error' :
                      status === 'running' ? 'bg-neon-green/10 text-neon-green' :
                      'bg-white/5 text-text-muted'
                    }`}>
                      {status === 'ok' ? 'Complete' : status === 'error' ? 'Failed' : status === 'running' ? 'Running' : 'Pending'}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-text-muted">
                    {succeeded}/{completions}
                  </td>
                  <td class="px-4 py-3 text-text-muted font-mono text-xs">
                    {duration}
                  </td>
                  <td class="px-4 py-3 text-text-muted">
                    {j.metadata?.creationTimestamp ? formatRelativeTime(j.metadata.creationTimestamp) : '-'}
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </Show>
  );
};

export default JobsTable;
