import { Component, For, Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import {
  projectsApi,
  type ProjectDecision,
  type ProjectDetail,
  type ProjectIssue,
  type ProjectRisk,
  type ProjectRiskLink,
  type ProjectSummary,
  type ProjectTask,
  type UpdateProjectRiskInput,
} from '../../lib/api/projects';
import {
  projectsListFixture,
  projectDetailFixtures,
} from './projects.fixture';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
  type SelectOption,
} from '../shared';
import PageScrollBody from '../shared/PageScrollBody';
import { createPolling } from '../../hooks/createPolling';
import { stableListByKey } from '../../lib/stableList';
import {
  decisionSignature,
  killTestSummary,
  planPhaseTone,
  planSignature,
  slicePhaseTone,
  issueSignature,
  milestoneSignature,
  priorityTone,
  projectNamespace,
  projectShortName,
  riskLevelTone,
  riskSignature,
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
  // footer renders below the list regardless of count, so an action (e.g. the
  // inline risk-capture form) stays reachable even when the lane is empty.
  footer?: any;
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
    <Show when={props.footer}>{props.footer}</Show>
  </section>
);

const RISK_LEVEL_OPTIONS: SelectOption[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const RISK_STATUS_OPTIONS: SelectOption[] = [
  { value: 'identified', label: 'Identified' },
  { value: 'mitigating', label: 'Mitigating' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'closed', label: 'Closed' },
];

function riskLevelOptions(current: string): SelectOption[] {
  if (!current || RISK_LEVEL_OPTIONS.some((o) => o.value === current)) {
    return RISK_LEVEL_OPTIONS;
  }
  return [{ value: current, label: current }, ...RISK_LEVEL_OPTIONS];
}

// riskStatusOptions returns the canonical status ladder, prepending the current
// value when it falls outside it. Risks created outside the capture form (e.g.
// by loom-core's mcp-pm) may carry legacy statuses like "open"; preserving the
// current value keeps the select showing the true state while still offering the
// canonical transition targets the backend accepts.
function riskStatusOptions(current: string): SelectOption[] {
  if (!current || RISK_STATUS_OPTIONS.some((o) => o.value === current)) {
    return RISK_STATUS_OPTIONS;
  }
  return [{ value: current, label: current }, ...RISK_STATUS_OPTIONS];
}

type RiskLinkCandidate = ProjectRiskLink & { optionLabel: string };

function riskLinkKey(link: Pick<ProjectRiskLink, 'type' | 'id'>): string {
  return `${link.type}:${link.id}`;
}

function riskLinkLabel(link: ProjectRiskLink): string {
  return link.label?.trim() || link.id;
}

function riskLinkTypeLabel(link: ProjectRiskLink): string {
  switch (link.type) {
    case 'task':
      return 'Task';
    case 'issue':
      return 'Issue';
    case 'decision':
      return 'Decision';
  }
}

function riskLinkCandidates(
  tasks: ProjectTask[],
  issues: ProjectIssue[],
  decisions: ProjectDecision[],
): RiskLinkCandidate[] {
  return [
    ...tasks.map((task) => ({
      type: 'task' as const,
      id: task.id,
      label: task.title,
      optionLabel: `Task: ${task.title}`,
    })),
    ...issues.map((issue) => ({
      type: 'issue' as const,
      id: String(issue.iid),
      label: `#${issue.iid} ${issue.title}`,
      url: issue.web_url,
      optionLabel: `Issue #${issue.iid}: ${issue.title}`,
    })),
    ...decisions.map((decision) => ({
      type: 'decision' as const,
      id: decision.id,
      label: decision.title,
      optionLabel: `Decision: ${decision.title}`,
    })),
  ];
}

// RiskForm is the inline risk-capture form for non-API operators: it POSTs to
// the project's risks endpoint and calls onCreated so the caller can refresh
// the detail lane. State is component-local and resets when the form closes or
// the project selection changes (the parent tears this down on reselection).
const RiskForm: Component<{ projectId: string; onCreated: () => void }> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [title, setTitle] = createSignal('');
  const [likelihood, setLikelihood] = createSignal('medium');
  const [impact, setImpact] = createSignal('medium');
  const [status, setStatus] = createSignal('identified');
  const [owner, setOwner] = createSignal('');
  const [mitigation, setMitigation] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');

  const reset = () => {
    setTitle('');
    setLikelihood('medium');
    setImpact('medium');
    setStatus('identified');
    setOwner('');
    setMitigation('');
    setError('');
  };

  const close = () => {
    reset();
    setOpen(false);
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    const trimmed = title().trim();
    if (!trimmed) {
      setError('Title is required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await projectsApi.createRisk(props.projectId, {
        title: trimmed,
        likelihood: likelihood(),
        impact: impact(),
        status: status(),
        owner: owner().trim() || undefined,
        mitigation: mitigation().trim() || undefined,
      });
      reset();
      setOpen(false);
      props.onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create risk.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="border-t border-white/5 pt-3">
      <Show
        when={open()}
        fallback={
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            + Add risk
          </Button>
        }
      >
        <form class="flex flex-col gap-3" onSubmit={submit}>
          <Input
            aria-label="Risk title"
            placeholder="Risk title"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            autofocus
          />
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-text-dim">
              Likelihood
              <Select
                aria-label="Likelihood"
                options={RISK_LEVEL_OPTIONS}
                value={likelihood()}
                onChange={(e) => setLikelihood(e.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-text-dim">
              Impact
              <Select
                aria-label="Impact"
                options={RISK_LEVEL_OPTIONS}
                value={impact()}
                onChange={(e) => setImpact(e.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-text-dim">
              Status
              <Select
                aria-label="Status"
                options={RISK_STATUS_OPTIONS}
                value={status()}
                onChange={(e) => setStatus(e.currentTarget.value)}
              />
            </label>
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              aria-label="Owner"
              placeholder="Owner (optional)"
              value={owner()}
              onInput={(e) => setOwner(e.currentTarget.value)}
            />
            <Input
              aria-label="Mitigation"
              placeholder="Mitigation (optional)"
              value={mitigation()}
              onInput={(e) => setMitigation(e.currentTarget.value)}
            />
          </div>
          <Show when={error()}>
            <p class="text-xs text-status-error" role="alert">{error()}</p>
          </Show>
          <div class="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" loading={submitting()}>
              Save risk
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={submitting()} onClick={close}>
              Cancel
            </Button>
          </div>
        </form>
      </Show>
    </div>
  );
};

// RiskRow renders one risk with an inline status control — the write half of
// the risk lifecycle. Selecting a new status PATCHes the risk and calls
// onUpdated so the caller can silently refresh the detail lane. Likelihood and
// impact stay read-only badges; status is the primary operator transition
// (identify -> mitigate -> accept/close).
const RiskRow: Component<{
  projectId: string;
  risk: ProjectRisk;
  tasks: ProjectTask[];
  issues: ProjectIssue[];
  decisions: ProjectDecision[];
  onUpdated: () => void;
}> = (props) => {
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal('');
  const [selectedLink, setSelectedLink] = createSignal('');
  const [editing, setEditing] = createSignal(false);
  const [editTitle, setEditTitle] = createSignal('');
  const [editLikelihood, setEditLikelihood] = createSignal('');
  const [editImpact, setEditImpact] = createSignal('');
  const [editMitigation, setEditMitigation] = createSignal('');
  const [editOwner, setEditOwner] = createSignal('');

  const links = () => props.risk.links ?? [];
  const resetEditor = () => {
    setEditTitle(props.risk.title);
    setEditLikelihood(props.risk.likelihood);
    setEditImpact(props.risk.impact);
    setEditMitigation(props.risk.mitigation ?? '');
    setEditOwner(props.risk.owner ?? '');
  };

  createEffect(() => {
    if (!editing()) resetEditor();
  });

  const availableLinks = createMemo(() => {
    const linked = new Set(links().map(riskLinkKey));
    return riskLinkCandidates(props.tasks, props.issues, props.decisions).filter(
      (candidate) => !linked.has(riskLinkKey(candidate)),
    );
  });
  const linkOptions = createMemo<SelectOption[]>(() =>
    availableLinks().map((link) => ({
      value: riskLinkKey(link),
      label: link.optionLabel,
    })),
  );

  const changeStatus = async (next: string) => {
    if (next === props.risk.status) return;
    setSaving(true);
    setError('');
    try {
      await projectsApi.updateRisk(props.projectId, props.risk.id, { status: next });
      props.onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update risk.');
    } finally {
      setSaving(false);
    }
  };

  const replaceLinks = async (nextLinks: ProjectRiskLink[]) => {
    setSaving(true);
    setError('');
    try {
      await projectsApi.updateRisk(props.projectId, props.risk.id, { links: nextLinks });
      setSelectedLink('');
      props.onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update risk links.');
    } finally {
      setSaving(false);
    }
  };

  const addSelectedLink = () => {
    const next = availableLinks().find((link) => riskLinkKey(link) === selectedLink());
    if (!next) return;
    replaceLinks([...links(), {
      type: next.type,
      id: next.id,
      label: next.label,
      url: next.url,
    }]);
  };

  const removeLink = (target: ProjectRiskLink) => {
    replaceLinks(links().filter((link) => riskLinkKey(link) !== riskLinkKey(target)));
  };

  const closeEditor = () => {
    resetEditor();
    setEditing(false);
    setError('');
  };

  const submitEdit = async (event: Event) => {
    event.preventDefault();
    const nextTitle = editTitle().trim();
    if (!nextTitle) {
      setError('Title is required.');
      return;
    }

    const patch: UpdateProjectRiskInput = {};
    if (nextTitle !== props.risk.title) patch.title = nextTitle;
    if (editLikelihood() !== props.risk.likelihood) patch.likelihood = editLikelihood();
    if (editImpact() !== props.risk.impact) patch.impact = editImpact();
    if (editMitigation().trim() !== (props.risk.mitigation ?? '')) patch.mitigation = editMitigation().trim();
    if (editOwner().trim() !== (props.risk.owner ?? '')) patch.owner = editOwner().trim();

    if (Object.keys(patch).length === 0) {
      setEditing(false);
      setError('');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await projectsApi.updateRisk(props.projectId, props.risk.id, patch);
      setEditing(false);
      props.onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update risk fields.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li class="flex flex-col gap-2 py-2">
      <div class="flex items-center gap-3">
        <span class="min-w-0 flex-1 truncate text-sm text-text-main">{props.risk.title}</span>
        <Badge tone={riskLevelTone(props.risk.likelihood)}>L: {props.risk.likelihood}</Badge>
        <Badge tone={riskLevelTone(props.risk.impact)}>I: {props.risk.impact}</Badge>
        <Select
          class="w-32 shrink-0"
          aria-label={`Status for ${props.risk.title}`}
          options={riskStatusOptions(props.risk.status)}
          value={props.risk.status}
          disabled={saving()}
          onChange={(e) => changeStatus(e.currentTarget.value)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving()}
          onClick={() => {
            resetEditor();
            setEditing(true);
            setError('');
          }}
        >
          Edit fields
        </Button>
      </div>
      <Show when={props.risk.owner || props.risk.mitigation}>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
          <Show when={props.risk.owner}>
            <span class="truncate">Owner: {props.risk.owner}</span>
          </Show>
          <Show when={props.risk.mitigation}>
            <span class="min-w-0 flex-1 truncate">Mitigation: {props.risk.mitigation}</span>
          </Show>
        </div>
      </Show>
      <Show when={editing()}>
        <form class="surface flex flex-col gap-3 px-3 py-3" onSubmit={submitEdit}>
          <Input
            aria-label={`Edit title for ${props.risk.title}`}
            value={editTitle()}
            onInput={(e) => setEditTitle(e.currentTarget.value)}
            autofocus
          />
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-text-dim">
              Likelihood
              <Select
                aria-label={`Edit likelihood for ${props.risk.title}`}
                options={riskLevelOptions(props.risk.likelihood)}
                value={editLikelihood()}
                disabled={saving()}
                onChange={(e) => setEditLikelihood(e.currentTarget.value)}
              />
            </label>
            <label class="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-text-dim">
              Impact
              <Select
                aria-label={`Edit impact for ${props.risk.title}`}
                options={riskLevelOptions(props.risk.impact)}
                value={editImpact()}
                disabled={saving()}
                onChange={(e) => setEditImpact(e.currentTarget.value)}
              />
            </label>
            <Input
              aria-label={`Edit owner for ${props.risk.title}`}
              placeholder="Owner"
              value={editOwner()}
              disabled={saving()}
              onInput={(e) => setEditOwner(e.currentTarget.value)}
            />
            <Input
              aria-label={`Edit mitigation for ${props.risk.title}`}
              placeholder="Mitigation"
              value={editMitigation()}
              disabled={saving()}
              onInput={(e) => setEditMitigation(e.currentTarget.value)}
            />
          </div>
          <div class="flex items-center gap-2">
            <Button type="submit" variant="primary" size="sm" loading={saving()}>
              Save fields
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={saving()} onClick={closeEditor}>
              Cancel
            </Button>
          </div>
        </form>
      </Show>
      <Show when={links().length > 0 || linkOptions().length > 0}>
        <div class="flex flex-wrap items-center gap-2">
          <For each={links()}>
            {(link) => (
              <span class="inline-flex max-w-full items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs text-text-dim">
                <Badge tone="info">{riskLinkTypeLabel(link)}</Badge>
                <Show
                  when={link.url}
                  fallback={<span class="max-w-48 truncate">{riskLinkLabel(link)}</span>}
                >
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="max-w-48 truncate hover:text-status-ok hover:underline"
                  >
                    {riskLinkLabel(link)}
                  </a>
                </Show>
                <button
                  type="button"
                  class="rounded px-1 text-text-dim hover:bg-white/10 hover:text-text-main disabled:opacity-40"
                  aria-label={`Remove ${riskLinkTypeLabel(link).toLowerCase()} link from ${props.risk.title}`}
                  disabled={saving()}
                  onClick={() => removeLink(link)}
                >
                  ×
                </button>
              </span>
            )}
          </For>
          <Show when={linkOptions().length > 0}>
            <Select
              class="w-56"
              aria-label={`Link target for ${props.risk.title}`}
              placeholder="Link task/issue/decision"
              value={selectedLink()}
              disabled={saving()}
              options={linkOptions()}
              onChange={(e) => setSelectedLink(e.currentTarget.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving() || !selectedLink()}
              onClick={addSelectedLink}
            >
              Add link
            </Button>
          </Show>
        </div>
      </Show>
      <Show when={error()}>
        <p class="text-xs text-status-error" role="alert">{error()}</p>
      </Show>
    </li>
  );
};

const Projects: Component = () => {
  // Picker (left). Snapshot store reconciled each poll so rows don't churn.
  const [summaries, setSummaries] = createStore<{ items: ProjectSummary[] }>({ items: [] });
  const [listLoading, setListLoading] = createSignal(true);
  const [listError, setListError] = createSignal('');
  const [lastUpdated, setLastUpdated] = createSignal<number | null>(null);

  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  // Plan drill-in expansion state, keyed by plan id (survives polls).
  const [expandedPlans, setExpandedPlans] = createSignal<Record<string, boolean>>({});
  const togglePlan = (id: string) =>
    setExpandedPlans((e) => ({ ...e, [id]: !e[id] }));

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
        setExpandedPlans({});
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

                    {/* Risks — read lane plus an inline capture form for
                        non-API operators (POST /api/projects/{id}/risks). */}
                    <SectionShell
                      title="Risks"
                      count={stableRisks().length}
                      empty="No open risks."
                      footer={
                        <RiskForm
                          projectId={detailValue()!.project}
                          onCreated={() => {
                            const id = selectedId();
                            if (id) loadDetail(id, true);
                          }}
                        />
                      }
                    >
                      <ul class="flex flex-col divide-y divide-white/5">
                        <For each={stableRisks()}>
                          {(risk) => (
                            <RiskRow
                              projectId={detailValue()!.project}
                              risk={risk}
                              tasks={stableTasks()}
                              issues={stableIssues()}
                              decisions={stableDecisions()}
                              onUpdated={() => {
                                const id = selectedId();
                                if (id) loadDetail(id, true);
                              }}
                            />
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
                            const hasDetail = () =>
                              !!plan.riskiest_assumption || plan.slices.length > 0;
                            const expanded = () => !!expandedPlans()[plan.id];
                            return (
                            <li class="flex flex-col gap-1.5 py-2">
                              <div class="flex items-center gap-3">
                                <Show
                                  when={hasDetail()}
                                  fallback={
                                    <span class="min-w-0 flex-1 truncate text-sm text-text-main">
                                      {plan.title}
                                    </span>
                                  }
                                >
                                  <button
                                    type="button"
                                    onClick={() => togglePlan(plan.id)}
                                    aria-expanded={expanded()}
                                    class="group flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                  >
                                    <span class="w-2 text-[10px] text-text-dim">
                                      {expanded() ? '▾' : '▸'}
                                    </span>
                                    <span class="truncate text-sm text-text-main group-hover:text-status-ok">
                                      {plan.title}
                                    </span>
                                  </button>
                                </Show>
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
                              </div>

                              {/* Drill-in: riskiest assumption + slice list. */}
                              <Show when={expanded()}>
                                <div class="ml-4 flex flex-col gap-2 border-l border-white/10 pl-3">
                                  <Show when={plan.riskiest_assumption}>
                                    <p class="text-xs leading-relaxed text-text-dim">
                                      <span class="font-medium text-text-main">Riskiest assumption: </span>
                                      {plan.riskiest_assumption}
                                    </p>
                                  </Show>
                                  <Show when={plan.slices.length > 0}>
                                    <ul class="flex flex-col gap-1">
                                      <For each={plan.slices}>
                                        {(slice) => (
                                          <li class="flex items-center gap-2 text-xs">
                                            <span class="w-4 font-mono text-text-dim/60 tabular-nums">
                                              {slice.order}
                                            </span>
                                            <span class="min-w-0 flex-1 truncate text-text-main">
                                              {slice.name}
                                            </span>
                                            <Show when={slice.mr_ref}>
                                              <span class="font-mono text-text-dim">{slice.mr_ref}</span>
                                            </Show>
                                            <Badge tone={slicePhaseTone(slice.phase)}>{slice.phase}</Badge>
                                          </li>
                                        )}
                                      </For>
                                    </ul>
                                  </Show>
                                </div>
                              </Show>
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
