import type { RepoInfo } from '../../lib/api';
import { normalizeCiJobStatus, normalizeCiPipelineStatus } from '../../lib/fiAccel';
import {
  operatorStateBadgeClass,
  operatorStateLabel,
  type OperatorState,
} from '../../lib/freshness';
import { VIZ_ACCENT_LIGHT, VIZ_TOKEN_HEX } from '../../lib/vizTokens';
import type { PipelineJob, Pipeline } from './CIPipelineViz';

const ACTIVE_JOB_STATUSES = new Set(['running', 'pending', 'created', 'preparing', 'waiting_for_resource', 'scheduled']);

/**
 * getStatusColor cannot return `var(--x)` because its output feeds canvas 2D
 * fillStyle/shadowColor (CIPipelineViz particle pool) and `${color}NN`
 * hex-alpha string concatenations, where CSS var() does not resolve.
 * Hex values come from lib/vizTokens (the app-wide token mirror).
 */
export const TOKEN_HEX = {
  success: VIZ_TOKEN_HEX.success,
  warning: VIZ_TOKEN_HEX.warning,
  error: VIZ_TOKEN_HEX.error,
  info: VIZ_TOKEN_HEX.info,
  accent: VIZ_TOKEN_HEX.accent,
  accentLight: VIZ_ACCENT_LIGHT,
  violet: VIZ_TOKEN_HEX.violet,
  fgPrimary: VIZ_TOKEN_HEX.fgPrimary,
  fgSecondary: VIZ_TOKEN_HEX.fgSecondary,
} as const;

function normalizeRawStatus(status: string | undefined | null): string | undefined {
  const normalized = (status ?? '').trim().toLowerCase();
  return normalized || undefined;
}

function getVisualStatusToken(
  status: PipelineJob['status'] | Pipeline['status'],
  rawStatus?: string,
): string {
  return normalizeRawStatus(rawStatus) ?? status;
}

export function getStatusColor(
  status: PipelineJob['status'] | Pipeline['status'],
  rawStatus?: string,
): string {
  const token = getVisualStatusToken(status, rawStatus);
  switch (token) {
    case 'success':
      return TOKEN_HEX.success;
    case 'running':
      return TOKEN_HEX.fgSecondary; // neutral
    case 'failed':
    case 'canceled':
    case 'cancelled':
    case 'canceling':
      return TOKEN_HEX.error;
    case 'manual':
      return TOKEN_HEX.violet;
    case 'created':
      return TOKEN_HEX.warning;
    case 'preparing':
      return TOKEN_HEX.accentLight;
    case 'waiting_for_resource':
      return TOKEN_HEX.accent;
    case 'scheduled':
      return TOKEN_HEX.violet;
    case 'pending':
      return TOKEN_HEX.warning;
    case 'skipped':
      return 'rgba(140,192,204,0.3)'; // TOKEN_HEX.fgSecondary at 0.3 (rgba form: hex-alpha concat is never applied to 'skipped')
    default:
      return TOKEN_HEX.fgPrimary;
  }
}

export function getStatusLabel(
  status: PipelineJob['status'] | Pipeline['status'],
  rawStatus?: string,
): string {
  const token = getVisualStatusToken(status, rawStatus);
  return token.replaceAll('_', ' ');
}

export function normalizeJobStatus(status: string | undefined | null): PipelineJob['status'] {
  switch (normalizeCiJobStatus(status)) {
    case 'running':
      return 'running';
    case 'success':
      return 'success';
    case 'failed':
      return 'failed';
    case 'manual':
      return 'manual';
    case 'skipped':
      return 'skipped';
    case 'canceled':
      return 'failed';
    case 'pending':
      return 'pending';
    default:
      return 'pending';
  }
}

export function normalizePipelineStatus(status: string | undefined | null): Pipeline['status'] {
  switch (normalizeCiPipelineStatus(status)) {
    case 'running':
      return 'running';
    case 'success':
      return 'success';
    case 'failed':
      return 'failed';
    case 'canceled':
    case 'skipped':
      return 'canceled';
    case 'pending':
    case 'manual':
      return 'pending';
    default:
      return 'pending';
  }
}

export function normalizePipeline(pipeline: Pipeline): Pipeline {
  return {
    ...pipeline,
    rawStatus: normalizeRawStatus(pipeline.rawStatus ?? pipeline.status),
    status: normalizePipelineStatus(pipeline.status),
    stages: pipeline.stages.map((stage) => ({
      ...stage,
      jobs: stage.jobs.map((job) => ({
        ...job,
        rawStatus: normalizeRawStatus(job.rawStatus ?? job.status),
        status: normalizeJobStatus(job.status),
      })),
    })),
  };
}

// Status priority for sorting (lower = higher priority, shown first)
export const JOB_STATUS_PRIORITY: Record<PipelineJob['status'], number> = {
  running: 0,
  pending: 1,
  failed: 2,
  success: 3,
  manual: 4,
  skipped: 5,
};

export const PIPELINE_STATUS_PRIORITY: Record<Pipeline['status'], number> = {
  running: 0,
  failed: 1,
  canceled: 2,
  pending: 3,
  success: 4,
};

/**
 * Sort jobs by status priority (running first, then pending, etc.)
 */
export function sortJobsByStatus<T extends { status: PipelineJob['status'] }>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) =>
    (JOB_STATUS_PRIORITY[a.status] ?? 99) - (JOB_STATUS_PRIORITY[b.status] ?? 99)
  );
}

/**
 * Sort pipelines by various fields
 */
export type PipelineSortField = 'activity' | 'status' | 'name' | 'date';
export type SortDirection = 'asc' | 'desc';

export interface PipelineSortConfig {
  field: PipelineSortField;
  direction: SortDirection;
}

export interface RepoWithPipeline {
  repo: RepoInfo;
  pipeline: Pipeline | null;
}

export type PipelineDataState = Extract<OperatorState, 'ready' | 'stale' | 'fallback' | 'offline'>;

export interface PipelineDataStateMeta {
  state: PipelineDataState;
  label: string;
  detail?: string;
  badgeClass: string;
}

/**
 * Check if a pipeline has any active (running) jobs
 */
export function hasActiveJobs(pipeline: Pipeline | null): boolean {
  if (!pipeline) return false;
  if (normalizePipelineStatus(pipeline.status) === 'running') return true;

  return pipeline.stages.some(stage =>
    stage.jobs.some(job => ACTIVE_JOB_STATUSES.has(job.status))
  );
}

/**
 * Live pipelines have numeric IDs from GitLab API responses.
 * Static previews generated from `.gitlab-ci.yml` use synthetic IDs.
 */
export function isLivePipelineId(id: string | undefined | null): boolean {
  return !!id && /^\d+$/.test(id);
}

interface PipelineDataStateInput {
  pipeline: Pipeline | null | undefined;
  lastUpdate?: Date | null;
  fetchError?: boolean;
  staleAfterMs?: number;
}

/**
 * Derive data confidence state for pipeline views.
 */
export function getPipelineDataState(input: PipelineDataStateInput): PipelineDataState {
  const { pipeline, lastUpdate = null, fetchError = false, staleAfterMs = 35000 } = input;
  if (!pipeline) return 'offline';
  if (!isLivePipelineId(pipeline.id)) return 'fallback';
  if (fetchError) return 'offline';
  if (!lastUpdate) return 'stale';
  if (Date.now() - lastUpdate.getTime() > staleAfterMs) return 'stale';
  return 'ready';
}

export function getPipelineDataStateMeta(input: PipelineDataStateInput): PipelineDataStateMeta {
  const state = getPipelineDataState(input);
  const detail = state === 'fallback' ? 'static preview' : undefined;
  return {
    state,
    detail,
    label: operatorStateLabel(state, detail),
    badgeClass: operatorStateBadgeClass(state),
  };
}

/**
 * Get the most recent timestamp from a pipeline
 */
export function getPipelineTimestamp(pipeline: Pipeline | null): number {
  if (!pipeline) return 0;
  return new Date(pipeline.createdAt).getTime();
}

/**
 * Sort repos with their pipelines
 */
export function sortPipelines(
  items: RepoWithPipeline[],
  config: PipelineSortConfig
): RepoWithPipeline[] {
  const sorted = [...items].sort((a, b) => {
    let comparison = 0;

    switch (config.field) {
      case 'activity':
        // Active pipelines first, then by timestamp
        const aActive = hasActiveJobs(a.pipeline);
        const bActive = hasActiveJobs(b.pipeline);
        if (aActive !== bActive) {
          comparison = aActive ? -1 : 1;
        } else {
          comparison = getPipelineTimestamp(b.pipeline) - getPipelineTimestamp(a.pipeline);
        }
        break;

      case 'status':
        const aStatus = a.pipeline?.status ?? 'pending';
        const bStatus = b.pipeline?.status ?? 'pending';
        comparison = (PIPELINE_STATUS_PRIORITY[aStatus] ?? 99) - (PIPELINE_STATUS_PRIORITY[bStatus] ?? 99);
        break;

      case 'name':
        comparison = a.repo.name.localeCompare(b.repo.name);
        break;

      case 'date':
        comparison = getPipelineTimestamp(b.pipeline) - getPipelineTimestamp(a.pipeline);
        break;
    }

    return comparison;
  });

  // Apply direction (default sort is desc for most fields)
  if (config.direction === 'asc' && config.field !== 'name') {
    return sorted.reverse();
  }
  if (config.direction === 'desc' && config.field === 'name') {
    return sorted.reverse();
  }

  return sorted;
}

/**
 * Get job counts by status for a stage
 */
export function getJobCountsByStatus(jobs: PipelineJob[]): Record<PipelineJob['status'], number> {
  const counts: Record<PipelineJob['status'], number> = {
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    manual: 0,
  };

  for (const job of jobs) {
    counts[job.status]++;
  }

  return counts;
}

/**
 * Format relative time (e.g., "3m ago", "2h ago")
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHour > 0) return `${diffHour}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return 'just now';
}
