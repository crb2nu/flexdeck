import { Component, For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { workspaceApi, type WorkspaceInventory, type WorkspaceRepository } from '../../lib/api';
import { Badge, Button, EmptyState, ErrorState, Input, LoadingState, PageHeader, Select, TabBar } from '../shared';
import type { SelectOption, TabDef } from '../shared';
import {
  formatBucketLabel,
  getDocsCount,
  getRepoReadiness,
  getRepositoryLanguage,
  hasManifest,
  repositoryMatches,
  summarizeRemote,
  type StackBucketFilter,
  type StackReadinessFilter,
} from './stackUtils';

interface StackSection {
  bucket: string;
  label: string;
  repositories: WorkspaceRepository[];
}

interface SummaryTileProps {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'info' | 'ok' | 'warn' | 'default';
}

const TONE_CLASSES: Record<NonNullable<SummaryTileProps['tone']>, string> = {
  default: 'border-white/10 bg-white/[0.03]',
  info: 'border-status-ok/20 bg-status-ok/[0.04]',
  ok: 'border-status-ok/20 bg-status-ok/[0.05]',
  warn: 'border-status-warn/20 bg-status-warn/[0.05]',
};

const SummaryTile: Component<SummaryTileProps> = (props) => {
  const tone = () => props.tone ?? 'default';

  return (
    <div class={`rounded-md border px-3 py-3 ${TONE_CLASSES[tone()]}`}>
      <div class="heading-label">{props.label}</div>
      <div class="mt-1 text-2xl font-semibold text-white tabular-nums">{props.value}</div>
      <Show when={props.sub}>
        <div class="mt-1 truncate text-xs text-text-dim">{props.sub}</div>
      </Show>
    </div>
  );
};

const Stack: Component = () => {
  const [inventory, setInventory] = createSignal<WorkspaceInventory | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [refreshing, setRefreshing] = createSignal(false);
  const [error, setError] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [bucketFilter, setBucketFilter] = createSignal<StackBucketFilter>('all');
  const [readinessFilter, setReadinessFilter] = createSignal<StackReadinessFilter>('all');
  const [languageFilter, setLanguageFilter] = createSignal('all');

  const loadInventory = async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      setInventory(await workspaceApi.getRepos());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load workspace inventory');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  onMount(() => {
    void loadInventory();
  });

  const repositories = createMemo(() => inventory()?.repositories ?? []);
  const lastUpdated = createMemo(() => {
    const generatedAt = inventory()?.generatedAt;
    if (!generatedAt) return null;
    return new Date(generatedAt);
  });

  const summary = createMemo(() => {
    const repos = repositories();
    const total = inventory()?.totals.repositories ?? repos.length;
    const ready = repos.filter((repo) => getRepoReadiness(repo).level === 'ready').length;
    const dirty = repos.filter((repo) => repo.git.isRepository && !repo.git.clean).length;
    const worktrees = repos.filter((repo) => (repo.worktreeCount ?? 0) > 0).length;
    const ci = repos.filter((repo) => hasManifest(repo, 'gitlab-ci') || hasManifest(repo, '.gitlab-ci.yml')).length;
    const docsSlots = total * 4;
    const docsCoverage = docsSlots > 0
      ? Math.round((repos.reduce((sum, repo) => sum + getDocsCount(repo), 0) / docsSlots) * 100)
      : 0;

    return {
      total,
      services: inventory()?.totals.services ?? repos.filter((repo) => repo.bucket === 'services').length,
      libs: inventory()?.totals.libs ?? repos.filter((repo) => repo.bucket === 'libs').length,
      ready,
      review: Math.max(0, total - ready),
      dirty,
      worktrees,
      ci,
      docsCoverage,
    };
  });

  const bucketTabs = createMemo((): TabDef<StackBucketFilter>[] => [
    { id: 'all', label: 'All', count: summary().total },
    { id: 'services', label: 'Services', count: summary().services },
    { id: 'libs', label: 'Libs', count: summary().libs },
  ]);

  const readinessTabs = createMemo((): TabDef<StackReadinessFilter>[] => [
    { id: 'all', label: 'All states', count: summary().total },
    { id: 'ready', label: 'Ready', count: summary().ready },
    { id: 'attention', label: 'Review', count: summary().review },
  ]);

  const languageOptions = createMemo<SelectOption[]>(() => {
    const counts = new Map<string, number>();
    for (const repo of repositories()) {
      const language = getRepositoryLanguage(repo);
      counts.set(language, (counts.get(language) ?? 0) + 1);
    }

    return [
      { value: 'all', label: 'All languages' },
      ...Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([language, count]) => ({
          value: language,
          label: `${language} (${count})`,
        })),
    ];
  });

  const topLanguages = createMemo(() => {
    const counts = inventory()?.totals.byLanguage ?? {};
    return Object.entries(counts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5);
  });

  const filteredRepositories = createMemo(() => {
    const selectedBucket = bucketFilter();
    const selectedReadiness = readinessFilter();
    const selectedLanguage = languageFilter();
    const search = query();

    return repositories()
      .filter((repo) => selectedBucket === 'all' || repo.bucket === selectedBucket)
      .filter((repo) => selectedLanguage === 'all' || getRepositoryLanguage(repo) === selectedLanguage)
      .filter((repo) => selectedReadiness === 'all' || getRepoReadiness(repo).level === selectedReadiness)
      .filter((repo) => repositoryMatches(repo, search))
      .sort((left, right) => {
        const readinessDelta = getRepoReadiness(right).score - getRepoReadiness(left).score;
        if (readinessDelta !== 0) return readinessDelta;
        if (left.bucket !== right.bucket) return left.bucket.localeCompare(right.bucket);
        return left.name.localeCompare(right.name);
      });
  });

  const sections = createMemo<StackSection[]>(() => {
    const grouped = new Map<string, WorkspaceRepository[]>();
    for (const repo of filteredRepositories()) {
      grouped.set(repo.bucket, [...(grouped.get(repo.bucket) ?? []), repo]);
    }

    const order = bucketFilter() === 'all' ? ['services', 'libs'] : [bucketFilter()];
    const orderedSections = order
      .map((bucket) => ({
        bucket,
        label: formatBucketLabel(bucket),
        repositories: grouped.get(bucket) ?? [],
      }))
      .filter((section) => section.repositories.length > 0);

    const extraSections = Array.from(grouped.entries())
      .filter(([bucket]) => !order.includes(bucket as StackBucketFilter))
      .map(([bucket, repos]) => ({
        bucket,
        label: formatBucketLabel(bucket),
        repositories: repos,
      }));

    return [...orderedSections, ...extraSections];
  });

  const hasActiveFilters = createMemo(() =>
    query().trim() !== '' || bucketFilter() !== 'all' || readinessFilter() !== 'all' || languageFilter() !== 'all',
  );

  const resetFilters = () => {
    setQuery('');
    setBucketFilter('all');
    setReadinessFilter('all');
    setLanguageFilter('all');
  };

  const showBlockingLoading = createMemo(() => loading() && !inventory());
  const showBlockingError = createMemo(() => !!error() && !inventory() && !loading());
  // The Stack Explorer needs a workspace on disk (WORKSPACE_DIR). When the
  // server has none mounted (e.g. the prod pod), treat it as a feature that
  // isn't available here rather than a transient error to retry.
  const workspaceUnavailable = createMemo(() =>
    /workspace root (unavailable|is not configured|is not a directory)|no such file or directory/i.test(error() || ''),
  );

  return (
    <div class="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div class="flex-1 overflow-y-auto p-4 sm:p-6">
        <div class="mx-auto flex max-w-7xl flex-col gap-4">
          <PageHeader
            title="Stack"
            accent=" Explorer"
            subtitle="Local services and libraries from the workspace inventory"
            lastUpdated={lastUpdated()}
            onRefresh={() => void loadInventory(true)}
            refreshDisabled={refreshing() || loading()}
          >
            <Badge tone={workspaceUnavailable() ? 'default' : error() ? 'warn' : 'info'}>
              {workspaceUnavailable() ? 'Unavailable here' : error() ? 'Stale data' : 'Read-only'}
            </Badge>
          </PageHeader>

          <Show when={showBlockingLoading()}>
            <LoadingState message="Loading workspace inventory..." />
          </Show>

          <Show when={showBlockingError()}>
            <Show
              when={workspaceUnavailable()}
              fallback={<ErrorState message={error()} variant="full" onRetry={() => void loadInventory()} />}
            >
              <EmptyState
                icon="🗂"
                title="Workspace inventory isn't available here"
                subtitle="This deployment has no workspace mounted, so there are no local services or libraries to scan. Point WORKSPACE_DIR at a mounted workspace to enable the Stack Explorer."
                action={{ label: 'Try again', onClick: () => void loadInventory() }}
              />
            </Show>
          </Show>

          <Show when={!showBlockingLoading() && !showBlockingError()}>
            <Show when={error()}>
              <div class="surface border-status-warn/30 bg-status-warn/5 px-4 py-3 text-sm text-status-warn">
                Workspace refresh delayed. Showing the last successful inventory.
              </div>
            </Show>

            <Show when={(inventory()?.errors?.length ?? 0) > 0}>
              <div class="surface border-status-warn/30 bg-status-warn/5 px-4 py-3 text-sm text-status-warn">
                Some workspace buckets reported scan warnings: {inventory()?.errors?.join('; ')}
              </div>
            </Show>

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <SummaryTile
                label="Repositories"
                value={summary().total}
                sub={`${summary().services} services / ${summary().libs} libs`}
                tone="info"
              />
              <SummaryTile label="Ready" value={summary().ready} sub={`${summary().review} need review`} tone="ok" />
              <SummaryTile label="Dirty" value={summary().dirty} sub={`${summary().worktrees} with worktrees`} tone={summary().dirty > 0 ? 'warn' : 'default'} />
              <SummaryTile label="CI manifests" value={summary().ci} sub="metadata only" />
              <SummaryTile label="Docs coverage" value={`${summary().docsCoverage}%`} sub="AGENTS/README/ROADMAP/LOOM" />
            </div>

            <div class="surface p-3">
              <div class="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_auto_auto_minmax(180px,220px)_auto] xl:items-center">
                <Input
                  value={query()}
                  onInput={(event) => setQuery(event.currentTarget.value)}
                  onClear={() => setQuery('')}
                  placeholder="Search repos, branches, remotes, manifests..."
                  aria-label="Search stack repositories"
                />
                <TabBar tabs={bucketTabs()} active={bucketFilter()} onChange={setBucketFilter} />
                <TabBar tabs={readinessTabs()} active={readinessFilter()} onChange={setReadinessFilter} />
                <Select
                  value={languageFilter()}
                  options={languageOptions()}
                  aria-label="Filter by language"
                  onChange={(event) => setLanguageFilter(event.currentTarget.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!hasActiveFilters()}
                  onClick={resetFilters}
                  class="justify-self-start xl:justify-self-end"
                >
                  Reset
                </Button>
              </div>
              <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-dim">
                <span class="font-mono text-text-muted">{inventory()?.root ?? 'WORKSPACE_DIR'}</span>
                <Show when={topLanguages().length > 0}>
                  <span class="text-text-dim/50">Top languages:</span>
                  <For each={topLanguages()}>
                    {([language, count]) => (
                      <span class="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-text-muted">
                        {language} {count}
                      </span>
                    )}
                  </For>
                </Show>
              </div>
            </div>

            <Show
              when={sections().length > 0}
              fallback={
                <EmptyState
                  title={hasActiveFilters() ? 'No repositories match these filters' : 'No repositories discovered'}
                  subtitle={hasActiveFilters() ? 'Clear filters or try another search term.' : 'Configure WORKSPACE_DIR with services and libs buckets.'}
                  action={hasActiveFilters() ? { label: 'Clear filters', onClick: resetFilters } : undefined}
                />
              }
            >
              <div class="flex flex-col gap-6">
                <For each={sections()}>
                  {(section) => (
                    <section class="flex flex-col gap-3" aria-labelledby={`stack-section-${section.bucket}`}>
                      <div class="flex items-center justify-between gap-3">
                        <div>
                          <h2 id={`stack-section-${section.bucket}`} class="heading-section">
                            {section.label}
                          </h2>
                          <p class="text-xs text-text-dim">{section.repositories.length} matching repositories</p>
                        </div>
                      </div>
                      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                        <For each={section.repositories}>
                          {(repo) => <RepoCard repo={repo} />}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
};

const RepoCard: Component<{ repo: WorkspaceRepository }> = (props) => {
  const readiness = createMemo(() => getRepoReadiness(props.repo));
  const language = createMemo(() => getRepositoryLanguage(props.repo));
  const remote = createMemo(() => summarizeRemote(props.repo));
  const manifestLabels = createMemo(() => (props.repo.manifests ?? []).map((manifest) => manifest.path));
  const packageManagers = createMemo(() => props.repo.packageManagers ?? []);
  const docFlags = createMemo(() => [
    { label: 'AGENTS', active: props.repo.docs.agents },
    { label: 'README', active: props.repo.docs.readme },
    { label: 'ROADMAP', active: props.repo.docs.roadmap },
    { label: 'LOOM', active: props.repo.docs.loom },
  ]);

  return (
    <article
      data-testid={`stack-repo-${props.repo.bucket}-${props.repo.name}`}
      class="surface-hover min-w-0 overflow-hidden p-4"
    >
      <div class="flex min-w-0 items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex min-w-0 items-center gap-2">
            <h3 class="truncate text-base font-semibold text-white">{props.repo.name}</h3>
            <span
              class={`h-2 w-2 flex-shrink-0 rounded-full ${
                readiness().level === 'ready' ? 'bg-status-ok' : 'bg-status-warn'
              }`}
              aria-hidden="true"
            />
          </div>
          <p class="mt-1 truncate font-mono text-[10px] text-text-dim" title={props.repo.path}>
            {props.repo.path}
          </p>
        </div>
        <Badge tone={readiness().level === 'ready' ? 'ok' : 'warn'}>{readiness().label}</Badge>
      </div>

      <div class="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={props.repo.bucket === 'services' ? 'info' : 'default'}>{formatBucketLabel(props.repo.bucket)}</Badge>
        <Badge tone={language() === 'unknown' ? 'default' : 'info'}>{language()}</Badge>
        <Show when={props.repo.git.branch}>
          <Badge tone={props.repo.git.clean ? 'ok' : 'warn'}>{props.repo.git.branch}</Badge>
        </Show>
        <Show when={(props.repo.worktreeCount ?? 0) > 0}>
          <Badge tone="warn">
            {props.repo.worktreeCount} {props.repo.worktreeCount === 1 ? 'worktree' : 'worktrees'}
          </Badge>
        </Show>
        <Show when={hasManifest(props.repo, 'gitlab-ci')}>
          <Badge tone="ok">CI</Badge>
        </Show>
      </div>

      <div class="mt-4 grid gap-3 text-xs text-text-dim sm:grid-cols-2">
        <div>
          <div class="heading-label mb-1">Package</div>
          <Show
            when={packageManagers().length > 0}
            fallback={<span class="text-text-muted">No package manager detected</span>}
          >
            <div class="flex flex-wrap gap-1">
              <For each={packageManagers().slice(0, 4)}>
                {(manager) => (
                  <span class="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                    {manager}
                  </span>
                )}
              </For>
            </div>
          </Show>
        </div>
        <div>
          <div class="heading-label mb-1">Docs</div>
          <div class="flex flex-wrap gap-1">
            <For each={docFlags()}>
              {(doc) => (
                <span
                  class={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                    doc.active
                      ? 'border-status-ok/20 bg-status-ok/10 text-status-ok'
                      : 'border-white/10 bg-white/5 text-text-dim/60'
                  }`}
                >
                  {doc.label}
                </span>
              )}
            </For>
          </div>
        </div>
      </div>

      <div class="mt-4 space-y-2 border-t border-white/5 pt-3 text-xs text-text-dim">
        <Show when={remote()}>
          <div class="flex min-w-0 items-center gap-2">
            <span class="heading-label min-w-[58px]">Remote</span>
            <span class="truncate font-mono text-text-muted" title={remote()}>{remote()}</span>
          </div>
        </Show>
        <div class="flex min-w-0 items-center gap-2">
          <span class="heading-label min-w-[58px]">Manifests</span>
          <span class="truncate text-text-muted" title={manifestLabels().join(', ') || 'None'}>
            {manifestLabels().length > 0 ? manifestLabels().join(', ') : 'None'}
          </span>
        </div>
        <Show
          when={readiness().reasons.length > 0}
          fallback={<div class="text-text-muted">No local review flags from scanner metadata.</div>}
        >
          <div class="text-status-warn">
            {readiness().reasons.join(', ')}
          </div>
        </Show>
      </div>
    </article>
  );
};

export default Stack;
