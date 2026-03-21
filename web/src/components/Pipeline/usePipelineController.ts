import { batch, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { parse } from 'yaml';
import { ciApi, type RepoInfo } from '../../lib/api';
import type { Pipeline as VizPipeline, PipelineJob, PipelineStage } from './CIPipelineViz';
import {
  getPipelineDataState,
  hasActiveJobs,
  isLivePipelineId,
  normalizePipeline,
  type PipelineDataState,
  type PipelineSortConfig,
} from './utils';

export const PIPELINE_POLL_ACTIVE = 10_000;   // Running/pending pipelines
export const PIPELINE_POLL_RECENT = 30_000;   // Terminal <5min
export const PIPELINE_POLL_IDLE = 60_000;     // Terminal >5min or no pipeline
export const PIPELINE_POLL_INTERVAL = PIPELINE_POLL_ACTIVE; // legacy alias
export const PIPELINE_STALE_AFTER_MS = PIPELINE_POLL_ACTIVE * 3;

export type ActionNotice = {
  type: 'info' | 'success' | 'error';
  message: string;
};

type PipelineSnapshot = VizPipeline & { status: VizPipeline['status'] | 'none' };

function isPipelineSnapshot(value: unknown): value is PipelineSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const status = (value as { status?: unknown }).status;
  return typeof status === 'string' && status !== 'none';
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
  const pollTelemetry = {
    pollCount: 0,
    pollErrors: 0,
    totalFetchMs: 0,
    maxFetchMs: 0,
    lastFetchMs: 0,
    tabHiddenSkips: 0,
  };
  const exportPollTelemetry = () => {
    if (typeof window !== 'undefined') {
      (window as any).__FLEXDECK_PIPELINE_POLL__ = {
        ...pollTelemetry,
        avgFetchMs: pollTelemetry.pollCount > 0 ? pollTelemetry.totalFetchMs / pollTelemetry.pollCount : 0,
        tabVisible: !document.hidden,
        autoRefresh: autoRefresh(),
        isPipelineActive: isPipelineActive(),
        pollIntervalMs: effectiveInterval(),
      };
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
      const fetchMs = performance.now() - fetchStart;
      pollTelemetry.lastFetchMs = fetchMs;
      pollTelemetry.totalFetchMs += fetchMs;
      pollTelemetry.maxFetchMs = Math.max(pollTelemetry.maxFetchMs, fetchMs);
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
      const fetchMs = performance.now() - fetchStart;
      pollTelemetry.lastFetchMs = fetchMs;
      pollTelemetry.totalFetchMs += fetchMs;
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
    const pipeline = pipelineData();
    if (!pipeline || !isLivePipelineId(pipeline.id)) return PIPELINE_POLL_IDLE;
    if (hasActiveJobs(pipeline)) return PIPELINE_POLL_ACTIVE;

    // Terminal pipeline — check how recently it finished.
    const last = lastUpdate();
    if (last) {
      const ageMs = Date.now() - last.getTime();
      if (ageMs < 5 * 60_000) return PIPELINE_POLL_RECENT;
    }
    return PIPELINE_POLL_IDLE;
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

  const parseGitLabCi = (content: string, repoName: string): VizPipeline => {
    let parsed: any;
    try {
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

    if (!parsed) {
      return {
        id: `pipeline-${repoName}-empty`,
        ref: 'main',
        status: 'pending',
        createdAt: new Date().toISOString(),
        stages: [],
      };
    }

    let stages: string[] = parsed.stages || ['build', 'test', 'deploy'];
    if (!Array.isArray(stages)) stages = ['build', 'test', 'deploy'];

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

    Object.entries(parsed).forEach(([key, value]: [string, any]) => {
      if (reservedKeys.has(key) || key.startsWith('.') || typeof value !== 'object' || !value) return;

      const jobStage = value.stage || 'test';
      let stage = pipelineStages.find((item) => item.name === jobStage);
      if (!stage && parsed.stages && !parsed.stages.includes(jobStage)) {
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
            setPipelineData(parseGitLabCi(data.configContent, updated.name));
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
      setPipelineData(parseGitLabCi(repo.configContent, repo.name));
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

  const handleRetryPipeline = async () => {
    const repo = selectedRepo();
    const pipeline = pipelineData();
    if (!repo?.id || !pipeline?.id) return;
    if (!isLivePipelineId(pipeline.id)) {
      pushActionNotice('info', 'Retry is unavailable for static pipeline previews.');
      return;
    }
    setPipelineActionLoading(true);
    try {
      await ciApi.retryPipeline(repo.id, pipeline.id);
      scheduleRefresh(() => void fetchPipelineStatus(repo.id), 1000);
      pushActionNotice('success', 'Pipeline retry requested.');
    } catch (error) {
      console.error('Failed to retry pipeline', error);
      pushActionNotice('error', 'Pipeline retry failed.');
    } finally {
      setPipelineActionLoading(false);
    }
  };

  const handleCancelPipeline = async () => {
    const repo = selectedRepo();
    const pipeline = pipelineData();
    if (!repo?.id || !pipeline?.id) return;
    if (!isLivePipelineId(pipeline.id)) {
      pushActionNotice('info', 'Cancel is unavailable for static pipeline previews.');
      return;
    }
    setPipelineActionLoading(true);
    try {
      await ciApi.cancelPipeline(repo.id, pipeline.id);
      scheduleRefresh(() => void fetchPipelineStatus(repo.id), 1000);
      pushActionNotice('success', 'Pipeline cancel requested.');
    } catch (error) {
      console.error('Failed to cancel pipeline', error);
      pushActionNotice('error', 'Pipeline cancel failed.');
    } finally {
      setPipelineActionLoading(false);
    }
  };

  const handleTriggerPipeline = async () => {
    const repo = selectedRepo();
    if (!repo?.id || !triggerRef()) return;
    setPipelineActionLoading(true);
    try {
      await ciApi.triggerPipeline(repo.id, triggerRef());
      scheduleRefresh(() => void fetchPipelineStatus(repo.id), 2000);
      pushActionNotice('success', `Pipeline trigger requested for ${triggerRef()}.`);
    } catch (error) {
      console.error('Failed to trigger pipeline', error);
      pushActionNotice('error', 'Pipeline trigger failed.');
    } finally {
      setPipelineActionLoading(false);
    }
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
    const state = pipelineDataState();
    switch (state) {
      case 'live':
        return { label: 'LIVE' };
      case 'stale':
        return { label: 'STALE' };
      case 'static':
        return { label: 'STATIC' };
      default:
        return { label: 'OFFLINE' };
    }
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
