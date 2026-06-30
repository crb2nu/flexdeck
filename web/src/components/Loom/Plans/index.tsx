import { Component, createSignal, For, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import Badge from '../../shared/Badge';
import DetailPanel from '../../shared/DetailPanel';
import { createPolling } from '../../../hooks/createPolling';
import { planPhaseTone, killTestSummary, slicePhaseTone, projectShortName } from '../../Projects/projectsUtils';
import { loomPlansApi, type LoomPlanSummary, type LoomPlanDetail } from '../../../lib/api/loomPlans';

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

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

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
                  <span class="text-text-muted">{fmtDate(t.at)}</span> {t.from} → <span class="text-text-main">{t.to}</span>
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

const Plans: Component = () => {
  const [store, setStore] = createStore<{ items: LoomPlanSummary[] }>({ items: [] });
  const [error, setError] = createSignal<string | null>(null);
  const [phase, setPhase] = createSignal('');
  const [selected, setSelected] = createSignal<LoomPlanDetail | null>(null);
  const [loaded, setLoaded] = createSignal(false);

  const fetchPlans = async () => {
    try {
      const res = await loomPlansApi.list(phase() ? { phase: phase() } : undefined);
      // reconcile by id keeps rows stable across polls (no flicker).
      setStore('items', reconcile(res.plans ?? [], { key: 'id' }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load plans');
    } finally {
      setLoaded(true);
    }
  };

  createPolling('loom-plans', fetchPlans, 15000);

  const selectPhase = (id: string) => {
    setPhase(id);
    void fetchPlans();
  };

  const openDetail = async (id: string) => {
    try {
      setSelected(await loomPlansApi.get(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load plan');
    }
  };

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center gap-1">
        <For each={PHASE_FILTERS}>
          {(f) => (
            <button
              onClick={() => selectPhase(f.id)}
              class={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                phase() === f.id ? 'bg-white/10 text-white' : 'text-text-dim hover:bg-white/5 hover:text-text-main'
              }`}
            >
              {f.label}
            </button>
          )}
        </For>
      </div>

      <Show when={error()}>
        <div class="rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error">{error()}</div>
      </Show>

      <Show
        when={store.items.length > 0}
        fallback={
          <div class="surface px-4 py-8 text-center text-sm text-text-dim">
            {loaded() ? 'No plans match this filter.' : 'Loading plans…'}
          </div>
        }
      >
        <div class="surface overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-white/8 text-left text-[11px] uppercase tracking-wide text-text-muted">
                <th class="px-3 py-2 font-medium">Plan</th>
                <th class="px-3 py-2 font-medium">Project</th>
                <th class="px-3 py-2 font-medium">Phase</th>
                <th class="px-3 py-2 font-medium">Kill test</th>
                <th class="px-3 py-2 font-medium">Slices</th>
                <th class="px-3 py-2 font-medium text-right">Updated</th>
              </tr>
            </thead>
            <tbody>
              <For each={store.items}>
                {(plan) => {
                  const kt = () => killTestSummary(plan.kill_test_status);
                  return (
                    <tr
                      class="cursor-pointer border-b border-white/5 last:border-0 hover:bg-white/[0.03]"
                      onClick={() => openDetail(plan.id)}
                    >
                      <td class="px-3 py-2">
                        <div class="font-medium text-text-main">{plan.title}</div>
                        <div class="text-[11px] text-text-muted">{plan.mr_refs > 0 ? `${plan.mr_refs} MR${plan.mr_refs === 1 ? '' : 's'}` : ''}</div>
                      </td>
                      <td class="px-3 py-2 text-text-dim">{projectShortName(plan.project)}</td>
                      <td class="px-3 py-2"><Badge tone={planPhaseTone(plan.phase)} size="sm">{plan.phase || '—'}</Badge></td>
                      <td class="px-3 py-2">
                        <Show when={kt().label} fallback={<span class="text-text-muted">—</span>}>
                          <Badge tone={kt().tone} size="sm">{kt().label}</Badge>
                        </Show>
                      </td>
                      <td class="px-3 py-2"><SliceBar done={plan.slice_done} total={plan.slice_total} /></td>
                      <td class="px-3 py-2 text-right text-xs text-text-muted tabular-nums">{fmtDate(plan.updated_at)}</td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={selected()}>
        {(plan) => (
          <DetailPanel
            title={plan().title}
            subtitle={`${plan().project} · ${plan().phase}`}
            status={planPhaseTone(plan().phase) === 'ok' ? 'ok' : planPhaseTone(plan().phase) === 'warn' ? 'warn' : 'running'}
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
