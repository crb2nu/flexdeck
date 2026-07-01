import { Component, createSignal, For, Match, Show, Switch } from 'solid-js';
import Badge, { type BadgeTone } from '../../shared/Badge';
import DetailPanel from '../../shared/DetailPanel';
import TabBar, { type TabDef } from '../../shared/TabBar';
import { createPolling } from '../../../hooks/createPolling';
import { isLoomMutationsEnabled } from '../../../lib/featureFlags';
import { healthStore } from '../../../stores/health';
import { currentUser } from '../../../stores/auth';
import {
  loomMillsApi,
  type MillsBacklogItem,
  type MillsCouncilRun,
  type MillsDebateRound,
  type MillsPipelineDetail,
  type MillsPipelineRun,
  type MillsStatus,
} from '../../../lib/api/loomMills';

// canMutate gates the slice-6 control buttons: both the dark-launch flag
// (loom_control_plane_mutations, backend default off) and an admin role are
// required. The backend enforces both independently (503 + 403); this only
// decides whether to render the controls at all.
function canMutate(): boolean {
  return isLoomMutationsEnabled(healthStore.features) && currentUser()?.role === 'admin';
}

type MillsTab = 'overview' | 'backlog' | 'pipelines' | 'council' | 'eval' | 'squads' | 'audit' | 'policy';

const MILLS_TABS: TabDef<MillsTab>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'pipelines', label: 'Pipelines' },
  { id: 'council', label: 'Council' },
  { id: 'eval', label: 'Eval' },
  { id: 'squads', label: 'Squads' },
  { id: 'audit', label: 'Audit' },
  { id: 'policy', label: 'Policy' },
];

function millsStateTone(state: string): BadgeTone {
  const s = (state || '').toLowerCase();
  if (['done', 'merged', 'success', 'green', 'pass'].includes(s)) return 'ok';
  if (['error', 'red', 'gate_fail', 'fail'].includes(s)) return 'error';
  if (['escalated', 'paused', 'partial', 'conflict', 'amber', 'yellow'].includes(s)) return 'warn';
  if (['queued', 'planning', 'slicing', 'implementing', 'testing', 'reviewing', 'mr', 'ci', 'merging', 'running'].includes(s)) return 'info';
  return 'default';
}

function fmtCost(usd: number | undefined): string {
  if (!usd) return '$0';
  return `$${usd.toFixed(2)}`;
}

function fmtTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function pick(o: unknown, keys: string[]): string {
  if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>;
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'string' && v) return v;
      if (typeof v === 'number') return String(v);
    }
  }
  return '';
}

// pollResource wires a poll-on-interval fetch into the calling component's
// reactive scope; unregisters automatically when the panel unmounts.
function pollResource<T>(id: string, fetcher: () => Promise<T>, intervalMs = 15000) {
  const [data, setData] = createSignal<T | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const run = async () => {
    try {
      const v = await fetcher();
      setData(() => v);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setLoaded(true);
    }
  };
  createPolling(id, run, intervalMs);
  return { data, error, loaded };
}

const PanelState: Component<{ error: string | null; loaded: boolean; empty: string }> = (props) => (
  <div class="surface px-4 py-6 text-center text-sm">
    <Show
      when={props.error}
      fallback={<span class="text-text-dim">{props.loaded ? props.empty : 'Loading…'}</span>}
    >
      <span class="text-status-error">{props.error?.includes('disabled') ? 'Mills operator unavailable.' : props.error}</span>
    </Show>
  </div>
);

const Metric: Component<{ label: string; value: string; tone?: BadgeTone }> = (props) => (
  <div class="surface px-3 py-2">
    <div class="heading-label">{props.label}</div>
    <div
      class={`mt-1 text-lg font-semibold tabular-nums ${
        props.tone === 'ok' ? 'text-status-ok' : props.tone === 'warn' ? 'text-status-warn' : props.tone === 'error' ? 'text-status-error' : 'text-white'
      }`}
    >
      {props.value}
    </div>
  </div>
);

const OverviewPanel: Component = () => {
  const { data, error, loaded } = pollResource<MillsStatus>('mills-status', loomMillsApi.status, 10000);
  return (
    <Show when={data()} fallback={<PanelState error={error()} loaded={loaded()} empty="No status." />}>
      {(s) => (
        <div class="space-y-3">
          <div class="grid gap-2 sm:grid-cols-3">
            <Metric label="Autonomy" value={s().autonomy_ready ? 'ready' : 'blocked'} tone={s().autonomy_ready ? 'ok' : 'warn'} />
            <Metric label="Active pipelines" value={String(s().active_pipeline_runs ?? 0)} />
            <Metric label="Blockers" value={String(s().autonomy_blockers?.length ?? 0)} tone={(s().autonomy_blockers?.length ?? 0) > 0 ? 'warn' : 'ok'} />
          </div>
          <Show when={s().capabilities?.length}>
            <div>
              <div class="heading-label mb-1">Capabilities</div>
              <div class="space-y-1">
                <For each={s().capabilities}>
                  {(c) => (
                    <div class="flex items-center justify-between gap-2 surface px-3 py-1.5 text-xs">
                      <span class="text-text-main">{c.id}</span>
                      <div class="flex items-center gap-2">
                        <Show when={c.message}><span class="hidden text-text-muted sm:inline">{c.message}</span></Show>
                        <Badge tone={millsStateTone(c.status)} size="sm">{c.status}</Badge>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
};

const BacklogPanel: Component = () => {
  const { data, error, loaded } = pollResource<MillsBacklogItem[]>('mills-backlog', loomMillsApi.backlog, 15000);
  const items = () => data() ?? [];
  return (
    <Show when={items().length > 0} fallback={<PanelState error={error()} loaded={loaded()} empty="Backlog is empty." />}>
      <div class="space-y-1">
        <For each={items()}>
          {(it) => (
            <div class="surface flex items-center justify-between gap-3 px-3 py-2">
              <div class="min-w-0">
                <div class="truncate text-sm text-text-main">{it.Title || it.ID}</div>
                <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
                  <span class="font-mono">{it.ID}</span>
                  <Show when={it.PlanID}><span>plan {it.PlanID}</span></Show>
                  <Show when={it.Labels?.length}><span>{it.Labels!.join(', ')}</span></Show>
                </div>
              </div>
              <div class="flex flex-shrink-0 items-center gap-2">
                <Show when={it.Priority}><span class="text-[11px] text-text-dim">{it.Priority}</span></Show>
                <Badge tone={millsStateTone(it.State)} size="sm">{it.State}</Badge>
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
};

// ControlButton runs a mills mutation with pending + inline error state. Set
// `confirmLabel` for destructive actions (the kill-switch): the first click
// arms a confirm, the second executes. Non-confirm actions run on first click.
const ControlButton: Component<{
  label: string;
  confirmLabel?: string;
  danger?: boolean;
  run: () => Promise<unknown>;
  onDone?: () => void;
}> = (props) => {
  const [pending, setPending] = createSignal(false);
  const [armed, setArmed] = createSignal(false);
  const [err, setErr] = createSignal<string | null>(null);

  const exec = async () => {
    setPending(true);
    setErr(null);
    try {
      await props.run();
      setArmed(false);
      props.onDone?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'action failed');
    } finally {
      setPending(false);
    }
  };

  const onClick = () => {
    if (props.confirmLabel && !armed()) {
      setArmed(true);
      return;
    }
    void exec();
  };

  return (
    <span class="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending()}
        onClick={onClick}
        class={`rounded px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
          props.danger
            ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
            : 'surface text-text-main hover:bg-white/[0.06]'
        }`}
      >
        {pending() ? '…' : armed() ? (props.confirmLabel as string) : props.label}
      </button>
      <Show when={armed() && !pending()}>
        <button
          type="button"
          class="text-[10px] text-text-muted hover:text-text-main"
          onClick={() => setArmed(false)}
        >
          cancel
        </button>
      </Show>
      <Show when={err()}>
        <span class="text-[10px] text-red-400" role="alert">{err()}</span>
      </Show>
    </span>
  );
};

const PipelinesPanel: Component = () => {
  const { data, error, loaded } = pollResource<MillsPipelineRun[]>('mills-pipelines', loomMillsApi.pipelineRuns, 10000);
  const [detail, setDetail] = createSignal<MillsPipelineDetail | null>(null);
  const items = () => data() ?? [];

  const open = async (id: string) => {
    try {
      setDetail(await loomMillsApi.pipelineRun(id));
    } catch {
      /* surfaced by the list poll */
    }
  };

  return (
    <>
      <Show when={items().length > 0} fallback={<PanelState error={error()} loaded={loaded()} empty="No pipeline runs." />}>
        <div class="space-y-1">
          <For each={items()}>
            {(run) => (
              <button class="surface flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/[0.03]" onClick={() => open(run.ID)}>
                <div class="min-w-0">
                  <div class="truncate text-sm text-text-main">{run.BacklogID || run.ID}</div>
                  <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
                    <span class="font-mono">{run.ID}</span>
                    <Show when={run.CurrentStage}><span>@ {run.CurrentStage}</span></Show>
                    <Show when={run.Attempts}><span>attempt {run.Attempts}</span></Show>
                    <Show when={run.Depth > 0}><span>depth {run.Depth}</span></Show>
                  </div>
                </div>
                <div class="flex flex-shrink-0 items-center gap-2">
                  <span class="text-[11px] tabular-nums text-text-dim">{fmtCost(run.CostUSD)}</span>
                  <Badge tone={millsStateTone(run.State)} size="sm">{run.State}</Badge>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={detail()}>
        {(d) => (
          <DetailPanel
            title={`Pipeline ${d().run.ID}`}
            subtitle={`${d().run.BacklogID} · ${d().run.State} · ${fmtCost(d().run.CostUSD)}`}
            status={millsStateTone(d().run.State) === 'ok' ? 'ok' : millsStateTone(d().run.State) === 'error' ? 'error' : 'running'}
            onClose={() => setDetail(null)}
          >
            <div class="space-y-2 px-4 py-4 sm:px-6">
              <Show when={canMutate()}>
                <div class="flex flex-wrap items-center gap-2 border-b border-white/[0.06] pb-3">
                  <span class="heading-label">Controls</span>
                  <ControlButton label="Pause" run={() => loomMillsApi.pausePipelineRun(d().run.ID)} onDone={() => open(d().run.ID)} />
                  <ControlButton label="Resume" run={() => loomMillsApi.resumePipelineRun(d().run.ID)} onDone={() => open(d().run.ID)} />
                  <ControlButton label="Escalate" run={() => loomMillsApi.escalatePipelineRun(d().run.ID)} onDone={() => open(d().run.ID)} />
                </div>
              </Show>
              <div class="heading-label">Stages ({d().stages?.length ?? 0})</div>
              <Show when={(d().stages?.length ?? 0) > 0} fallback={<p class="text-sm text-text-muted">No stage attempts recorded.</p>}>
                <For each={d().stages!}>
                  {(st) => (
                    <div class="surface px-3 py-2">
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm text-text-main">{st.Stage} <span class="text-text-muted">· attempt {st.Attempt}</span></span>
                        <div class="flex items-center gap-2">
                          <span class="text-[11px] tabular-nums text-text-dim">{fmtCost(st.CostUSD)}</span>
                          <Badge tone={millsStateTone(st.Outcome || '')} size="sm">{st.Outcome || 'running'}</Badge>
                        </div>
                      </div>
                      <Show when={st.LogTail}>
                        <pre class="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-[11px] text-text-muted">{st.LogTail}</pre>
                      </Show>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </DetailPanel>
        )}
      </Show>
    </>
  );
};

const CouncilPanel: Component = () => {
  const { data, error, loaded } = pollResource<MillsCouncilRun[]>('mills-council', loomMillsApi.councilRuns, 15000);
  const [debate, setDebate] = createSignal<{ run: MillsCouncilRun; rounds: MillsDebateRound[] } | null>(null);
  const items = () => data() ?? [];

  const open = async (run: MillsCouncilRun) => {
    try {
      setDebate({ run, rounds: (await loomMillsApi.councilDebate(run.ID)) ?? [] });
    } catch {
      /* surfaced by the list poll */
    }
  };

  return (
    <>
      <Show when={items().length > 0} fallback={<PanelState error={error()} loaded={loaded()} empty="No council runs." />}>
        <div class="space-y-1">
          <For each={items()}>
            {(run) => (
              <button class="surface flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-white/[0.03]" onClick={() => open(run)}>
                <div class="min-w-0">
                  <div class="truncate text-sm text-text-main">{run.Trigger || 'council'} <span class="font-mono text-[11px] text-text-muted">{run.ID}</span></div>
                  <div class="mt-0.5 text-[11px] text-text-muted">{fmtTime(run.StartedAt)} · {fmtCost(run.CostFrontierUSD + run.CostLocalUSD)}</div>
                </div>
                <Badge tone={millsStateTone(run.Outcome)} size="sm">{run.Outcome}</Badge>
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={debate()}>
        {(d) => (
          <DetailPanel
            title={`Council ${d().run.ID}`}
            subtitle={`${d().run.Trigger} · ${d().run.Outcome}`}
            status={millsStateTone(d().run.Outcome) === 'ok' ? 'ok' : millsStateTone(d().run.Outcome) === 'error' ? 'error' : 'running'}
            onClose={() => setDebate(null)}
          >
            <div class="space-y-2 px-4 py-4 sm:px-6">
              <div class="heading-label">Debate ({d().rounds.length} rounds)</div>
              <Show when={d().rounds.length > 0} fallback={<p class="text-sm text-text-muted">No debate transcript recorded.</p>}>
                <For each={d().rounds}>
                  {(rd) => (
                    <div class="surface px-3 py-2">
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-sm text-text-main">#{rd.RoundIndex} · {rd.Role}</span>
                        <span class="text-[11px] tabular-nums text-text-dim">{fmtCost(rd.CostUSD)}</span>
                      </div>
                      <Show when={rd.Summary}><p class="mt-1 whitespace-pre-wrap text-xs text-text-dim">{rd.Summary}</p></Show>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </DetailPanel>
        )}
      </Show>
    </>
  );
};

// RawPanel renders the eval/squads/audit/policy endpoints generically (the
// operator returns Go-struct JSON; a dedicated panel per surface lands later).
const RawPanel: Component<{ id: string; path: string; empty: string }> = (props) => {
  const { data, error, loaded } = pollResource<unknown>(`mills-raw-${props.id}`, () => loomMillsApi.raw(props.path), 30000);
  const items = () => (Array.isArray(data()) ? (data() as unknown[]) : []);
  return (
    <Show when={items().length > 0} fallback={<PanelState error={error()} loaded={loaded()} empty={props.empty} />}>
      <div class="space-y-1">
        <For each={items()}>
          {(it) => {
            const label = () => pick(it, ['ID', 'id', 'Name', 'name', 'Title', 'title', 'Model', 'model']) || '—';
            const state = () => pick(it, ['State', 'state', 'Outcome', 'outcome', 'Kind', 'kind', 'Status', 'status', 'Severity', 'severity']);
            return (
              <div class="surface flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span class="truncate text-text-main">{label()}</span>
                <Show when={state()}><Badge tone={millsStateTone(state())} size="sm">{state()}</Badge></Show>
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
};

// PolicyPanel shows policy proposals plus the slice-6 autonomy kill-switch
// (admin + flag gated). Tripping it halts ALL mills pipelines, so it requires
// an explicit confirm.
const PolicyPanel: Component = () => {
  const [tripped, setTripped] = createSignal(false);
  return (
    <div class="space-y-3">
      <Show when={canMutate()}>
        <div class="surface flex flex-wrap items-center justify-between gap-2 border border-red-500/20 px-3 py-2">
          <div>
            <div class="text-sm font-medium text-text-main">Autonomy kill-switch</div>
            <div class="text-[11px] text-text-muted">Halts all mills pipelines. Admin-only.</div>
          </div>
          <div class="flex items-center gap-2">
            <Show when={tripped()}><span class="text-[11px] text-red-300">kill-switch tripped</span></Show>
            <ControlButton
              label="Trip kill-switch"
              confirmLabel="Confirm halt"
              danger
              run={() => loomMillsApi.killSwitch()}
              onDone={() => setTripped(true)}
            />
          </div>
        </div>
      </Show>
      <RawPanel id="policy" path="policy/proposals" empty="No policy proposals." />
    </div>
  );
};

const Mills: Component = () => {
  const [active, setActive] = createSignal<MillsTab>('overview');

  // Switch/Match creates only the active panel, so hidden tabs don't poll.
  return (
    <div class="space-y-3">
      <TabBar tabs={MILLS_TABS} active={active()} onChange={setActive} variant="underline" />
      <Switch>
        <Match when={active() === 'overview'}><OverviewPanel /></Match>
        <Match when={active() === 'backlog'}><BacklogPanel /></Match>
        <Match when={active() === 'pipelines'}><PipelinesPanel /></Match>
        <Match when={active() === 'council'}><CouncilPanel /></Match>
        <Match when={active() === 'eval'}><RawPanel id="eval" path="eval/scores" empty="No eval scores." /></Match>
        <Match when={active() === 'squads'}><RawPanel id="squads" path="squads" empty="No squads." /></Match>
        <Match when={active() === 'audit'}><RawPanel id="audit" path="audit/findings" empty="No audit findings." /></Match>
        <Match when={active() === 'policy'}><PolicyPanel /></Match>
      </Switch>
    </div>
  );
};

export default Mills;
