import { Component, createSignal, createEffect, For, Show } from 'solid-js';
import { LoadingState, ErrorState, EmptyState } from '../shared';
import { formatDuration as formatDurationMs, formatShortDateTime } from '../../lib/format';
import { ciApi, type RepoInfo } from '../../lib/api';
import {
  operatorStateBadgeClass,
  operatorStateLabel,
  resolveOperatorState,
  type OperatorState,
} from '../../lib/freshness';

interface PipelineRunData {
  pipeline_id: number;
  project_id: number;
  ref: string;
  status: string;
  duration_s: number;
  created_at: string;
  finished_at?: string;
  stages?: Array<{
    name: string;
    status: string;
    duration_s: number;
  }>;
}

const PipelineHistory: Component<{ repos: RepoInfo[] }> = (props) => {
  const [selectedProjectId, setSelectedProjectId] = createSignal<number | null>(null);
  const [history, setHistory] = createSignal<PipelineRunData[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [lastUpdated, setLastUpdated] = createSignal(0);

  createEffect(() => {
    const id = selectedProjectId();
    if (id === null) {
      setHistory([]);
      setError('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    ciApi.getProjectHistory(id, 100)
      .then((data) => {
        setHistory(data || []);
        setLastUpdated(Date.now());
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load history'))
      .finally(() => setLoading(false));
  });

  const state = (): OperatorState => resolveOperatorState({
    loading: loading(),
    error: error(),
    lastUpdateMs: lastUpdated(),
    staleAfterMs: 5 * 60_000,
    disabled: selectedProjectId() === null,
  });

  const stateDetail = () => {
    if (selectedProjectId() === null) return 'select project';
    if (error()) return 'history unavailable';
    if (loading()) return lastUpdated() ? 'background refresh' : 'initial load';
    if (state() === 'stale') return 'refresh overdue';
    if (history().length === 0) return 'no runs yet';
    return `${history().length} recent run${history().length === 1 ? '' : 's'}`;
  };

  // Thin guards over lib/format: table cells show '-' for missing values.
  const formatDuration = (secs: number): string =>
    !secs || secs <= 0 ? '-' : formatDurationMs(secs * 1000);

  const formatTime = (ts: string): string => (ts ? formatShortDateTime(ts) : '-');

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-status-ok';
      case 'failed': return 'text-red-400';
      case 'running': return 'text-white';
      case 'pending': return 'text-yellow-400';
      case 'canceled': return 'text-text-dim';
      default: return 'text-text-muted';
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'success': return 'bg-status-ok/20 border-status-ok/30';
      case 'failed': return 'bg-red-400/20 border-red-400/30';
      case 'running': return 'bg-white/10 border-white/20';
      case 'pending': return 'bg-yellow-400/20 border-yellow-400/30';
      case 'canceled': return 'bg-white/5 border-white/10';
      default: return 'bg-white/5 border-white/10';
    }
  };

  return (
    <div class="p-4 overflow-y-auto flex-1 flex flex-col gap-4">
      <div class="surface flex flex-col gap-3 p-4 lg:flex-row lg:items-end lg:justify-between">
        <div class="min-w-0">
          <div class="text-[10px] font-semibold uppercase tracking-[0.2em] text-text-dim">Pipeline History</div>
          <div class="mt-1 text-lg font-semibold text-text-main">Execution history browser</div>
          <div class="mt-1 max-w-3xl text-sm text-text-dim">
            Review recent runs, per-stage outcomes, and branch activity for a selected repository.
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-dim">
            <span class={`rounded-full px-2.5 py-1 ${operatorStateBadgeClass(state())}`}>
              {operatorStateLabel(state(), stateDetail())}
            </span>
            <span class="rounded-full bg-white/5 px-2.5 py-1">
              Updated {lastUpdated() ? new Date(lastUpdated()).toLocaleTimeString() : '—'}
            </span>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <label class="text-xs text-text-dim uppercase tracking-wider">Project</label>
          <select
            class="bg-black/40 border border-white/10 rounded px-3 py-1.5 text-sm text-white focus:border-white/20 focus:outline-none"
            onChange={(e) => {
              const val = e.currentTarget.value;
              setSelectedProjectId(val ? parseInt(val) : null);
            }}
          >
            <option value="">Select a project...</option>
            <For each={props.repos}>
              {(repo) => (
                <option value={repo.id}>{repo.name}</option>
              )}
            </For>
          </select>
          <button
            type="button"
            disabled={selectedProjectId() === null || loading()}
            class="rounded-md border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-white/20 hover:text-text-main disabled:opacity-50"
            onClick={() => {
              const id = selectedProjectId();
              if (id === null) return;
              setSelectedProjectId(null);
              queueMicrotask(() => setSelectedProjectId(id));
            }}
          >
            Reload history
          </button>
        </div>
      </div>

      <Show when={loading()}>
        <LoadingState size="sm" />
      </Show>

      <Show when={error()}>
        <ErrorState message={error()} />
      </Show>

      <Show when={!loading() && selectedProjectId() !== null && history().length === 0 && !error()}>
        <EmptyState size="sm" title="No pipeline history found" subtitle="Runs will appear here once this project's pipelines execute." />
      </Show>

      <Show when={!loading() && selectedProjectId() === null}>
        <div class="text-center py-12 text-text-muted">
          <div class="text-lg mb-2">Pipeline History</div>
          <div class="text-sm text-text-dim">Select a project to view execution history.</div>
        </div>
      </Show>

      <Show when={history().length > 0}>
        <div class="surface overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-white/10 text-left text-[10px] uppercase tracking-wider text-text-dim">
                <th class="px-4 py-2">Pipeline</th>
                <th class="px-4 py-2">Branch</th>
                <th class="px-4 py-2">Status</th>
                <th class="px-4 py-2">Duration</th>
                <th class="px-4 py-2">Stages</th>
                <th class="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              <For each={history()}>
                {(run) => (
                  <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td class="px-4 py-2 font-mono text-text-main">
                      #{run.pipeline_id}
                    </td>
                    <td class="px-4 py-2">
                      <span class="px-1.5 py-0.5 text-[10px] rounded bg-white/10 text-text-muted">
                        {run.ref}
                      </span>
                    </td>
                    <td class="px-4 py-2">
                      <span class={`px-2 py-0.5 text-[10px] uppercase font-bold rounded border ${getStatusBg(run.status)} ${getStatusColor(run.status)}`}>
                        {run.status}
                      </span>
                    </td>
                    <td class="px-4 py-2 font-mono text-text-muted">
                      {formatDuration(run.duration_s)}
                    </td>
                    <td class="px-4 py-2">
                      <Show when={run.stages && run.stages.length > 0}>
                        <div class="flex gap-1">
                          <For each={run.stages}>
                            {(stage) => (
                              <span
                                class={`w-2 h-2 rounded-full ${
                                  stage.status === 'success' ? 'bg-status-ok' :
                                  stage.status === 'failed' ? 'bg-red-400' :
                                  stage.status === 'running' ? 'bg-white/50' :
                                  'bg-white/20'
                                }`}
                                title={`${stage.name}: ${stage.status} (${formatDuration(stage.duration_s)})`}
                              />
                            )}
                          </For>
                        </div>
                      </Show>
                    </td>
                    <td class="px-4 py-2 text-text-dim text-xs">
                      {formatTime(run.created_at)}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  );
};

export default PipelineHistory;
