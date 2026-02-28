import { Component, createSignal, createEffect, For, Show } from 'solid-js';
import { ciApi, RepoInfo } from '../../lib/api';

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

  createEffect(() => {
    const id = selectedProjectId();
    if (id === null) {
      setHistory([]);
      return;
    }

    setLoading(true);
    setError('');
    ciApi.getProjectHistory(id, 100)
      .then((data) => setHistory(data || []))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load history'))
      .finally(() => setLoading(false));
  });

  const formatDuration = (secs: number): string => {
    if (!secs || secs <= 0) return '-';
    if (secs < 60) return `${Math.round(secs)}s`;
    const mins = Math.floor(secs / 60);
    const remaining = Math.round(secs % 60);
    return `${mins}m ${remaining}s`;
  };

  const formatTime = (ts: string): string => {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'text-neon-green';
      case 'failed': return 'text-red-400';
      case 'running': return 'text-neon-cyan';
      case 'pending': return 'text-yellow-400';
      case 'canceled': return 'text-text-dim';
      default: return 'text-text-muted';
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'success': return 'bg-neon-green/20 border-neon-green/30';
      case 'failed': return 'bg-red-400/20 border-red-400/30';
      case 'running': return 'bg-neon-cyan/20 border-neon-cyan/30';
      case 'pending': return 'bg-yellow-400/20 border-yellow-400/30';
      case 'canceled': return 'bg-white/5 border-white/10';
      default: return 'bg-white/5 border-white/10';
    }
  };

  return (
    <div class="p-4 overflow-y-auto flex-1 flex flex-col gap-4">
      {/* Project selector */}
      <div class="flex items-center gap-3">
        <label class="text-xs text-text-dim uppercase tracking-wider">Project</label>
        <select
          class="bg-black/40 border border-white/10 rounded px-3 py-1.5 text-sm text-white focus:border-neon-cyan focus:outline-none"
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
      </div>

      <Show when={loading()}>
        <div class="flex items-center justify-center py-12">
          <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
        </div>
      </Show>

      <Show when={error()}>
        <div class="glass-panel flex items-center gap-3 p-4 text-sm text-status-error border border-status-error/20">
          <span>!</span>
          {error()}
        </div>
      </Show>

      <Show when={!loading() && selectedProjectId() !== null && history().length === 0 && !error()}>
        <div class="text-center py-8 text-text-muted">
          No pipeline history available for this project.
        </div>
      </Show>

      <Show when={!loading() && selectedProjectId() === null}>
        <div class="text-center py-12 text-text-muted">
          <div class="text-lg mb-2">Pipeline History</div>
          <div class="text-sm text-text-dim">Select a project to view execution history.</div>
        </div>
      </Show>

      <Show when={history().length > 0}>
        <div class="glass-panel overflow-hidden">
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
                      <span class="px-1.5 py-0.5 text-[10px] rounded bg-neon-purple/20 text-neon-purple">
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
                                  stage.status === 'success' ? 'bg-neon-green' :
                                  stage.status === 'failed' ? 'bg-red-400' :
                                  stage.status === 'running' ? 'bg-neon-cyan' :
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
