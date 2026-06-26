import { Component, For, Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import {
  projectsApi,
  type ProjectDetail,
  type ProjectSummary,
} from '../../lib/api/projects';
import {
  projectsListFixture,
  projectDetailFixtures,
} from './projects.fixture';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../shared';
import PageScrollBody from '../shared/PageScrollBody';
import { createPolling } from '../../hooks/createPolling';
import { stableListByKey } from '../../lib/stableList';
import {
  decisionSignature,
  killTestSummary,
  planPhaseTone,
  planSignature,
  issueSignature,
  milestoneSignature,
  priorityTone,
  projectNamespace,
  projectShortName,
  riskLevelTone,
  riskSignature,
  riskStatusTone,
  summaryConcern,
  summarySignature,
  taskSignature,
  taskStatusTone,
} from './projectsUtils';

const POLL_INTERVAL_MS = 15_000;

// When the backend slice is not yet deployed the live calls 404. In dev we
// fall back to the frozen-contract fixtures so the page is renderable; in prod
// the error surfaces normally.
const USE_MOCK = import.meta.env.DEV && import.meta.env.VITE_PROJECTS_MOCK !== '0';

async function fetchList(): Promise<ProjectSummary[]> {
  if (USE_MOCK) {
    try {
      return (await projectsApi.list()).projects;
    } catch {
      return projectsListFixture.projects;
    }
  }
  return (await projectsApi.list()).projects;
}

async function fetchDetail(id: string): Promise<ProjectDetail> {
  if (USE_MOCK) {
    try {
      return await projectsApi.get(id);
    } catch {
      return (
        projectDetailFixtures[id] ?? {
          project: id,
          partial: true,
          tasks: [],
          issues: [],
          milestones: [],
          risks: [],
          decisions: [],
          plans: [],
        }
      );
    }
  }
  return projectsApi.get(id);
}

const SectionShell: Component<{
  title: string;
  count: number;
  children: any;
  empty: string;
}> = (props) => (
  <section class="surface flex flex-col gap-3 p-4">
    <div class="flex items-center justify-between">
      <h2 class="heading-section">{props.title}</h2>
      <span class="font-mono text-xs text-text-dim tabular-nums">{props.count}</span>
    </div>
    <Show
      when={props.count > 0}
      fallback={<p class="py-3 text-center text-xs text-text-dim/70">{props.empty}</p>}
    >
      {props.children}
    </Show>
  </section>
);

const Projects: Component = () => {
  // Picker (left). Snapshot store reconciled each poll so rows don't churn.
  const [summaries, setSummaries] = createStore<{ items: ProjectSummary[] }>({ items: [] });
  const [listLoading, setListLoading] = createSignal(true);
  const [listError, setListError] = createSignal('');
  const [lastUpdated, setLastUpdated] = createSignal<number | null>(null);

  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  // Detail (right) for the selected project.
  const [detail, setDetail] = createStore<{ value: ProjectDetail | null }>({ value: null });
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal('');

  const stableSummaries = stableListByKey(
    () => summaries.items,
    (s) => s.project,
    summarySignature,
  );

  const loadList = async () => {
    try {
      const items = await fetchList();
      items.sort((a, b) => summaryConcern(b) - summaryConcern(a) || a.project.localeCompare(b.project));
      // reconcile keyed on project so identical rows keep their identity.
      setSummaries('items', reconcile(items, { key: 'project', merge: true }));
      setListError('');
      setLastUpdated(Date.now());
      if (!selectedId() && items.length > 0) {
        setSelectedId(items[0].project);
      }
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setListLoading(false);
    }
  };

  const loadDetail = async (id: string, silent = false) => {
    if (!silent) setDetailLoading(true);
    try {
      const value = await fetchDetail(id);
      setDetail('value', value);
      setDetailError('');
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Failed to load project detail');
    } finally {
      setDetailLoading(false);
    }
  };

  createPolling('projects-list', loadList, POLL_INTERVAL_MS);

  // Detail polling is scoped to the selected project; the id-keyed task id keeps
  // the scheduler from stacking duplicate timers when the selection changes.
  createPolling(
    () => `projects-detail:${selectedId() ?? 'none'}`,
    () => {
      const id = selectedId();
      if (id) return loadDetail(id, true);
    },
    POLL_INTERVAL_MS,
    () => selectedId() !== null,
  );

  // Immediate (non-silent) fetch on selection change so the lanes show a loader
  // instead of stale data from the previous project.
  createEffect(
    on(selectedId, (id) => {
      if (id) {
        setDetail('value', null);
        loadDetail(id, false);
      }
    }, { defer: true }),
  );

  const detailValue = createMemo(() => detail.value);
  const stableTasks = stableListByKey(() => detailValue()?.tasks ?? [], (t) => t.id, taskSignature);
  const stableIssues = stableListByKey(() => detailValue()?.issues ?? [], (i) => String(i.iid), issueSignature);
  const stableMilestones = stableListByKey(() => detailValue()?.milestones ?? [], (m) => m.id, milestoneSignature);
  const stableRisks = stableListByKey(() => detailValue()?.risks ?? [], (r) => r.id, riskSignature);
  const stableDecisions = stableListByKey(() => detailValue()?.decisions ?? [], (d) => d.id, decisionSignature);
  const stablePlans = stableListByKey(() => detailValue()?.plans ?? [], (p) => p.id, planSignature);

  return (
    <PageScrollBody>
      <div class="flex flex-col gap-4">
        <PageHeader
          title="Projects"
          subtitle="Unified tasks, issues, milestones, risks, decisions, and plans across the workspace"
          lastUpdated={lastUpdated()}
          onRefresh={() => {
            loadList();
            const id = selectedId();
            if (id) loadDetail(id, false);
          }}
        />

        <Show when={listError()}>
          <ErrorState message={listError()} variant="banner" onRetry={loadList} />
        </Show>

        <Show
          when={!listLoading()}
          fallback={<LoadingState message="Loading projects…" />}
        >
          <Show
            when={stableSummaries().length > 0}
            fallback={
              <EmptyState
                icon="📋"
                title="No projects yet"
                subtitle="Projects appear here once agent tasks, issues, risks, or plans are tracked."
              />
            }
          >
            <div class="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
              {/* Left: project picker */}
              <aside class="surface flex flex-col gap-1.5 p-2" aria-label="Project picker">
                <For each={stableSummaries()}>
                  {(summary) => {
                    const active = () => selectedId() === summary.project;
                    return (
                      <button
                        type="button"
                        onClick={() => setSelectedId(summary.project)}
                        aria-current={active() ? 'true' : undefined}
                        class={`group flex flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors duration-150 ${
                          active()
                            ? 'border-status-ok/40 bg-status-ok/[0.06]'
                            : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'
                        }`}
                      >
                        <div class="flex items-baseline justify-between gap-2">
                          <span class="truncate text-sm font-medium text-text-main">
                            {projectShortName(summary.project)}
                          </span>
                          <Show when={projectNamespace(summary.project)}>
                            <span class="truncate font-mono text-[10px] text-text-dim/70">
                              {projectNamespace(summary.project)}
                            </span>
                          </Show>
                        </div>
                        <div class="flex flex-wrap gap-1">
                          <RollupChip label="tasks" value={summary.open_tasks} tone="info" />
                          <RollupChip label="issues" value={summary.open_issues} tone="info" />
                          <RollupChip label="at-risk" value={summary.milestones_at_risk} tone="warn" />
                          <RollupChip label="risks" value={summary.open_risks} tone="error" />
                          <RollupChip label="plans" value={summary.open_plans} tone="info" />
                        </div>
                      </button>
                    );
                  }}
                </For>
              </aside>

              {/* Right: selected project detail */}
              <main class="flex flex-col gap-4 min-w-0">
                <Show
                  when={selectedId()}
                  fallback={
                    <EmptyState
                      icon="👈"
                      title="Select a project"
                      subtitle="Pick a project to see its tasks, issues, milestones, risks, decisions, and plans."
                      size="sm"
                    />
                  }
                >
                  <Show when={detailError()}>
                    <ErrorState
                      message={detailError()}
                      variant="banner"
                      onRetry={() => {
                        const id = selectedId();
                        if (id) loadDetail(id, false);
                      }}
                    />
                  </Show>

                  <Show
                    when={!detailLoading() && detailValue()}
                    fallback={<LoadingState message="Loading project…" />}
                  >
                    <Show when={detailValue()!.partial}>
                      <div class="surface flex items-center gap-2 border-status-warn/30 bg-status-warn/[0.05] px-3 py-2 text-xs text-status-warn">
                        <span aria-hidden="true">⚠</span>
                        <span>Some sources were unavailable; this view may be incomplete.</span>
                      </div>
                    </Show>

                    {/* Tasks */}
                    <SectionShell title="Tasks" count={stableTasks().length} empty="No open tasks.">
                      <ul class="flex flex-col divide-y divide-white/5">
                        <For each={stableTasks()}>
                          {(task) => (
                            <li class="flex items-center gap-3 py-2">
                              <span class="min-w-0 flex-1 truncate text-sm text-text-main">{task.title}</span>
                              <Badge tone={priorityTone(task.priority)}>{task.priority}</Badge>
                              <Badge tone={taskStatusTone(task.status)}>{task.status}</Badge>
                            </li>
                          )}
                        </For>
                      </ul>
                    </SectionShell>

                    {/* Issues */}
                    <SectionShell title="Issues" count={stableIssues().length} empty="No open issues.">
                      <ul class="flex flex-col divide-y divide-white/5">
                        <For each={stableIssues()}>
                          {(issue) => (
                            <li class="flex items-center gap-3 py-2">
                              <a
                                href={issue.web_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="min-w-0 flex-1 truncate text-sm text-text-main hover:text-status-ok hover:underline"
                              >
                                <span class="font-mono text-xs text-text-dim">#{issue.iid}</span>{' '}
                                {issue.title}
                              </a>
                              <For each={issue.labels.slice(0, 3)}>
                                {(label) => <Badge tone="default">{label}</Badge>}
                              </For>
                              <Badge tone={issue.state === 'opened' ? 'info' : 'ok'}>{issue.state}</Badge>
                            </li>
                          )}
                        </For>
                      </ul>
                    </SectionShell>

                    {/* Milestones */}
                    <SectionShell title="Milestones" count={stableMilestones().length} empty="No milestones.">
                      <ul class="flex flex-col divide-y divide-white/5">
                        <For each={stableMilestones()}>
                          {(milestone) => (
                            <li class="flex items-center gap-3 py-2">
                              <a
                                href={milestone.web_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="min-w-0 flex-1 truncate text-sm text-text-main hover:text-status-ok hover:underline"
                              >
                                {milestone.title}
                              </a>
                              <Show when={milestone.due_date}>
                                <span class="font-mono text-xs text-text-dim">{milestone.due_date}</span>
                              </Show>
                              <Badge tone={milestone.state === 'active' ? 'info' : 'ok'}>{milestone.state}</Badge>
                            </li>
                          )}
                        </For>
                      </ul>
                    </SectionShell>

                    {/* Risks */}
                    <SectionShell title="Risks" count={stableRisks().length} empty="No open risks.">
                      <ul class="flex flex-col divide-y divide-white/5">
                        <For each={stableRisks()}>
                          {(risk) => (
                            <li class="flex items-center gap-3 py-2">
                              <span class="min-w-0 flex-1 truncate text-sm text-text-main">{risk.title}</span>
                              <Badge tone={riskLevelTone(risk.likelihood)}>L: {risk.likelihood}</Badge>
                              <Badge tone={riskLevelTone(risk.impact)}>I: {risk.impact}</Badge>
                              <Badge tone={riskStatusTone(risk.status)}>{risk.status}</Badge>
                            </li>
                          )}
                        </For>
                      </ul>
                    </SectionShell>

                    {/* Decisions */}
                    <SectionShell title="Decisions" count={stableDecisions().length} empty="No decisions recorded.">
                      <ul class="flex flex-col divide-y divide-white/5">
                        <For each={stableDecisions()}>
                          {(decision) => (
                            <li class="flex items-center gap-3 py-2">
                              <span class="min-w-0 flex-1 truncate text-sm text-text-main">{decision.title}</span>
                              <span class="font-mono text-xs text-text-dim">{decision.decided_at}</span>
                            </li>
                          )}
                        </For>
                      </ul>
                    </SectionShell>

                    {/* Plans — read-only lifecycle view; create/advance lives in the loom-hud. */}
                    <SectionShell title="Plans" count={stablePlans().length} empty="No plans tracked.">
                      <ul class="flex flex-col divide-y divide-white/5">
                        <For each={stablePlans()}>
                          {(plan) => {
                            const kt = killTestSummary(plan.kill_test_status);
                            return (
                            <li class="flex items-center gap-3 py-2">
                              <span class="min-w-0 flex-1 truncate text-sm text-text-main">{plan.title}</span>
                              <Show when={plan.issue_iid > 0}>
                                <a
                                  href={plan.issue_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="font-mono text-xs text-text-dim hover:text-status-ok hover:underline"
                                  title="Born-linked GitLab issue"
                                >
                                  #{plan.issue_iid}
                                </a>
                              </Show>
                              <Show when={plan.slice_total > 0}>
                                <span
                                  class="font-mono text-xs text-text-dim tabular-nums"
                                  title="Slices landed (integrated/merged)"
                                >
                                  {plan.slice_done}/{plan.slice_total} slices
                                </span>
                              </Show>
                              <Show when={plan.mr_refs > 0}>
                                <span class="font-mono text-xs text-text-dim">{plan.mr_refs} MR</span>
                              </Show>
                              <Show when={kt.label}>
                                <Badge tone={kt.tone} title={plan.kill_test_status}>
                                  kill-test: {kt.label}
                                </Badge>
                              </Show>
                              <Badge tone={planPhaseTone(plan.phase)}>{plan.phase}</Badge>
                            </li>
                            );
                          }}
                        </For>
                      </ul>
                    </SectionShell>
                  </Show>
                </Show>
              </main>
            </div>
          </Show>
        </Show>
      </div>
    </PageScrollBody>
  );
};

const RollupChip: Component<{ label: string; value: number; tone: 'info' | 'warn' | 'error' }> = (props) => {
  const muted = () => props.value === 0;
  const toneClass = () => {
    if (muted()) return 'text-text-dim/50';
    switch (props.tone) {
      case 'warn':
        return 'text-status-warn';
      case 'error':
        return 'text-status-error';
      default:
        return 'text-text-dim';
    }
  };
  return (
    <span class={`font-mono text-[10px] tabular-nums ${toneClass()}`}>
      {props.value} {props.label}
    </span>
  );
};

export default Projects;
