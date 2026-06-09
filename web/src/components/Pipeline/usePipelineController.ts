import { batch, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { ciApi, type RepoInfo } from '../../lib/api';
import type { Pipeline as VizPipeline, PipelineJob, PipelineStage } from './CIPipelineViz';
import {
  getPipelineDataState,
  getPipelineDataStateMeta,
  hasActiveJobs,
  isLivePipelineId,
  normalizePipeline,
  type PipelineDataState,
  type PipelineSortConfig,
} from './utils';

// The `yaml` parser (vendor-yaml ~30KB gzipped) is only needed to render a static
// CI-config preview, which happens on demand when a user selects a repo. Load it
// lazily and cache the resolved parser so the chunk stays out of the Pipeline
// route's initial bundle.
let yamlParsePromise: Promise<(src: string) => unknown> | null = null;
const loadYamlParse = (): Promise<(src: string) => unknown> => {
  if (!yamlParsePromise) {
    yamlParsePromise = import('yaml').then((mod) => mod.parse);
  }
  return yamlParsePromise;
};

export const PIPELINE_POLL_ACTIVE = 10_000;   // Running/pending pipelines
export const PIPELINE_POLL_RECENT = 30_000;   // Terminal <5min
export const PIPELINE_POLL_IDLE = 60_000;     // Terminal >5min or no pipeline
export const PIPELINE_POLL_INTERVAL = PIPELINE_POLL_ACTIVE; // legacy alias
export const PIPELINE_STALE_AFTER_MS = PIPELINE_POLL_ACTIVE * 3;
export const PIPELINE_RECENT_REFRESH_WINDOW_MS = 5 * 60_000;

export type ActionNotice = {
  type: 'info' | 'success' | 'error';
  message: string;
};

type PipelineSnapshot = VizPipeline & { status: VizPipeline['status'] | 'none' };

type PipelinePollTelemetry = {
  pollCount: number;
  pollErrors: number;
  totalFetchMs: number;
  maxFetchMs: number;
  lastFetchMs: number;
  tabHiddenSkips: number;
};

type PipelinePollTelemetrySnapshot = PipelinePollTelemetry & {
  avgFetchMs: number;
  tabVisible: boolean;
  autoRefresh: boolean;
  isPipelineActive: boolean;
  pollIntervalMs: number;
};

type PipelineActionOptions = {
  request: (repoId: number) => Promise<unknown>;
  refreshDelayMs: number;
  successMessage: string;
  failureMessage: string;
  logMessage: string;
};

declare global {
  interface Window {
    __FLEXDECK_PIPELINE_POLL__?: PipelinePollTelemetrySnapshot;
  }
}

function isPipelineSnapshot(value: unknown): value is PipelineSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const status = (value as { status?: unknown }).status;
  return typeof status === 'string' && status !== 'none';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const strings = value.filter((item): item is string => typeof item === 'string');
  return strings.length > 0 ? strings : fallback;
}

export function getPipelineRefreshInterval(
  pipeline: VizPipeline | undefined,
  lastUpdate: Date | null,
): number {
  if (!pipeline || !isLivePipelineId(pipeline.id)) return PIPELINE_POLL_IDLE;
  if (hasActiveJobs(pipeline)) return PIPELINE_POLL_ACTIVE;

  if (lastUpdate) {
    const ageMs = Date.now() - lastUpdate.getTime();
    if (ageMs < PIPELINE_RECENT_REFRESH_WINDOW_MS) return PIPELINE_POLL_RECENT;
  }

  return PIPELINE_POLL_IDLE;
}

export function usePipelineController() {
  const [repos, setRepos] = createSignal<RepoInfo[]>([]);
  const [selectedRepo, setSelectedRepo] = createSignal<RepoInfo | null>(null);
  const [pipelineData, setPipelineData] = createSignal<VizPipeline | undefined>(undefined);
  const [loading, setLoading] = createSignal(true);

  const [selectedJob, setSelectedJob] = createSignal<PipelineJob | null>(null);
  const [jobTrace, setJobTrace] = createSignal('');
  const [traceLoading, setTraceLoading] = createSignal(false);
  const [autoRefresh, setAutoRefresh] = createSignal(true);
  const [lastUpdate, setLastUpdate] = createSignal<Date | null>(null);
  const [pipelineSort, setPipelineSort] = createSignal<PipelineSortConfig>({
    field: 'activity',
    direction: 'desc',
  });
  const [pipelinesCache, setPipelinesCache] = createSignal<Map<number, VizPipeline>>(new Map());
  const [overviewLoading, setOverviewLoading] = createSignal(false);
  const [pipelineActionLoading, setPipelineActionLoading] = createSignal(false);
  const [triggerRef, setTriggerRef] = createSignal('main');
  const [pipelineFetchError, setPipelineFetchError] = createSignal(false);
  const [actionNotice, setActionNotice] = createSignal<ActionNotice | null>(null);

  const pendingTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();

  // Poll telemetry
  const pollTelemetry: PipelinePollTelemetry = {
    pollCount: 0,
    pollErrors: 0,
    totalFetchMs: 0,
    maxFetchMs: 0,
    lastFetchMs: 0,
    tabHiddenSkips: 0,
  };
  const recordPollFetch = (fetchStart: number, options: { updateMax: boolean }) => {
    const fetchMs = performance.now() - fetchStart;
    pollTelemetry.lastFetchMs = fetchMs;
    pollTelemetry.totalFetchMs += fetchMs;
    if (options.updateMax) {
      pollTelemetry.maxFetchMs = Math.max(pollTelemetry.maxFetchMs, fetchMs);
    }
  };

  const exportPollTelemetry = () => {
    if (typeof window !== 'undefined') {
      const snapshot: PipelinePollTelemetrySnapshot = {
        ...pollTelemetry,
        avgFetchMs: pollTelemetry.pollCount > 0 ? pollTelemetry.totalFetchMs / pollTelemetry.pollCount : 0,
        tabVisible: !document.hidden,
        autoRefresh: autoRefresh(),
        isPipelineActive: isPipelineActive(),
        pollIntervalMs: effectiveInterval(),
      };
      window.__FLEXDECK_PIPELINE_POLL__ = snapshot;
    }
  };

  const pushActionNotice = (type: ActionNotice['type'], message: string) => {
    setActionNotice({ type, message });
    const id = setTimeout(() => {
      pendingTimeouts.delete(id);
      setActionNotice((current) => (current?.message === message ? null : current));
    }, 4500);
    pendingTimeouts.add(id);
  };

  const fetchPipelineStatus = async (repoId: number) => {
    const fetchStart = performance.now();
    pollTelemetry.pollCount++;
    try {
      const liveData = await ciApi.getPipeline(repoId);
      recordPollFetch(fetchStart, { updateMax: true });
      if (isPipelineSnapshot(liveData)) {
        const normalizedPipeline = normalizePipeline(liveData);
        setPipelineData(normalizedPipeline);
        setPipelinesCache((prev) => {
          const next = new Map(prev);
          next.set(repoId, normalizedPipeline);
          return next;
        });
      }
      if (pipelineFetchError()) {
        pushActionNotice('success', 'Live pipeline status restored.');
      }
      setPipelineFetchError(false);
      setLastUpdate(new Date());
    } catch (error) {
      pollTelemetry.pollErrors++;
      recordPollFetch(fetchStart, { updateMax: false });
      if (!pipelineFetchError()) {
        pushActionNotice('error', 'Live pipeline status unavailable. Showing best available data.');
      }
      setPipelineFetchError(true);
      console.debug('No pipeline data available', error);
    }
    exportPollTelemetry();
  };

  const BATCH_CHUNK_SIZE = 20;

  /** Fetch pipelines for all repos using the batch endpoint, with individual-fetch fallback. */
  const fetchAllPipelines = async (repoList: RepoInfo[]) => {
    setOverviewLoading(true);
    const ids = repoList.map((r) => r.id).filter(Boolean);
    if (ids.length === 0) {
      setOverviewLoading(false);
      return;
    }

    try {
      await fetchAllPipelinesBatch(ids);
    } catch {
      // Batch endpoint unavailable — fall back to individual fetches
      await fetchAllPipelinesIndividual(repoList);
    }

    setOverviewLoading(false);
    setLastUpdate(new Date());
  };

  /** Fetch pipelines via batch endpoint, chunking to BATCH_CHUNK_SIZE per request. */
  const fetchAllPipelinesBatch = async (ids: number[]) => {
    const accumulated: Array<{ id: number; pipeline: VizPipeline }> = [];

    for (let i = 0; i < ids.length; i += BATCH_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + BATCH_CHUNK_SIZE);
      const resp = await ciApi.batchPipelines(chunk);
      for (const [id, data] of Object.entries(resp.pipelines)) {
        if (isPipelineSnapshot(data)) {
          accumulated.push({ id: Number(id), pipeline: normalizePipeline(data) });
        }
      }
    }

    if (accumulated.length > 0) {
      setPipelinesCache((prev) => {
        const next = new Map(prev);
        for (const entry of accumulated) {
          next.set(entry.id, entry.pipeline);
        }
        return next;
      });
    }
  };

  /** Legacy individual-fetch path (fallback when batch endpoint is unavailable). */
  const fetchAllPipelinesIndividual = async (repoList: RepoInfo[]) => {
    const individualBatchSize = 5;
    const accumulated: Array<{ id: number; pipeline: VizPipeline }> = [];

    for (let i = 0; i < repoList.length; i += individualBatchSize) {
      const group = repoList.slice(i, i + individualBatchSize);
      const results = await Promise.allSettled(
        group.map(async (repo) => {
          if (!repo.id) return null;
          try {
            const data = await ciApi.getPipeline(repo.id);
            if (isPipelineSnapshot(data)) {
              return { id: repo.id, pipeline: normalizePipeline(data) };
            }
          } catch {
            return null;
          }
          return null;
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          accumulated.push(result.value);
        }
      }
    }

    if (accumulated.length > 0) {
      setPipelinesCache((prev) => {
        const next = new Map(prev);
        for (const entry of accumulated) {
          next.set(entry.id, entry.pipeline);
        }
        return next;
      });
    }
  };

  const isPipelineActive = createMemo(() => {
    const pipeline = pipelineData() ?? null;
    if (!pipeline || !isLivePipelineId(pipeline.id)) return false;
    return hasActiveJobs(pipeline);
  });

  const effectiveInterval = createMemo(() => {
    return getPipelineRefreshInterval(pipelineData(), lastUpdate());
  });

  createPolling(
    'pipeline-poll',
    async () => {
      const repo = selectedRepo();
      if (repo?.id && selectedJob() === null) {
        await fetchPipelineStatus(repo.id);
      }
    },
    effectiveInterval,
    autoRefresh,
  );

  const scheduleRefresh = (fn: () => void, delay: number) => {
    const id = setTimeout(() => {
      pendingTimeouts.delete(id);
      fn();
    }, delay);
    pendingTimeouts.add(id);
  };

  const fetchJobTrace = async (projectId: number, jobId: string) => {
    setTraceLoading(true);
    setJobTrace('');
    try {
      const data = await ciApi.getJobTrace(projectId, jobId);
      setJobTrace(data.trace || '');
    } catch (error) {
      console.error('Failed to fetch job trace', error);
      setJobTrace('Failed to load job trace. The job may not have any output yet.');
    } finally {
      setTraceLoading(false);
    }
  };

  createEffect(() => {
    const job = selectedJob();
    const repo = selectedRepo();
    if (job && repo?.id && job.id) {
      const jobId = job.id.replace(/^job-/, '');
      if (!isLivePipelineId(jobId)) {
        setTraceLoading(false);
        setJobTrace('Live logs are unavailable for static pipeline previews.');
        return;
      }
      void fetchJobTrace(repo.id, jobId);
    }
  });

  const parseGitLabCi = async (content: string, repoName: string): Promise<VizPipeline> => {
    let parsed: unknown;
    try {
      const parse = await loadYamlParse();
      parsed = parse(content);
    } catch (error) {
      console.error('Failed to parse YAML', error);
      return {
        id: `pipeline-${repoName}-error`,
        ref: 'main',
        status: 'failed',
        createdAt: new Date().toISOString(),
        stages: [],
      };
    }

    if (!isRecord(parsed)) {
      return {
        id: `pipeline-${repoName}-empty`,
        ref: 'main',
        status: 'pending',
        createdAt: new Date().toISOString(),
        stages: [],
      };
    }

    const stages = readStringArray(parsed.stages, ['build', 'test', 'deploy']);

    const pipelineStages: PipelineStage[] = stages.map((name) => ({
      name,
      jobs: [],
    }));

    const reservedKeys = new Set([
      'stages',
      'types',
      'variables',
      'cache',
      'include',
      'image',
      'services',
      'before_script',
      'after_script',
      'workflow',
      'default',
    ]);

    Object.entries(parsed).forEach(([key, value]) => {
      if (reservedKeys.has(key) || key.startsWith('.') || !isRecord(value)) return;

      const jobStage = typeof value.stage === 'string' ? value.stage : 'test';
      let stage = pipelineStages.find((item) => item.name === jobStage);
      if (!stage && !stages.includes(jobStage)) {
        stage = pipelineStages.find((item) => item.name === 'test');
        if (!stage && pipelineStages.length > 0) stage = pipelineStages[0];
      }

      if (stage) {
        stage.jobs.push({
          id: `job-${key}`,
          name: key,
          stage: jobStage,
          status: 'pending',
          details: value,
        });
      }
    });

    return {
      id: `pipeline-${repoName}`,
      ref: 'main',
      status: 'pending',
      createdAt: new Date().toISOString(),
      stages: pipelineStages.filter((stage) => stage.jobs.length > 0),
    };
  };

  /** Lazy-load config content for a repo and update its entry in the repo list. */
  const fetchConfig = async (repoId: number) => {
    try {
      const data = await ciApi.repoConfig(repoId);
      if (data.hasConfig && data.configContent) {
        setRepos((prev) =>
          prev.map((r) =>
            r.id === repoId
              ? { ...r, configContent: data.configContent, hasConfig: data.hasConfig }
              : r,
          ),
        );
        // If this repo is currently selected, update the pipeline preview
        const current = selectedRepo();
        if (current?.id === repoId) {
          const updated = repos().find((r) => r.id === repoId);
          if (updated) {
            setSelectedRepo(updated);
            setPipelineData(await parseGitLabCi(data.configContent, updated.name));
          }
        }
      }
    } catch (error) {
      console.debug('Failed to fetch repo config', repoId, error);
    }
  };

  const selectRepo = async (repo: RepoInfo) => {
    batch(() => {
      setSelectedRepo(repo);
      setSelectedJob(null);
      setJobTrace('');
    });

    // Use already-loaded configContent if available; otherwise lazy-load it
    if (repo.hasConfig && repo.configContent) {
      setPipelineData(await parseGitLabCi(repo.configContent, repo.name));
    } else if (repo.hasConfig && repo.id) {
      setPipelineData(undefined);
      void fetchConfig(repo.id);
    } else {
      setPipelineData(undefined);
    }

    if (repo.id) {
      await fetchPipelineStatus(repo.id);
    }
  };

  const schedulePipelineRefresh = (repoId: number, delay: number) => {
    scheduleRefresh(() => void fetchPipelineStatus(repoId), delay);
  };

  const runPipelineAction = async (options: PipelineActionOptions) => {
    const repo = selectedRepo();
    if (!repo?.id) return;

    setPipelineActionLoading(true);
    try {
      await options.request(repo.id);
      schedulePipelineRefresh(repo.id, options.refreshDelayMs);
      pushActionNotice('success', options.successMessage);
    } catch (error) {
      console.error(options.logMessage, error);
      pushActionNotice('error', options.failureMessage);
    } finally {
      setPipelineActionLoading(false);
    }
  };

  const handleRetryPipeline = async () => {
    const repo = selectedRepo();
    const pipeline = pipelineData();
    if (!repo?.id || !pipeline?.id) return;
    if (!isLivePipelineId(pipeline.id)) {
      pushActionNotice('info', 'Retry is unavailable for static pipeline previews.');
      return;
    }
    await runPipelineAction({
      request: (repoId) => ciApi.retryPipeline(repoId, pipeline.id),
      refreshDelayMs: 1000,
      successMessage: 'Pipeline retry requested.',
      failureMessage: 'Pipeline retry failed.',
      logMessage: 'Failed to retry pipeline',
    });
  };

  const handleCancelPipeline = async () => {
    const repo = selectedRepo();
    const pipeline = pipelineData();
    if (!repo?.id || !pipeline?.id) return;
    if (!isLivePipelineId(pipeline.id)) {
      pushActionNotice('info', 'Cancel is unavailable for static pipeline previews.');
      return;
    }
    await runPipelineAction({
      request: (repoId) => ciApi.cancelPipeline(repoId, pipeline.id),
      refreshDelayMs: 1000,
      successMessage: 'Pipeline cancel requested.',
      failureMessage: 'Pipeline cancel failed.',
      logMessage: 'Failed to cancel pipeline',
    });
  };

  const handleTriggerPipeline = async () => {
    const repo = selectedRepo();
    if (!repo?.id || !triggerRef()) return;
    const ref = triggerRef();
    await runPipelineAction({
      request: (repoId) => ciApi.triggerPipeline(repoId, ref),
      refreshDelayMs: 2000,
      successMessage: `Pipeline trigger requested for ${ref}.`,
      failureMessage: 'Pipeline trigger failed.',
      logMessage: 'Failed to trigger pipeline',
    });
  };

  const pipelineDataState = createMemo<PipelineDataState>(() =>
    getPipelineDataState({
      pipeline: pipelineData(),
      lastUpdate: lastUpdate(),
      fetchError: pipelineFetchError(),
      staleAfterMs: PIPELINE_STALE_AFTER_MS,
    }),
  );

  const dataStateMeta = createMemo(() => {
    return getPipelineDataStateMeta({
      pipeline: pipelineData(),
      lastUpdate: lastUpdate(),
      fetchError: pipelineFetchError(),
      staleAfterMs: PIPELINE_STALE_AFTER_MS,
    });
  });

  const formatTimeAgo = (date: Date | null) => {
    if (!date) return 'Never';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  };

  onMount(async () => {
    try {
      // Parallel fetch: repos + trends (eliminate sequential waterfall)
      const [reposResult, trendsResult] = await Promise.allSettled([
        ciApi.listRepos(),
        ciApi.getTrends(),
      ]);

      let normalizedRepos: RepoInfo[] = [];
      if (reposResult.status === 'fulfilled') {
        const data = reposResult.value;
        normalizedRepos = Array.isArray(data) ? data : [];
        if (!Array.isArray(data)) {
          console.warn('Unexpected /api/ci/repos payload shape; expected array', data);
        }
        setRepos(normalizedRepos);
      } else {
        console.error('Failed to fetch repos', reposResult.reason);
      }

      if (trendsResult.status === 'rejected') {
        console.debug('Trends pre-fetch failed (non-critical)', trendsResult.reason);
      }

      // Use batch endpoint for initial pipeline load
      if (normalizedRepos.length > 0) {
        void fetchAllPipelines(normalizedRepos);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  });

  onCleanup(() => {
    pendingTimeouts.forEach(clearTimeout);
    pendingTimeouts.clear();
  });

  return {
    actionNotice,
    autoRefresh,
    dataStateMeta,
    fetchConfig,
    fetchPipelineStatus,
    formatTimeAgo,
    handleCancelPipeline,
    handleRetryPipeline,
    handleTriggerPipeline,
    isPipelineActive,
    jobTrace,
    lastUpdate,
    loading,
    overviewLoading,
    pipelineActionLoading,
    pipelineData,
    pipelineDataState,
    pipelineSort,
    pipelinesCache,
    pushActionNotice,
    repos,
    scheduleRefresh,
    selectedJob,
    selectedRepo,
    selectRepo,
    setAutoRefresh,
    setPipelineSort,
    setSelectedJob,
    setTriggerRef,
    traceLoading,
    triggerRef,
  };
}
