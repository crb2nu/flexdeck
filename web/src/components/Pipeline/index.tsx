import { Component, createEffect, createSignal, Show, lazy, Suspense, ErrorBoundary, createMemo, For } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import type { RepoInfo } from '../../lib/api';
import CIPipelineViz from './CIPipelineViz';
import PipelineListView from './PipelineListView';
import {
  getStatusColor,
  getStatusLabel,
  isLivePipelineId,
} from './utils';
import { usePipelineController } from './usePipelineController';
import { TabBar, LoadingState, ErrorState, Input } from '../shared';
import type { TabDef } from '../shared';

const PipelineTrends = lazy(() => import('./PipelineTrends'));
const PipelineHistory = lazy(() => import('./PipelineHistory'));

type PageTab = 'pipelines' | 'trends' | 'history';
type ViewMode = 'overview' | 'detail';

const isPageTab = (v: unknown): v is PageTab =>
  typeof v === 'string' && ['pipelines', 'trends', 'history'].includes(v);
const isViewMode = (v: unknown): v is ViewMode =>
  typeof v === 'string' && ['overview', 'detail'].includes(v);

const Pipeline: Component = () => {
  const [activeTab, setActiveTab] = createSignal<'config' | 'logs'>('logs');
  const [repoFilter, setRepoFilter] = createSignal('');
  // Page tab, view mode, and selected repo live in the URL
  // (?repo=<id|group/name>&tab=<pipelines|trends|history>&view=<overview|detail>)
  // so other surfaces (Stack CI badges, trend cards, palette, shared links) can
  // deep-link here, and same-route navigations re-apply state. Defaults keep a
  // clean URL; a repo param alone implies detail view.
  const [searchParams, setSearchParams] = useSearchParams<{ repo?: string; tab?: string; view?: string }>();
  const pageTab = createMemo<PageTab>(() => (isPageTab(searchParams.tab) ? searchParams.tab : 'pipelines'));
  const setPageTab = (tab: PageTab) => setSearchParams({ tab: tab === 'pipelines' ? undefined : tab });
  const viewMode = createMemo<ViewMode>(() =>
    isViewMode(searchParams.view) ? searchParams.view : searchParams.repo ? 'detail' : 'overview',
  );
  const setViewMode = (view: ViewMode) => setSearchParams({ view });
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);
  const {
    actionNotice,
    autoRefresh,
    dataStateMeta,
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
  } = usePipelineController();

  const filteredRepos = () => {
    return repos().filter(r => r.name.toLowerCase().includes(repoFilter().toLowerCase()));
  };

  // URL → state: resolve ?repo= (numeric GitLab id or group/name path) once the
  // repo list is loaded. Re-runs on same-route navigation with new params.
  createEffect(() => {
    const param = searchParams.repo;
    if (!param) return;
    const match = repos().find((r) => String(r.id) === param || r.name === param);
    if (match && selectedRepo()?.id !== match.id) {
      void selectRepo(match);
    }
  });

  // State → URL: user-driven repo selection writes the canonical (id) form.
  const openRepoDetail = (repo: RepoInfo) => {
    void selectRepo(repo);
    setSearchParams({ repo: String(repo.id), view: 'detail' });
  };

  const closeSidebarOnMobile = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      setMobileSidebarOpen(false);
    }
  };

  const mobileSectionLabel = createMemo(() => {
    if (pageTab() !== 'pipelines') return pageTab().toUpperCase();
    return viewMode() === 'overview' ? 'PIPELINES / OVERVIEW' : 'PIPELINES / DETAIL';
  });

  return (
    <div class="relative flex h-full min-h-0 w-full overflow-hidden">
        {/* Sidebar */}
        <div
          class={`fixed inset-0 z-40 lg:relative lg:inset-auto lg:z-auto ${
            mobileSidebarOpen() ? 'pointer-events-auto' : 'pointer-events-none lg:pointer-events-auto'
          }`}
        >
            <div
              class={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden ${
                mobileSidebarOpen() ? 'opacity-100' : 'opacity-0'
              }`}
              onClick={() => setMobileSidebarOpen(false)}
            />
            <div
              class={`relative z-10 h-full w-72 max-w-[88vw] border-r border-white/10 bg-[rgba(13,22,27,0.94)] flex flex-col shadow-2xl transition-transform duration-300 lg:w-64 lg:max-w-none lg:bg-black/20 lg:shadow-none ${
                mobileSidebarOpen() ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
              }`}
            >
            <div class="p-4 border-b border-white/5 space-y-3">
                <div class="flex items-center justify-between lg:hidden">
                    <div class="text-xs font-bold uppercase tracking-[0.18em] text-text-dim">Pipeline Controls</div>
                    <button
                      type="button"
                      class="h-8 w-8 rounded-md border border-white/10 bg-white/5 text-text-dim"
                      onClick={() => setMobileSidebarOpen(false)}
                    >
                      ✕
                    </button>
                </div>
                {/* Page tabs */}
                <TabBar
                  tabs={[
                    { id: 'pipelines', label: 'Pipelines' },
                    { id: 'trends', label: 'Trends' },
                    { id: 'history', label: 'History' },
                  ] as TabDef<'pipelines' | 'trends' | 'history'>[]}
                  active={pageTab()}
                  onChange={(id) => {
                    setPageTab(id);
                    closeSidebarOnMobile();
                  }}
                  size="sm"
                />

                {/* Show sidebar controls only in Pipelines tab */}
                <Show when={pageTab() === 'pipelines'}>
                    {/* View toggle */}
                    <TabBar
                      tabs={[
                        { id: 'overview', label: 'Overview' },
                        { id: 'detail', label: 'Detail' },
                      ] as TabDef<'overview' | 'detail'>[]}
                      active={viewMode()}
                      onChange={setViewMode}
                      size="sm"
                    />
                    <h2 class="text-xs font-bold uppercase tracking-wider text-text-muted">Repositories</h2>
                    <Input
                        type="text"
                        size="sm"
                        placeholder="Filter..."
                        aria-label="Filter repositories"
                        value={repoFilter()}
                        onInput={(e) => setRepoFilter(e.currentTarget.value)}
                        onClear={() => setRepoFilter('')}
                    />
                </Show>
            </div>

            {/* Repo list only in Pipelines tab */}
            <Show when={pageTab() === 'pipelines'}>
                <div class="flex-1 p-2 flex flex-col gap-1 overflow-y-auto">
                    <Show when={loading()}>
                        <LoadingState variant="inline" size="sm" message="Loading..." />
                    </Show>
                    <For each={filteredRepos()}>
                        {(repo) => (
                            <button
                                class={`text-left px-3 py-2 rounded text-sm font-medium transition-colors group relative ${
                                    selectedRepo()?.path === repo.path
                                        ? 'bg-white/10 text-white'
                                        : 'text-text-dim hover:bg-white/5'
                                }`}
                                onClick={() => {
                                    openRepoDetail(repo);
                                    setSelectedJob(null);
                                    closeSidebarOnMobile();
                                }}
                            >
                                <div class="truncate">{repo.name}</div>
                                <div class="text-[10px] opacity-50 font-mono mt-0.5 flex items-center justify-between">
                                    <span>{repo.type}</span>
                                    <Show when={repo.hasConfig}>
                                        <span class="w-1.5 h-1.5 rounded-full bg-status-ok" title="Config found" />
                                    </Show>
                                </div>
                            </button>
                        )}
                    </For>
                </div>
            </Show>
        </div>
        </div>

        {/* Main Content */}
        <div class="flex-1 min-w-0 overflow-hidden relative bg-[#060c10] flex flex-col">
            <div class="lg:hidden flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5 bg-black/30">
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-text-muted"
                  onClick={() => setMobileSidebarOpen(true)}
                >
                  <span class="text-sm leading-none">☰</span>
                  <span>Sidebar</span>
                </button>
                <div class="truncate text-[10px] font-mono uppercase tracking-widest text-text-dim">
                  {mobileSectionLabel()}
                </div>
            </div>
            {/* Trends Tab */}
            <Show when={pageTab() === 'trends'}>
                <ErrorBoundary fallback={(err) => (
                    <div class="m-4"><ErrorState message={`Failed to load Trends: ${err?.message ?? err}`} /></div>
                )}>
                    <Suspense fallback={<LoadingState variant="inline" size="sm" />}>
                        <PipelineTrends />
                    </Suspense>
                </ErrorBoundary>
            </Show>

            {/* History Tab */}
            <Show when={pageTab() === 'history'}>
                <ErrorBoundary fallback={(err) => (
                    <div class="m-4"><ErrorState message={`Failed to load History: ${err?.message ?? err}`} /></div>
                )}>
                    <Suspense fallback={<LoadingState variant="inline" size="sm" />}>
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
                    onSelectPipeline={(repo) => {
                      openRepoDetail(repo);
                    }}
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
                    <div class="flex flex-col gap-3 px-3 py-3 border-b border-white/5 bg-black/30 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-2">
                        <div class="flex items-center justify-between gap-3 sm:justify-start sm:gap-4">
                            <div class="text-xs font-mono text-text-muted truncate">
                                {selectedRepo()?.name}
                            </div>
                            <span
                                class={`px-2 py-0.5 rounded-full border text-[9px] sm:text-[10px] font-mono uppercase tracking-wider ${dataStateMeta().badgeClass}`}
                            >
                                {dataStateMeta().label}
                            </span>
                            <Show when={isPipelineActive()}>
                                <div class="flex items-center gap-1.5">
                                    <div class="w-1.5 h-1.5 rounded-full bg-white/50 animate-pulse" />
                                    <span class="text-[10px] text-text-muted uppercase tracking-wider">Active</span>
                                </div>
                            </Show>
                        </div>
                        <div class="flex flex-wrap items-center gap-2 sm:justify-end sm:gap-4">
                            {/* Last update time */}
                            <Show when={lastUpdate()}>
                                <div class="text-[9px] sm:text-[10px] text-text-dim font-mono">
                                    Updated: {formatTimeAgo(lastUpdate())}
                                </div>
                            </Show>
                            {/* Auto-refresh toggle */}
                            <button
                                class={`flex items-center gap-2 px-2 py-1 rounded text-[9px] sm:text-[10px] font-mono uppercase tracking-wider transition-all ${
                                    autoRefresh()
                                        ? 'bg-white/10 text-white border border-white/15'
                                        : 'bg-white/5 text-text-muted border border-white/10 hover:bg-white/10'
                                }`}
                                onClick={() => setAutoRefresh(!autoRefresh())}
                            >
                                <div class={`w-1.5 h-1.5 rounded-full transition-colors ${
                                    autoRefresh() ? 'bg-white' : 'bg-text-dim'
                                }`} />
                                Auto-refresh: {autoRefresh() ? 'ON' : 'OFF'}
                            </button>
                            {/* Manual refresh button */}
                            <button
                                class="px-2 py-1 rounded text-[9px] sm:text-[10px] font-mono uppercase tracking-wider bg-white/5 text-text-muted border border-white/10 hover:bg-white/10 transition-all"
                                onClick={() => {
                                    const repo = selectedRepo();
                                    if (repo?.id) {
                                      fetchPipelineStatus(repo.id);
                                      pushActionNotice('info', 'Refreshing pipeline status...');
                                    }
                                }}
                            >
                                ↻ Refresh
                            </button>

                            {/* Pipeline-level actions */}
                            <div class="flex flex-wrap items-center gap-1 sm:ml-2 sm:pl-2 sm:border-l border-white/10">
                                <Show when={isLivePipelineId(pipelineData()?.id)}>
                                  <Show when={pipelineData()?.status === 'failed' || pipelineData()?.status === 'canceled'}>
                                    <button
                                        class="px-2 py-1 rounded text-[9px] sm:text-[10px] font-mono uppercase tracking-wider bg-status-ok/10 text-status-ok border border-status-ok/20 hover:bg-status-ok/20 transition-all disabled:opacity-50"
                                        onClick={handleRetryPipeline}
                                        disabled={pipelineActionLoading()}
                                    >
                                        Retry Pipeline
                                    </button>
                                  </Show>
                                  <Show when={pipelineData()?.status === 'running' || pipelineData()?.status === 'pending'}>
                                    <button
                                        class="px-2 py-1 rounded text-[9px] sm:text-[10px] font-mono uppercase tracking-wider bg-red-400/10 text-red-400 border border-red-400/20 hover:bg-red-400/20 transition-all disabled:opacity-50"
                                        onClick={handleCancelPipeline}
                                        disabled={pipelineActionLoading()}
                                    >
                                        Cancel Pipeline
                                    </button>
                                  </Show>
                                </Show>
                                <div class="flex items-center gap-1">
                                    <Input
                                        type="text"
                                        size="sm"
                                        class="w-20"
                                        aria-label="Pipeline ref"
                                        inputClass="font-mono"
                                        value={triggerRef()}
                                        onInput={(e) => setTriggerRef(e.currentTarget.value)}
                                        placeholder="ref"
                                    />
                                    <button
                                        class="px-2 py-1 rounded text-[9px] sm:text-[10px] font-mono uppercase tracking-wider bg-white/5 text-text-muted border border-white/10 hover:bg-white/10 transition-all disabled:opacity-50"
                                        onClick={handleTriggerPipeline}
                                        disabled={pipelineActionLoading() || !triggerRef()}
                                    >
                                        Trigger
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <Show when={actionNotice()}>
                        <div
                            class="mx-3 mt-2 rounded border px-3 py-2 text-xs font-mono sm:mx-4"
                            classList={{
                                'border-white/15 bg-white/5 text-text-muted': actionNotice()?.type === 'info',
                                'border-status-ok/30 bg-status-ok/10 text-status-ok': actionNotice()?.type === 'success',
                                'border-red-400/30 bg-red-400/10 text-red-300': actionNotice()?.type === 'error',
                            }}
                        >
                            {actionNotice()?.message}
                        </div>
                    </Show>
                    <div class="flex-1 relative p-4">
                        <CIPipelineViz
                            pipeline={pipelineData()}
                            projectId={selectedRepo()?.id}
                            onJobClick={(job) => setSelectedJob(job)}
                            onActionStatus={(notice) => pushActionNotice(notice.type, notice.message)}
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
                      {(job) => (
                        <div class="h-[65vh] sm:h-80 border-t border-white/10 bg-black/60 flex flex-col animate-slide-up">
                            {/* Header */}
                            <div class="flex flex-col gap-3 p-4 border-b border-white/5 sm:flex-row sm:items-center sm:justify-between">
                                <div class="flex min-w-0 items-center gap-3">
                                    <div
                                      class="w-2 h-2 rounded-full"
                                      classList={{ 'animate-pulse': job().status === 'running' }}
                                      style={{ background: getStatusColor(job().status, job().rawStatus) }}
                                    />
                                    <div class="text-base sm:text-lg font-mono font-bold text-white truncate">{job().name}</div>
                                    <span
                                      class="text-[10px] uppercase px-2 py-0.5 rounded border"
                                      style={{
                                        color: getStatusColor(job().status, job().rawStatus),
                                        border: `1px solid ${getStatusColor(job().status, job().rawStatus)}50`,
                                        background: `${getStatusColor(job().status, job().rawStatus)}15`,
                                      }}
                                    >
                                      {getStatusLabel(job().status, job().rawStatus)}
                                    </span>
                                    <span class="text-xs uppercase px-2 py-0.5 rounded bg-white/10 text-text-muted">{job().stage}</span>
                                    <Show when={job().duration}>
                                        <span class="text-xs text-text-dim">
                                            {Math.round(job().duration ?? 0)}s
                                        </span>
                                    </Show>
                                </div>
                                <div class="flex items-center justify-between gap-2 sm:justify-end">
                                    {/* Tabs */}
                                    <TabBar
                                      tabs={[
                                        { id: 'logs', label: 'Logs' },
                                        { id: 'config', label: 'Config' },
                                      ] as TabDef<'config' | 'logs'>[]}
                                      active={activeTab()}
                                      onChange={setActiveTab}
                                      size="sm"
                                    />
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
                                        <LoadingState variant="inline" size="sm" message="Loading job logs..." />
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
                                    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
                                        <Show when={job().details?.script}>
                                            <div class="flex flex-col gap-2">
                                                <div class="text-xs font-bold uppercase text-text-muted tracking-wider">Script</div>
                                                <div class="bg-black/50 rounded p-3 font-mono text-xs text-text-dim border border-white/5">
                                                    <For each={job().details?.script as string[]}>
                                                        {(line: string) => <div class="whitespace-pre-wrap">$ {line}</div>}
                                                    </For>
                                                </div>
                                            </div>
                                        </Show>
                                        
                                        <div class="flex flex-col gap-4">
                                            <Show when={job().details?.image}>
                                                <div>
                                                    <div class="text-xs font-bold uppercase text-text-muted tracking-wider mb-1">Image</div>
                                                    <div class="font-mono text-sm text-white">{String(job().details?.image ?? '')}</div>
                                                </div>
                                            </Show>
                                            
                                            {/* Other properties */}
                                            <div class="flex flex-col gap-2">
                                                <div class="text-xs font-bold uppercase text-text-muted tracking-wider">Configuration</div>
                                                <div class="grid grid-cols-2 gap-2 text-xs font-mono">
                                                    <For each={Object.entries(job().details || {}).filter(([k]) => !['script', 'before_script', 'after_script', 'image', 'name', 'stage'].includes(k))}>
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
                      )}
                    </Show>
                </Show>
            </Show>
            </Show>
        </div>
    </div>
  );
};

export default Pipeline;
