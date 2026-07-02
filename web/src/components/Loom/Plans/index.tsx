import { Component, createSignal, For, Show } from 'solid-js';
import Badge, { toneToPanelStatus } from '../../shared/Badge';
import DetailPanel from '../../shared/DetailPanel';
import MiniTable, { type MiniColumn } from '../../shared/MiniTable';
import PanelState from '../../shared/PanelState';
import { createPolledResource } from '../../../hooks/createPolledResource';
import { formatShortDate } from '../../../lib/format';
import { planPhaseTone, killTestSummary, slicePhaseTone, projectShortName } from '../../Projects/projectsUtils';
import { loomPlansApi, type LoomPlansList, type LoomPlanSummary, type LoomPlanDetail } from '../../../lib/api/loomPlans';

// Phase filter chips. '' = all phases.
const PHASE_FILTERS: { id: string; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'planned', label: 'Planned' },
  { id: 'in_review', label: 'In review' },
  { id: 'merging', label: 'Merging' },
  { id: 'merged', label: 'Merged' },
  { id: 'done', label: 'Done' },
  { id: 'draft', label: 'Draft' },
];

const SliceBar: Component<{ done: number; total: number }> = (props) => {
  const pct = () => (props.total > 0 ? Math.round((props.done / props.total) * 100) : 0);
  return (
    <Show when={props.total > 0} fallback={<span class="text-xs text-text-muted">—</span>}>
      <div class="flex items-center gap-2">
        <div class="h-1.5 w-16 overflow-hidden rounded-full bg-white/10">
          <div class="h-full rounded-full bg-status-ok" style={{ width: `${pct()}%` }} />
        </div>
        <span class="text-xs tabular-nums text-text-dim">{props.done}/{props.total}</span>
      </div>
    </Show>
  );
};

const PlanDetailBody: Component<{ plan: LoomPlanDetail }> = (props) => {
  const p = () => props.plan;
  return (
    <div class="space-y-5 px-4 py-4 sm:px-6">
      <div class="grid gap-4 lg:grid-cols-2">
        <Show when={p().riskiest_assumption}>
          <section>
            <div class="heading-label">Riskiest assumption</div>
            <p class="mt-1 text-sm text-text-main">{p().riskiest_assumption}</p>
          </section>
        </Show>
        <Show when={p().kill_test}>
          <section>
            <div class="heading-label flex items-center gap-2">
              Kill test
              <Show when={p().kill_test_status}>
                <Badge tone={killTestSummary(p().kill_test_status).tone} size="sm">
                  {killTestSummary(p().kill_test_status).label || 'recorded'}
                </Badge>
              </Show>
            </div>
            <p class="mt-1 text-sm text-text-dim">{p().kill_test}</p>
          </section>
        </Show>
      </div>

      <Show when={p().success && (p().success!.tests?.length || p().success!.metrics?.length || p().success!.manual_check)}>
        <section>
          <div class="heading-label">Success criteria</div>
          <ul class="mt-1 space-y-0.5 text-sm text-text-dim">
            <For each={p().success!.tests || []}>{(t) => <li>✓ test: <span class="font-mono text-text-muted">{t}</span></li>}</For>
            <For each={p().success!.metrics || []}>{(m) => <li>✓ metric: {m}</li>}</For>
            <Show when={p().success!.manual_check}><li>✓ manual: {p().success!.manual_check}</li></Show>
          </ul>
        </section>
      </Show>

      <section>
        <div class="heading-label">Slices ({p().slice_done}/{p().slice_total})</div>
        <Show when={p().slices.length > 0} fallback={<p class="mt-1 text-sm text-text-muted">No slices.</p>}>
          <ol class="mt-2 space-y-2">
            <For each={p().slices}>
              {(s) => (
                <li class="surface px-3 py-2">
                  <div class="flex items-center justify-between gap-2">
                    <span class="text-sm font-medium text-text-main">
                      <span class="text-text-muted tabular-nums">{s.order}.</span> {s.name}
                    </span>
                    <Badge tone={slicePhaseTone(s.phase)} size="sm">{s.phase || 'pending'}</Badge>
                  </div>
                  <Show when={s.goal}><p class="mt-1 text-xs text-text-dim">{s.goal}</p></Show>
                  <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                    <Show when={s.files.length}><span>{s.files.length} file{s.files.length === 1 ? '' : 's'}</span></Show>
                    <Show when={s.mr_ref}><span class="font-mono">{s.mr_ref}</span></Show>
                    <Show when={s.depends_on.length}><span>depends on {s.depends_on.length}</span></Show>
                  </div>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </section>

      <Show when={p().phase_history.length > 0}>
        <section>
          <div class="heading-label">Lifecycle</div>
          <ul class="mt-1 space-y-0.5 text-xs text-text-dim">
            <For each={p().phase_history}>
              {(t) => (
                <li>
                  <span class="text-text-muted">{formatShortDate(t.at)}</span> {t.from} → <span class="text-text-main">{t.to}</span>
                  <Show when={t.note}> · {t.note}</Show>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>

      <section class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-dim">
        <Show when={p().issue_url}>
          <a href={p().issue_url} target="_blank" rel="noreferrer" class="text-info hover:underline">GitLab issue #{p().issue_iid}</a>
        </Show>
        <Show when={p().mr_ref_list.length}><span>{p().mr_ref_list.length} MR{p().mr_ref_list.length === 1 ? '' : 's'}</span></Show>
        <Show when={p().mills_backlog_id}><span>mills: <span class="font-mono text-text-muted">{p().mills_backlog_id}</span></span></Show>
        <Show when={p().mirror_path}><span class="font-mono text-text-muted">{p().mirror_path}</span></Show>
      </section>
    </div>
  );
};

const PLAN_COLUMNS: MiniColumn<LoomPlanSummary>[] = [
  {
    header: 'Plan',
    cell: (plan) => (
      <>
        <div class="font-medium text-text-main">{plan.title}</div>
        <div class="text-[11px] text-text-muted">{plan.mr_refs > 0 ? `${plan.mr_refs} MR${plan.mr_refs === 1 ? '' : 's'}` : ''}</div>
      </>
    ),
  },
  { header: 'Project', class: 'text-text-dim', cell: (plan) => projectShortName(plan.project) },
  { header: 'Phase', cell: (plan) => <Badge tone={planPhaseTone(plan.phase)} size="sm">{plan.phase || '—'}</Badge> },
  {
    header: 'Kill test',
    cell: (plan) => {
      const kt = killTestSummary(plan.kill_test_status);
      return (
        <Show when={kt.label} fallback={<span class="text-text-muted">—</span>}>
          <Badge tone={kt.tone} size="sm">{kt.label}</Badge>
        </Show>
      );
    },
  },
  { header: 'Slices', cell: (plan) => <SliceBar done={plan.slice_done} total={plan.slice_total} /> },
  {
    header: 'Updated',
    align: 'right',
    class: 'text-xs text-text-muted tabular-nums',
    cell: (plan) => formatShortDate(plan.updated_at),
  },
];

const Plans: Component = () => {
  const [phase, setPhase] = createSignal('');
  const [selected, setSelected] = createSignal<LoomPlanDetail | null>(null);
  const [openErr, setOpenErr] = createSignal<string | null>(null);

  // Keyed reconcile keeps rows stable across polls (no flicker); the fetcher
  // reads phase() so refresh() after a filter change reloads immediately.
  const plans = createPolledResource<LoomPlansList>(
    'loom-plans',
    () => loomPlansApi.list(phase() ? { phase: phase() } : undefined),
  );
  const items = () => plans.data()?.plans ?? [];

  const selectPhase = (id: string) => {
    setPhase(id);
    void plans.refresh();
  };

  const openDetail = async (id: string) => {
    try {
      setSelected(await loomPlansApi.get(id));
      setOpenErr(null);
    } catch (e) {
      setOpenErr(e instanceof Error ? e.message : 'failed to load plan');
    }
  };

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-1" role="group" aria-label="Filter plans by phase">
        <For each={PHASE_FILTERS}>
          {(f) => (
            <button
              onClick={() => selectPhase(f.id)}
              aria-pressed={phase() === f.id}
              class={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                phase() === f.id ? 'bg-white/10 text-white' : 'text-text-dim hover:bg-white/5 hover:text-text-main'
              }`}
            >
              {f.label}
            </button>
          )}
        </For>
      </div>

      <Show when={openErr()}>
        <div class="rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error" role="alert">{openErr()}</div>
      </Show>

      <Show
        when={items().length > 0}
        fallback={<PanelState error={plans.error()} loaded={plans.loaded()} empty="No plans match this filter." />}
      >
        <MiniTable columns={PLAN_COLUMNS} each={items()} onRowClick={(plan) => void openDetail(plan.id)} />
      </Show>

      <Show when={selected()}>
        {(plan) => (
          <DetailPanel
            title={plan().title}
            subtitle={`${plan().project} · ${plan().phase}`}
            status={toneToPanelStatus(planPhaseTone(plan().phase))}
            onClose={() => setSelected(null)}
          >
            <PlanDetailBody plan={plan()} />
          </DetailPanel>
        )}
      </Show>
    </div>
  );
};

export default Plans;
