import { Component, For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js';
import { A, useSearchParams } from '@solidjs/router';
import { workspaceApi, type WorkspaceInventory, type WorkspaceRepository } from '../../lib/api';
import { createPersistedSignal, oneOf } from '../../hooks/createPersistedSignal';
import { Badge, Button, EmptyState, ErrorState, Input, LoadingState, PageHeader, Select, TabBar } from '../shared';
import type { SelectOption, TabDef } from '../shared';
import {
  STACK_SORT_OPTIONS,
  compareRepositories,
  contractDriftLabel,
  formatBucketLabel,
  getDocsCount,
  getRepoReadiness,
  getRepositoryLanguage,
  hasManifest,
  isDegradedBinding,
  isInferredBinding,
  isVerifiedBinding,
  libAdoptionLabel,
  matchesAdoptionFilter,
  matchesBindingFilter,
  matchesContractFilter,
  repositoryMatches,
  summarizeAdoption,
  summarizeBinding,
  remoteWebUrl,
  summarizeContractDrift,
  summarizeRemote,
  type StackAdoptionFilter,
  type StackBindingFilter,
  type StackBucketFilter,
  type StackContractFilter,
  type StackReadinessFilter,
  type StackSortKey,
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
  // Deep-link support (?q=repo-name): the palette can land here with the
  // search pre-applied. URL → state only; typing afterwards doesn't churn the
  // URL, but a same-route navigation (palette, lib chips) re-applies the param.
  const [searchParams] = useSearchParams<{ q?: string }>();
  const [query, setQuery] = createSignal(searchParams.q ?? '');
  createEffect(() => setQuery(searchParams.q ?? ''));
  const [bucketFilter, setBucketFilter] = createSignal<StackBucketFilter>('all');
  const [readinessFilter, setReadinessFilter] = createSignal<StackReadinessFilter>('all');
  const [bindingFilter, setBindingFilter] = createSignal<StackBindingFilter>('all');
  const [adoptionFilter, setAdoptionFilter] = createSignal<StackAdoptionFilter>('all');
  const [contractFilter, setContractFilter] = createSignal<StackContractFilter>('all');
  // Sort order is a view preference — it survives reloads.
  const [sortKey, setSortKey] = createPersistedSignal<StackSortKey>(
    'stack.sort',
    'concern',
    oneOf(['concern', 'name', 'language', 'adoption', 'dirty']),
  );
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

    const verified = repos.filter(isVerifiedBinding).length;
    const degraded = repos.filter(isDegradedBinding).length;
    const inferred = repos.filter(isInferredBinding).length;

    const adoption = summarizeAdoption(repos);
    const contracts = summarizeContractDrift(repos);

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
      verified,
      degraded,
      inferred,
      libsAdopted: adoption.adopted,
      libsUnadopted: adoption.unadopted,
      libCoverage: adoption.coveragePct,
      unadoptedNames: adoption.unadoptedNames,
      contractChecked: contracts.checked,
      contractDrifts: contracts.drifted,
      contractUnknown: contracts.unknown,
      contractDriftedRepos: contracts.driftedRepos,
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

  const bindingTabs = createMemo((): TabDef<StackBindingFilter>[] => [
    { id: 'all', label: 'Any cluster', count: summary().total },
    { id: 'verified', label: 'Verified', count: summary().verified },
    { id: 'degraded', label: 'Degraded', count: summary().degraded },
    { id: 'inferred', label: 'Inferred', count: summary().inferred },
  ]);

  const adoptionTabs = createMemo((): TabDef<StackAdoptionFilter>[] => [
    { id: 'all', label: 'Any', count: summary().libs },
    { id: 'adopted', label: 'Adopted', count: summary().libsAdopted },
    { id: 'unadopted', label: 'No adopters', count: summary().libsUnadopted },
  ]);

  const contractTabs = createMemo((): TabDef<StackContractFilter>[] => [
    { id: 'all', label: 'Any', count: summary().total },
    { id: 'drift', label: 'Drift', count: summary().contractDriftedRepos },
    { id: 'unknown', label: 'Unknown', count: summary().contractUnknown },
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
    const selectedBinding = bindingFilter();
    const selectedAdoption = adoptionFilter();
    const selectedContract = contractFilter();
    const selectedLanguage = languageFilter();
    const search = query();

    return repositories()
      .filter((repo) => selectedBucket === 'all' || repo.bucket === selectedBucket)
      .filter((repo) => selectedLanguage === 'all' || getRepositoryLanguage(repo) === selectedLanguage)
      .filter((repo) => selectedReadiness === 'all' || getRepoReadiness(repo).level === selectedReadiness)
      .filter((repo) => matchesBindingFilter(repo, selectedBinding))
      .filter((repo) => matchesAdoptionFilter(repo, selectedAdoption))
      .filter((repo) => matchesContractFilter(repo, selectedContract))
      .filter((repo) => repositoryMatches(repo, search))
      .sort((left, right) => compareRepositories(left, right, sortKey()));
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
    query().trim() !== '' ||
    bucketFilter() !== 'all' ||
    readinessFilter() !== 'all' ||
    bindingFilter() !== 'all' ||
    adoptionFilter() !== 'all' ||
    contractFilter() !== 'all' ||
    languageFilter() !== 'all',
  );

  const resetFilters = () => {
    setQuery('');
    setBucketFilter('all');
    setReadinessFilter('all');
    setBindingFilter('all');
    setAdoptionFilter('all');
    setContractFilter('all');
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
            refreshing={refreshing() || loading()}
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

            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <SummaryTile
                label="Repositories"
                value={summary().total}
                sub={`${summary().services} services / ${summary().libs} libs`}
                tone="info"
              />
              <SummaryTile label="Ready" value={summary().ready} sub={`${summary().review} need review`} tone="ok" />
              <SummaryTile
                label="Cluster bound"
                value={summary().verified}
                sub={summary().degraded > 0 ? `${summary().degraded} degraded` : 'verified via Flux'}
                tone={summary().degraded > 0 ? 'warn' : 'ok'}
              />
              <SummaryTile label="Dirty" value={summary().dirty} sub={`${summary().worktrees} with worktrees`} tone={summary().dirty > 0 ? 'warn' : 'default'} />
              <SummaryTile
                label="Lib coverage"
                value={`${summary().libCoverage}%`}
                sub={summary().libsUnadopted > 0 ? `${summary().libsUnadopted} with no adopters` : 'all libs adopted'}
                tone={summary().libsUnadopted > 0 ? 'warn' : 'ok'}
              />
              <SummaryTile
                label="Version drift"
                value={summary().contractDrifts}
                sub={`${summary().contractChecked} contracts checked`}
                tone={summary().contractDrifts > 0 ? 'warn' : summary().contractChecked > 0 ? 'ok' : 'default'}
              />
              <SummaryTile label="CI manifests" value={summary().ci} sub="metadata only" />
              <SummaryTile label="Docs coverage" value={`${summary().docsCoverage}%`} sub="AGENTS/README/ROADMAP/LOOM" />
            </div>

            <div class="surface p-3">
              <div class="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_auto_auto_minmax(180px,220px)_minmax(150px,190px)_auto] xl:items-center">
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
                <Select
                  value={sortKey()}
                  options={STACK_SORT_OPTIONS}
                  aria-label="Sort repositories"
                  onChange={(event) => setSortKey(event.currentTarget.value as StackSortKey)}
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
              <div class="mt-3 flex flex-wrap items-center gap-4">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="heading-label">Cluster</span>
                  <TabBar tabs={bindingTabs()} active={bindingFilter()} onChange={setBindingFilter} />
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="heading-label">Adoption</span>
                  <TabBar tabs={adoptionTabs()} active={adoptionFilter()} onChange={setAdoptionFilter} />
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="heading-label">Contracts</span>
                  <TabBar tabs={contractTabs()} active={contractFilter()} onChange={setContractFilter} />
                </div>
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
  const remoteHref = createMemo(() => remoteWebUrl(props.repo));
  const binding = createMemo(() => summarizeBinding(props.repo));
  const dependsOn = createMemo(() => props.repo.dependsOn ?? []);
  const libraryContracts = createMemo(() => props.repo.libraryContracts ?? []);
  const isLib = createMemo(() => props.repo.bucket === 'libs');
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
          {/* Deep link into the Pipeline page; ?repo= accepts the GitLab
              group/name path (binding when verified, bucket/name otherwise). */}
          <A
            href={`/pipeline?repo=${encodeURIComponent(
              props.repo.binding?.gitlabProject ?? `${props.repo.bucket}/${props.repo.name}`,
            )}&view=detail`}
            title={`Open CI pipeline detail for ${props.repo.name}`}
          >
            <Badge tone="ok">CI</Badge>
          </A>
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
            <Show
              when={remoteHref()}
              fallback={<span class="truncate font-mono text-text-muted" title={remote()}>{remote()}</span>}
            >
              <a
                href={remoteHref()}
                target="_blank"
                rel="noopener noreferrer"
                class="truncate font-mono text-text-muted underline decoration-white/20 underline-offset-2 hover:text-text-main hover:decoration-white/40"
                title={`${remote()} — open in browser`}
              >
                {remote()}
              </a>
            </Show>
          </div>
        </Show>
        <Show when={binding()}>
          {(summary) => (
            <div class="flex min-w-0 items-center gap-2">
              <span class="heading-label min-w-[58px]">Cluster</span>
              <span class="truncate font-mono text-text-muted" title={`${summary().label} (${summary().detail})`}>
                {summary().label}
              </span>
              <Show when={summary().confidence !== 'none'}>
                <span
                  class={`flex-shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                    summary().verified
                      ? 'border-status-ok/20 bg-status-ok/10 text-status-ok'
                      : 'border-white/10 bg-white/5 text-text-dim/70'
                  }`}
                  title={summary().detail}
                >
                  {summary().confidence}
                </span>
              </Show>
              <Show when={summary().workload}>
                <span
                  class={`flex-shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                    summary().workloadStatus === 'degraded'
                      ? 'border-status-error/20 bg-status-error/10 text-status-error'
                      : summary().workloadStatus === 'progressing'
                        ? 'border-status-warn/20 bg-status-warn/10 text-status-warn'
                        : 'border-status-ok/20 bg-status-ok/10 text-status-ok'
                  }`}
                  title={`Live workloads${summary().workloadKinds ? ` — ${summary().workloadKinds}` : ''} · ${summary().workloadStatus ?? 'ready'} (ready/desired)${summary().workloadReason ? ` · ${summary().workloadReason}` : ''}`}
                >
                  {summary().workload}
                </span>
              </Show>
            </div>
          )}
        </Show>
        <div class="flex min-w-0 items-center gap-2">
          <span class="heading-label min-w-[58px]">Manifests</span>
          <span class="truncate text-text-muted" title={manifestLabels().join(', ') || 'None'}>
            {manifestLabels().length > 0 ? manifestLabels().join(', ') : 'None'}
          </span>
        </div>
        <Show when={dependsOn().length > 0}>
          <div class="flex min-w-0 items-center gap-2">
            <span class="heading-label min-w-[58px]">Uses libs</span>
            <span class="flex min-w-0 flex-wrap items-center gap-1">
              <For each={dependsOn()}>
                {(lib) => (
                  <A
                    href={`/stack?q=${encodeURIComponent(lib)}`}
                    class="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted hover:bg-white/10 hover:text-text-main"
                    title={`Filter stack to ${lib}`}
                  >
                    {lib}
                  </A>
                )}
              </For>
            </span>
          </div>
        </Show>
        <Show when={libraryContracts().length > 0}>
          <div class="flex min-w-0 items-start gap-2">
            <span class="heading-label mt-1 min-w-[58px]">Contracts</span>
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <For each={libraryContracts().slice(0, 3)}>
                {(contract) => (
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class={`flex-shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                        contract.status === 'drift'
                          ? 'border-status-warn/30 bg-status-warn/10 text-status-warn'
                          : contract.status === 'aligned'
                            ? 'border-status-ok/20 bg-status-ok/10 text-status-ok'
                            : 'border-white/10 bg-white/5 text-text-dim/70'
                      }`}
                    >
                      {contract.status}
                    </span>
                    <span class="truncate font-mono text-text-muted" title={`${contractDriftLabel(contract)} (${contract.manifest})`}>
                      {contractDriftLabel(contract)}
                    </span>
                  </div>
                )}
              </For>
              <Show when={libraryContracts().length > 3}>
                <span class="text-text-dim/70">+{libraryContracts().length - 3} more</span>
              </Show>
            </div>
          </div>
        </Show>
        <Show when={isLib()}>
          <div class="flex min-w-0 items-center gap-2">
            <span class="heading-label min-w-[58px]">Adoption</span>
            <span
              class={`truncate ${
                (props.repo.usedBy?.length ?? 0) + (props.repo.usedByLibs?.length ?? 0) > 0
                  ? 'text-text-muted'
                  : 'text-text-dim/60'
              }`}
              title={libAdoptionLabel(props.repo)}
            >
              {libAdoptionLabel(props.repo)}
            </span>
          </div>
        </Show>
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
