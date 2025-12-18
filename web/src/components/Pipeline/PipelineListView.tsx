import { Component, For, Show, createMemo } from 'solid-js';
import type { RepoInfo } from '../../lib/api';
import type { Pipeline } from './CIPipelineViz';
import PipelineCard from './PipelineCard';
import { sortPipelines, type PipelineSortConfig, type PipelineSortField, type RepoWithPipeline } from './utils';

const SORT_OPTIONS: { value: PipelineSortField; label: string }[] = [
  { value: 'activity', label: 'Activity' },
  { value: 'status', label: 'Status' },
  { value: 'name', label: 'Name' },
  { value: 'date', label: 'Last Run' },
];

const PipelineListView: Component<{
  repos: RepoInfo[];
  pipelinesCache: Map<number, Pipeline>;
  sort: PipelineSortConfig;
  onSortChange: (config: PipelineSortConfig) => void;
  onSelectPipeline: (repo: RepoInfo) => void;
  loading?: boolean;
}> = (props) => {
  // Combine repos with their cached pipeline data
  const reposWithPipelines = createMemo((): RepoWithPipeline[] => {
    return props.repos.map(repo => ({
      repo,
      pipeline: props.pipelinesCache.get(repo.id) ?? null,
    }));
  });

  // Apply sorting
  const sortedPipelines = createMemo(() => {
    return sortPipelines(reposWithPipelines(), props.sort);
  });

  // Count stats
  const stats = createMemo(() => {
    const items = reposWithPipelines();
    return {
      total: items.length,
      running: items.filter(i => i.pipeline?.status === 'running').length,
      failed: items.filter(i => i.pipeline?.status === 'failed').length,
      success: items.filter(i => i.pipeline?.status === 'success').length,
    };
  });

  const handleSortFieldChange = (field: PipelineSortField) => {
    props.onSortChange({ ...props.sort, field });
  };

  const toggleSortDirection = () => {
    props.onSortChange({
      ...props.sort,
      direction: props.sort.direction === 'asc' ? 'desc' : 'asc',
    });
  };

  return (
    <div class="flex flex-col h-full">
      {/* Header with stats and sort controls */}
      <div class="flex items-center justify-between p-4 border-b border-white/5">
        {/* Stats */}
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-2">
            <span class="text-lg font-bold text-white">{stats().total}</span>
            <span class="text-xs text-text-dim uppercase tracking-wider">Pipelines</span>
          </div>
          <div class="h-4 w-px bg-white/10" />
          <div class="flex items-center gap-3 text-xs font-mono">
            <Show when={stats().running > 0}>
              <span class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-neon-green animate-pulse" />
                <span class="text-neon-green">{stats().running}</span>
                <span class="text-text-dim">running</span>
              </span>
            </Show>
            <Show when={stats().failed > 0}>
              <span class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-neon-pink" />
                <span class="text-neon-pink">{stats().failed}</span>
                <span class="text-text-dim">failed</span>
              </span>
            </Show>
            <Show when={stats().success > 0}>
              <span class="flex items-center gap-1">
                <span class="w-2 h-2 rounded-full bg-neon-cyan" />
                <span class="text-neon-cyan">{stats().success}</span>
                <span class="text-text-dim">passed</span>
              </span>
            </Show>
          </div>
        </div>

        {/* Sort controls */}
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-text-dim uppercase tracking-wider">Sort by</span>
          <select
            value={props.sort.field}
            onChange={(e) => handleSortFieldChange(e.currentTarget.value as PipelineSortField)}
            class="rounded-md border border-white/10 bg-black/50 px-3 py-1.5 text-xs font-mono text-text-main focus:border-neon-cyan focus:outline-none cursor-pointer"
          >
            <For each={SORT_OPTIONS}>
              {(option) => (
                <option value={option.value}>{option.label}</option>
              )}
            </For>
          </select>
          <button
            onClick={toggleSortDirection}
            class="px-2 py-1.5 rounded-md border border-white/10 bg-black/50 text-xs font-mono text-text-muted hover:text-text-main hover:border-neon-cyan/50 transition-colors"
            title={props.sort.direction === 'asc' ? 'Ascending' : 'Descending'}
          >
            {props.sort.direction === 'asc' ? '↑ Asc' : '↓ Desc'}
          </button>
        </div>
      </div>

      {/* Loading indicator */}
      <Show when={props.loading}>
        <div class="flex items-center justify-center p-8">
          <div class="flex items-center gap-3 text-text-muted">
            <div class="w-5 h-5 border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full animate-spin" />
            <span class="text-sm font-mono">Loading pipelines...</span>
          </div>
        </div>
      </Show>

      {/* Pipeline grid */}
      <div class="flex-1 overflow-y-auto p-4">
        <Show when={sortedPipelines().length > 0} fallback={
          <div class="flex flex-col items-center justify-center h-64 text-center">
            <div class="text-4xl mb-4 opacity-20">
              <svg class="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div class="text-text-dim font-mono text-sm">No pipelines found</div>
            <div class="text-text-dim/50 text-xs mt-1">Select a repository to view its pipeline</div>
          </div>
        }>
          <div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            <For each={sortedPipelines()}>
              {({ repo, pipeline }) => (
                <PipelineCard
                  repo={repo}
                  pipeline={pipeline}
                  onClick={() => props.onSelectPipeline(repo)}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default PipelineListView;
