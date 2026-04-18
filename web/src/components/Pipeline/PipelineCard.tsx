import { Component, For, Show } from 'solid-js';
import type { RepoInfo } from '../../lib/api';
import type { Pipeline, PipelineJob, PipelineStage } from './CIPipelineViz';
import {
  formatRelativeTime,
  getJobCountsByStatus,
  getPipelineDataStateMeta,
  getStatusColor,
  getStatusLabel,
  hasActiveJobs,
} from './utils';

const getStageStatusSummary = (stage: PipelineStage): { status: PipelineJob['status']; text: string } => {
  const counts = getJobCountsByStatus(stage.jobs);
  const total = stage.jobs.length;

  if (counts.running > 0) {
    return { status: 'running', text: `${counts.running}/${total}` };
  }
  if (counts.failed > 0) {
    return { status: 'failed', text: `${counts.failed} failed` };
  }
  if (counts.pending > 0) {
    return { status: 'pending', text: `${counts.pending}/${total}` };
  }
  if (counts.manual > 0 && counts.success === total - counts.manual - counts.skipped) {
    return { status: 'manual', text: 'manual' };
  }
  if (counts.success + counts.skipped === total) {
    return { status: 'success', text: `${counts.success}/${total}` };
  }
  return { status: 'pending', text: `${total}` };
};

const PipelineCard: Component<{
  repo: RepoInfo;
  pipeline: Pipeline | null;
  onClick: () => void;
}> = (props) => {
  const isActive = () => hasActiveJobs(props.pipeline);
  const status = () => props.pipeline?.status ?? 'pending';
  const statusColor = () => getStatusColor(status(), props.pipeline?.rawStatus);
  const sourceStateMeta = () =>
    getPipelineDataStateMeta({
      pipeline: props.pipeline,
      lastUpdate: props.pipeline ? new Date(props.pipeline.createdAt) : null,
      staleAfterMs: Number.MAX_SAFE_INTEGER,
    });

  return (
    <div
      onClick={props.onClick}
      class="relative rounded-lg cursor-pointer transition-colors duration-150 hover:bg-white/[0.03] group border border-white/[0.08] bg-[rgba(16,28,34,0.95)]"
      classList={{
        'ring-1 ring-white/20': isActive(),
      }}
    >
      <div class="p-4">
        {/* Header row */}
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2 min-w-0">
            <div
              class="w-2 h-2 rounded-full flex-shrink-0"
              classList={{ 'animate-pulse': isActive() }}
              style={{
                background: statusColor(),
              }}
            />
            <span class="text-sm font-mono text-white truncate font-medium">
              {props.repo.name}
            </span>
          </div>
          <Show when={props.pipeline}>
            <span class="text-[10px] font-mono text-text-dim flex-shrink-0 ml-2">
              {formatRelativeTime(props.pipeline!.createdAt)}
            </span>
          </Show>
        </div>

        {/* Branch and pipeline ID */}
        <Show when={props.pipeline}>
          <div class="flex items-center gap-2 mb-3">
            <span class="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-mono text-text-muted">
              {props.pipeline!.ref}
            </span>
            <span
              class="px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase tracking-wide"
              style={{
                color: statusColor(),
                border: `1px solid ${statusColor()}50`,
                background: `${statusColor()}12`,
              }}
            >
              {getStatusLabel(status(), props.pipeline?.rawStatus)}
            </span>
            <span class="text-[10px] font-mono text-text-dim">
              #{props.pipeline!.id.split('-')[1] || props.pipeline!.id}
            </span>
            <span
              class={`px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase tracking-wider ${sourceStateMeta().badgeClass}`}
            >
              {sourceStateMeta().label}
            </span>
          </div>
        </Show>

        {/* Stage chips */}
        <Show when={props.pipeline} fallback={
          <div class="text-xs text-text-dim font-mono">No pipeline data</div>
        }>
          <div class="flex flex-wrap gap-1.5">
            <For each={props.pipeline!.stages}>
              {(stage) => {
                const summary = () => getStageStatusSummary(stage);
                return (
                  <div
                    class="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono"
                    style={{
                      background: `${getStatusColor(summary().status)}15`,
                      border: `1px solid ${getStatusColor(summary().status)}30`,
                    }}
                  >
                    <div
                      class="w-1.5 h-1.5 rounded-full"
                      classList={{ 'animate-pulse': summary().status === 'running' }}
                      style={{ background: getStatusColor(summary().status) }}
                    />
                    <span class="text-text-muted">{stage.name}</span>
                    <span style={{ color: getStatusColor(summary().status) }}>
                      {summary().text}
                    </span>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>

    </div>
  );
};

export default PipelineCard;
