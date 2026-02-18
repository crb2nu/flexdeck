import { Component, createSignal, createEffect, onMount, onCleanup, For, Show, lazy, Suspense, ErrorBoundary } from 'solid-js';
import { parse } from 'yaml';
import CIPipelineViz, { Pipeline as VizPipeline, PipelineStage } from './CIPipelineViz';
import PipelineListView from './PipelineListView';
import { ciApi, RepoInfo } from '../../lib/api';
import type { PipelineSortConfig } from './utils';

const PipelineTrends = lazy(() => import('./PipelineTrends'));
const PipelineHistory = lazy(() => import('./PipelineHistory'));

const POLL_INTERVAL = 10000; // 10 seconds

const Pipeline: Component = () => {
  const [repos, setRepos] = createSignal<RepoInfo[]>([]);
  const [selectedRepo, setSelectedRepo] = createSignal<RepoInfo | null>(null);
  const [pipelineData, setPipelineData] = createSignal<VizPipeline | undefined>(undefined);
  const [loading, setLoading] = createSignal(true);

  const [selectedJob, setSelectedJob] = createSignal<any>(null);
  const [jobTrace, setJobTrace] = createSignal<string>('');
  const [traceLoading, setTraceLoading] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<'config' | 'logs'>('logs');
  const [repoFilter, setRepoFilter] = createSignal('');

  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = createSignal(true);
  const [lastUpdate, setLastUpdate] = createSignal<Date | null>(null);
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  const pendingTimeouts: Set<ReturnType<typeof setTimeout>> = new Set();

  // View mode and sorting state for pipeline overview
  const [viewMode, setViewMode] = createSignal<'overview' | 'detail'>('overview');
  const [pipelineSort, setPipelineSort] = createSignal<PipelineSortConfig>({
    field: 'activity',
    direction: 'desc'
  });
  const [pipelinesCache, setPipelinesCache] = createSignal<Map<number, VizPipeline>>(new Map());
  const [overviewLoading, setOverviewLoading] = createSignal(false);

  // Page-level tabs
  const [pageTab, setPageTab] = createSignal<'pipelines' | 'trends' | 'history'>('pipelines');

  // Pipeline-level action state
  const [pipelineActionLoading, setPipelineActionLoading] = createSignal(false);
  const [triggerRef, setTriggerRef] = createSignal('main');

  onMount(async () => {
    try {
      const data = await ciApi.listRepos();
      setRepos(data);
      // Load pipelines for overview mode
      if (data.length > 0) {
        fetchAllPipelines(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  });

  const fetchPipelineStatus = async (repoId: number) => {
      try {
          const liveData = await ciApi.getPipeline(repoId);
          if (liveData && liveData.status !== 'none') {
              setPipelineData(liveData);
              // Also update the cache
              setPipelinesCache(prev => {
                  const next = new Map(prev);
                  next.set(repoId, liveData);
                  return next;
              });
          }
          setLastUpdate(new Date());
      } catch (e) {
          // Silently handle - repo might not have any pipelines yet
          console.debug("No pipeline data available", e);
      }
  };

  // Fetch all pipelines for overview mode (batched)
  const fetchAllPipelines = async (repoList: RepoInfo[]) => {
      setOverviewLoading(true);
      const BATCH_SIZE = 5;

      for (let i = 0; i < repoList.length; i += BATCH_SIZE) {
          const batch = repoList.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
              batch.map(async (repo) => {
                  if (!repo.id) return null;
                  try {
                      const data = await ciApi.getPipeline(repo.id);
                      if (data && data.status !== 'none') {
                          return { id: repo.id, pipeline: data as VizPipeline };
                      }
                  } catch {
                      // Silently skip repos without pipelines
                  }
                  return null;
              })
          );

          // Update cache with successful results
          setPipelinesCache(prev => {
              const next = new Map(prev);
              results.forEach(result => {
                  if (result.status === 'fulfilled' && result.value) {
                      next.set(result.value.id, result.value.pipeline);
                  }
              });
              return next;
          });
      }

      setOverviewLoading(false);
      setLastUpdate(new Date());
  };

  // Check if pipeline has running jobs
  const isPipelineActive = () => {
    const pipeline = pipelineData();
    if (!pipeline) return false;
    return pipeline.stages.some(stage =>
      stage.jobs.some(job => job.status === 'running' || job.status === 'pending')
    );
  };

  // Auto-refresh polling effect
  createEffect(() => {
    // Clear existing interval
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }

    const repo = selectedRepo();
    const isActive = isPipelineActive();
    const isAutoRefresh = autoRefresh();
    const hasJobSelected = selectedJob() !== null;

    // Only poll when: repo selected, pipeline active, auto-refresh on, no job panel open
    if (repo?.id && isActive && isAutoRefresh && !hasJobSelected) {
      pollInterval = setInterval(() => {
        fetchPipelineStatus(repo.id);
      }, POLL_INTERVAL);
    }
  });

  const scheduleRefresh = (fn: () => void, delay: number) => {
    const id = setTimeout(() => {
      pendingTimeouts.delete(id);
      fn();
    }, delay);
    pendingTimeouts.add(id);
  };

  // Cleanup on unmount
  onCleanup(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    pendingTimeouts.forEach(clearTimeout);
    pendingTimeouts.clear();
  });

  // Format time ago
  const formatTimeAgo = (date: Date | null) => {
    if (!date) return 'Never';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  };

  const fetchJobTrace = async (projectId: number, jobId: string) => {
    setTraceLoading(true);
    setJobTrace('');
    try {
      const data = await ciApi.getJobTrace(projectId, jobId);
      setJobTrace(data.trace || '');
    } catch (e) {
      console.error("Failed to fetch job trace", e);
      setJobTrace('Failed to load job trace. The job may not have any output yet.');
    } finally {
      setTraceLoading(false);
    }
  };

  // Auto-fetch logs when a job is selected
  createEffect(() => {
    const job = selectedJob();
    const repo = selectedRepo();
    if (job && repo?.id && job.id) {
      // Extract numeric job ID from the format "job-123" or just "123"
      const jobId = job.id.replace(/^job-/, '');
      fetchJobTrace(repo.id, jobId);
    }
  });

  const selectRepo = async (repo: RepoInfo, switchToDetail = true) => {
    setSelectedRepo(repo);
    setSelectedJob(null);
    setJobTrace('');
    // Switch to detail view when selecting a repo
    if (switchToDetail) {
      setViewMode('detail');
    }
    // Optimistic / Static load from YAML first
    if (repo.hasConfig && repo.configContent) {
        setPipelineData(parseGitLabCi(repo.configContent, repo.name));
    } else {
        setPipelineData(undefined);
    }

    // Then fetch live status
    if (repo.id) {
        await fetchPipelineStatus(repo.id);
    }
  };

  const handleRetryPipeline = async () => {
    const repo = selectedRepo();
    const pipeline = pipelineData();
    if (!repo?.id || !pipeline?.id) return;
    setPipelineActionLoading(true);
    try {
      await ciApi.retryPipeline(repo.id, pipeline.id);
      scheduleRefresh(() => fetchPipelineStatus(repo.id), 1000);
    } catch (e) {
      console.error('Failed to retry pipeline', e);
    } finally {
      setPipelineActionLoading(false);
    }
  };

  const handleCancelPipeline = async () => {
    const repo = selectedRepo();
    const pipeline = pipelineData();
    if (!repo?.id || !pipeline?.id) return;
    setPipelineActionLoading(true);
    try {
      await ciApi.cancelPipeline(repo.id, pipeline.id);
      scheduleRefresh(() => fetchPipelineStatus(repo.id), 1000);
    } catch (e) {
      console.error('Failed to cancel pipeline', e);
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
      scheduleRefresh(() => fetchPipelineStatus(repo.id), 2000);
    } catch (e) {
      console.error('Failed to trigger pipeline', e);
    } finally {
      setPipelineActionLoading(false);
    }
  };

  const filteredRepos = () => {
    return repos().filter(r => r.name.toLowerCase().includes(repoFilter().toLowerCase()));
  };
  
  // ...

  const parseGitLabCi = (content: string, repoName: string): VizPipeline => {
      let parsed: any;
      try {
          parsed = parse(content);
      } catch (e) {
          console.error("Failed to parse YAML", e);
          return {
              id: `pipeline-${repoName}-error`,
              ref: 'main',
              status: 'failed',
              createdAt: new Date().toISOString(),
              stages: []
          };
      }

      if (!parsed) return {
          id: `pipeline-${repoName}-empty`,
          ref: 'main',
          status: 'pending',
          createdAt: new Date().toISOString(),
          stages: []
      };

      // Extract stages
      let stages: string[] = parsed.stages || ['build', 'test', 'deploy'];
      
      // Normalize stages if it's not an array (unlikely but possible in some valid yamls)
      if (!Array.isArray(stages)) stages = ['build', 'test', 'deploy'];

      // Initialize pipeline stages
      const pipelineStages: PipelineStage[] = stages.map(name => ({
          name,
          jobs: []
      }));

      // Reserved keys in GitLab CI that are NOT jobs
      const reservedKeys = new Set([
          'stages', 'types', 'variables', 'cache', 'include', 'image', 'services', 
          'before_script', 'after_script', 'workflow', 'default'
      ]);

      // Iterate over keys to find jobs
      Object.entries(parsed).forEach(([key, value]: [string, any]) => {
          if (reservedKeys.has(key) || key.startsWith('.')) return; // Skip reserved and hidden jobs
          if (typeof value !== 'object' || !value) return; 

          // Determine stage
          const jobStage = value.stage || 'test'; // Default stage is 'test' per GitLab spec (usually)
          
          // Find or create stage (if someone uses a stage not in the 'stages' array, unlikely but handled)
          let stage = pipelineStages.find(s => s.name === jobStage);
          if (!stage) {
               // If strict, we might ignore. For viz, let's add it or map to 'unknown'? 
               // GitLab validation would fail, but we want to show something.
               // Let's check if there is a 'test' stage if stage is missing from definition
               if (parsed.stages && !parsed.stages.includes(jobStage)) {
                   // Job references undefined stage.
                   stage = pipelineStages.find(s => s.name === 'test');
                   if (!stage && pipelineStages.length > 0) stage = pipelineStages[0];
               }
          }
          
          if (stage) {
              stage.jobs.push({
                  id: `job-${key}`,
                  name: key,
                  stage: jobStage,
                  status: 'pending',
                  details: value
              });
          }
      });

      return {
          id: `pipeline-${repoName}`,
          ref: 'main',
          status: 'pending',
          createdAt: new Date().toISOString(),
          stages: pipelineStages.filter(s => s.jobs.length > 0)
      };
  };

  return (
    <div class="flex h-full min-h-0 w-full overflow-hidden">
        {/* Sidebar */}
        <div class="w-64 border-r border-white/10 bg-black/20 flex flex-col">
            <div class="p-4 border-b border-white/5 space-y-3">
                {/* Page tabs */}
                <div class="flex gap-1 p-1 rounded-lg bg-black/40 border border-white/10">
                    <button
                        onClick={() => setPageTab('pipelines')}
                        class={`flex-1 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded transition-all ${
                            pageTab() === 'pipelines'
                                ? 'bg-neon-cyan/20 text-neon-cyan'
                                : 'text-text-dim hover:text-text-main hover:bg-white/5'
                        }`}
                    >
                        Pipelines
                    </button>
                    <button
                        onClick={() => setPageTab('trends')}
                        class={`flex-1 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded transition-all ${
                            pageTab() === 'trends'
                                ? 'bg-neon-cyan/20 text-neon-cyan'
                                : 'text-text-dim hover:text-text-main hover:bg-white/5'
                        }`}
                    >
                        Trends
                    </button>
                    <button
                        onClick={() => setPageTab('history')}
                        class={`flex-1 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded transition-all ${
                            pageTab() === 'history'
                                ? 'bg-neon-cyan/20 text-neon-cyan'
                                : 'text-text-dim hover:text-text-main hover:bg-white/5'
                        }`}
                    >
                        History
                    </button>
                </div>

                {/* Show sidebar controls only in Pipelines tab */}
                <Show when={pageTab() === 'pipelines'}>
                    {/* View toggle */}
                    <div class="flex gap-1 p-1 rounded-lg bg-black/40 border border-white/10">
                        <button
                            onClick={() => setViewMode('overview')}
                            class={`flex-1 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded transition-all ${
                                viewMode() === 'overview'
                                    ? 'bg-neon-cyan/20 text-neon-cyan'
                                    : 'text-text-dim hover:text-text-main hover:bg-white/5'
                            }`}
                        >
                            Overview
                        </button>
                        <button
                            onClick={() => setViewMode('detail')}
                            class={`flex-1 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider rounded transition-all ${
                                viewMode() === 'detail'
                                    ? 'bg-neon-cyan/20 text-neon-cyan'
                                    : 'text-text-dim hover:text-text-main hover:bg-white/5'
                            }`}
                        >
                            Detail
                        </button>
                    </div>
                    <h2 class="text-xs font-bold uppercase tracking-wider text-text-muted">Repositories</h2>
                    <input
                        type="text"
                        placeholder="Filter..."
                        class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white focus:border-neon-cyan focus:outline-none"
                        value={repoFilter()}
                        onInput={(e) => setRepoFilter(e.currentTarget.value)}
                    />
                </Show>
            </div>

            {/* Repo list only in Pipelines tab */}
            <Show when={pageTab() === 'pipelines'}>
                <div class="flex-1 p-2 flex flex-col gap-1 overflow-y-auto">
                    <Show when={loading()}>
                        <div class="px-3 py-2 text-xs text-text-dim">Loading...</div>
                    </Show>
                    <For each={filteredRepos()}>
                        {(repo) => (
                            <button
                                class={`text-left px-3 py-2 rounded text-sm font-medium transition-colors group relative ${
                                    selectedRepo()?.path === repo.path
                                        ? 'bg-neon-cyan/20 text-neon-cyan'
                                        : 'text-text-dim hover:bg-white/5'
                                }`}
                                onClick={() => {
                                    selectRepo(repo);
                                    setSelectedJob(null);
                                }}
                            >
                                <div class="truncate">{repo.name}</div>
                                <div class="text-[10px] opacity-50 font-mono mt-0.5 flex items-center justify-between">
                                    <span>{repo.type}</span>
                                    <Show when={repo.hasConfig}>
                                        <span class="w-1.5 h-1.5 rounded-full bg-neon-green shadow-[0_0_5px_rgba(10,255,104,0.5)]" title="Config found" />
                                    </Show>
                                </div>
                            </button>
                        )}
                    </For>
                </div>
            </Show>
        </div>

        {/* Main Content */}
        <div class="flex-1 overflow-hidden relative bg-[#050a14] flex flex-col">
            {/* Trends Tab */}
            <Show when={pageTab() === 'trends'}>
                <ErrorBoundary fallback={(err) => (
                    <div class="glass-panel m-4 p-4 text-sm text-status-error border border-status-error/20">
                        Failed to load Trends: {err.message}
                    </div>
                )}>
                    <Suspense fallback={
                        <div class="flex items-center justify-center py-12">
                            <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
                        </div>
                    }>
                        <PipelineTrends />
                    </Suspense>
                </ErrorBoundary>
            </Show>

            {/* History Tab */}
            <Show when={pageTab() === 'history'}>
                <ErrorBoundary fallback={(err) => (
                    <div class="glass-panel m-4 p-4 text-sm text-status-error border border-status-error/20">
                        Failed to load History: {err.message}
                    </div>
                )}>
                    <Suspense fallback={
                        <div class="flex items-center justify-center py-12">
                            <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
                        </div>
                    }>
                        <PipelineHistory repos={repos()} />
                    </Suspense>
                </ErrorBoundary>
            </Show>

            {/* Pipelines Tab - Overview Mode */}
            <Show when={pageTab() === 'pipelines' && viewMode() === 'overview'}>
                <PipelineListView
                    repos={filteredRepos()}
                    pipelinesCache={pipelinesCache()}
                    sort={pipelineSort()}
                    onSortChange={setPipelineSort}
                    onSelectPipeline={(repo) => selectRepo(repo, true)}
                    loading={overviewLoading()}
                />
            </Show>

            {/* Pipelines Tab - Detail Mode */}
            <Show when={pageTab() === 'pipelines' && viewMode() === 'detail'}>
                <Show when={selectedRepo()} fallback={
                    <div class="flex h-full items-center justify-center text-text-muted flex-col gap-2">
                        <div class="text-xl">Select a repository</div>
                        <div class="text-sm opacity-50">View CI pipelines for your local workspaces</div>
                    </div>
                }>
                    <Show when={pipelineData()} fallback={
                    <div class="flex h-full items-center justify-center text-text-muted flex-col gap-2">
                        <div class="text-xl">No CI Configuration</div>
                        <div class="text-sm opacity-50">
                            {selectedRepo()?.name} does not have a .gitlab-ci.yml file.
                        </div>
                    </div>
                }>
                    {/* Auto-refresh header bar */}
                    <div class="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-black/30">
                        <div class="flex items-center gap-4">
                            <div class="text-xs font-mono text-text-muted">
                                {selectedRepo()?.name}
                            </div>
                            <Show when={isPipelineActive()}>
                                <div class="flex items-center gap-1.5">
                                    <div class="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
                                    <span class="text-[10px] text-neon-cyan uppercase tracking-wider">Active</span>
                                </div>
                            </Show>
                        </div>
                        <div class="flex items-center gap-4">
                            {/* Last update time */}
                            <Show when={lastUpdate()}>
                                <div class="text-[10px] text-text-dim font-mono">
                                    Updated: {formatTimeAgo(lastUpdate())}
                                </div>
                            </Show>
                            {/* Auto-refresh toggle */}
                            <button
                                class={`flex items-center gap-2 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider transition-all ${
                                    autoRefresh()
                                        ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                                        : 'bg-white/5 text-text-muted border border-white/10 hover:bg-white/10'
                                }`}
                                onClick={() => setAutoRefresh(!autoRefresh())}
                            >
                                <div class={`w-1.5 h-1.5 rounded-full transition-colors ${
                                    autoRefresh() ? 'bg-neon-cyan' : 'bg-text-dim'
                                }`} />
                                Auto-refresh: {autoRefresh() ? 'ON' : 'OFF'}
                            </button>
                            {/* Manual refresh button */}
                            <button
                                class="px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-white/5 text-text-muted border border-white/10 hover:bg-white/10 transition-all"
                                onClick={() => {
                                    const repo = selectedRepo();
                                    if (repo?.id) fetchPipelineStatus(repo.id);
                                }}
                            >
                                ↻ Refresh
                            </button>

                            {/* Pipeline-level actions */}
                            <div class="flex items-center gap-1 ml-2 pl-2 border-l border-white/10">
                                <Show when={pipelineData()?.status === 'failed' || pipelineData()?.status === 'canceled'}>
                                    <button
                                        class="px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-neon-green/10 text-neon-green border border-neon-green/20 hover:bg-neon-green/20 transition-all disabled:opacity-50"
                                        onClick={handleRetryPipeline}
                                        disabled={pipelineActionLoading()}
                                    >
                                        Retry Pipeline
                                    </button>
                                </Show>
                                <Show when={pipelineData()?.status === 'running' || pipelineData()?.status === 'pending'}>
                                    <button
                                        class="px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-red-400/10 text-red-400 border border-red-400/20 hover:bg-red-400/20 transition-all disabled:opacity-50"
                                        onClick={handleCancelPipeline}
                                        disabled={pipelineActionLoading()}
                                    >
                                        Cancel Pipeline
                                    </button>
                                </Show>
                                <div class="flex items-center gap-1">
                                    <input
                                        type="text"
                                        class="w-20 px-1.5 py-1 rounded text-[10px] font-mono bg-black/40 border border-white/10 text-white focus:border-neon-cyan focus:outline-none"
                                        value={triggerRef()}
                                        onInput={(e) => setTriggerRef(e.currentTarget.value)}
                                        placeholder="ref"
                                    />
                                    <button
                                        class="px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-neon-purple/10 text-neon-purple border border-neon-purple/20 hover:bg-neon-purple/20 transition-all disabled:opacity-50"
                                        onClick={handleTriggerPipeline}
                                        disabled={pipelineActionLoading() || !triggerRef()}
                                    >
                                        Trigger
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="flex-1 relative p-4">
                        <CIPipelineViz
                            pipeline={pipelineData()}
                            projectId={selectedRepo()?.id}
                            onJobClick={(job) => setSelectedJob(job)}
                            onRefresh={() => {
                                const repo = selectedRepo();
                                if (repo?.id) {
                                    // Delay refresh to allow GitLab to process the action
                                    scheduleRefresh(() => fetchPipelineStatus(repo.id), 1000);
                                }
                            }}
                        />
                    </div>

                    {/* Job Details Panel */}
                    <Show when={selectedJob()}>
                        <div class="h-80 border-t border-white/10 bg-black/60 backdrop-blur-md flex flex-col animate-slide-up">
                            {/* Header */}
                            <div class="flex items-center justify-between p-4 border-b border-white/5">
                                <div class="flex items-center gap-3">
                                    <div class={`w-2 h-2 rounded-full ${
                                        selectedJob().status === 'success' ? 'bg-neon-green' :
                                        selectedJob().status === 'failed' ? 'bg-red-500' :
                                        selectedJob().status === 'running' ? 'bg-neon-cyan animate-pulse' :
                                        selectedJob().status === 'pending' ? 'bg-yellow-500' :
                                        'bg-gray-500'
                                    }`} />
                                    <div class="text-lg font-mono font-bold text-white">{selectedJob().name}</div>
                                    <span class="text-xs uppercase px-2 py-0.5 rounded bg-white/10 text-text-muted">{selectedJob().stage}</span>
                                    <Show when={selectedJob().duration}>
                                        <span class="text-xs text-text-dim">
                                            {Math.round(selectedJob().duration)}s
                                        </span>
                                    </Show>
                                </div>
                                <div class="flex items-center gap-2">
                                    {/* Tabs */}
                                    <div class="flex gap-1 bg-black/40 rounded p-0.5">
                                        <button
                                            class={`px-3 py-1 text-xs rounded transition-colors ${
                                                activeTab() === 'logs' ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-text-muted hover:text-white'
                                            }`}
                                            onClick={() => setActiveTab('logs')}
                                        >
                                            Logs
                                        </button>
                                        <button
                                            class={`px-3 py-1 text-xs rounded transition-colors ${
                                                activeTab() === 'config' ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-text-muted hover:text-white'
                                            }`}
                                            onClick={() => setActiveTab('config')}
                                        >
                                            Config
                                        </button>
                                    </div>
                                    <button 
                                        class="text-text-muted hover:text-white ml-2"
                                        onClick={() => setSelectedJob(null)}
                                    >
                                        ✕
                                    </button>
                                </div>
                            </div>
                            
                            {/* Content */}
                            <div class="flex-1 overflow-y-auto p-4">
                                <Show when={activeTab() === 'logs'}>
                                    <Show when={traceLoading()}>
                                        <div class="flex items-center gap-2 text-text-muted">
                                            <div class="w-4 h-4 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
                                            Loading job logs...
                                        </div>
                                    </Show>
                                    <Show when={!traceLoading() && jobTrace()}>
                                        <pre class="font-mono text-xs text-text-dim whitespace-pre-wrap break-all leading-relaxed">
                                            {/* Strip ANSI codes for cleaner display */}
                                            {jobTrace().replace(/\x1b\[[0-9;]*m/g, '')}
                                        </pre>
                                    </Show>
                                    <Show when={!traceLoading() && !jobTrace()}>
                                        <div class="text-text-muted text-sm">
                                            No log output available for this job.
                                        </div>
                                    </Show>
                                </Show>
                                
                                <Show when={activeTab() === 'config'}>
                                    <div class="grid grid-cols-2 gap-8">
                                        <Show when={selectedJob().details?.script}>
                                            <div class="flex flex-col gap-2">
                                                <div class="text-xs font-bold uppercase text-neon-cyan tracking-wider">Script</div>
                                                <div class="bg-black/50 rounded p-3 font-mono text-xs text-text-dim border border-white/5">
                                                    <For each={selectedJob().details.script}>
                                                        {(line: string) => <div class="whitespace-pre-wrap">$ {line}</div>}
                                                    </For>
                                                </div>
                                            </div>
                                        </Show>
                                        
                                        <div class="flex flex-col gap-4">
                                            <Show when={selectedJob().details?.image}>
                                                <div>
                                                    <div class="text-xs font-bold uppercase text-neon-purple tracking-wider mb-1">Image</div>
                                                    <div class="font-mono text-sm text-white">{selectedJob().details.image}</div>
                                                </div>
                                            </Show>
                                            
                                            {/* Other properties */}
                                            <div class="flex flex-col gap-2">
                                                <div class="text-xs font-bold uppercase text-text-muted tracking-wider">Configuration</div>
                                                <div class="grid grid-cols-2 gap-2 text-xs font-mono">
                                                    <For each={Object.entries(selectedJob().details || {}).filter(([k]) => !['script', 'before_script', 'after_script', 'image', 'name', 'stage'].includes(k))}>
                                                        {([key, val]) => (
                                                            <>
                                                                <div class="text-text-dim">{key}:</div>
                                                                <div class="text-white truncate" title={String(val)}>{String(val)}</div>
                                                            </>
                                                        )}
                                                    </For>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </Show>
                            </div>
                        </div>
                    </Show>
                </Show>
            </Show>
            </Show>
        </div>
    </div>
  );
};

export default Pipeline;
