import { Component, createSignal, For, Match, Show, Switch } from 'solid-js';
import Badge, { toneToPanelStatus, type BadgeTone } from '../../shared/Badge';
import DetailPanel from '../../shared/DetailPanel';
import ListRow from '../../shared/ListRow';
import MetricTile from '../../shared/MetricTile';
import PanelState from '../../shared/PanelState';
import TabBar, { type TabDef } from '../../shared/TabBar';
import { createPolledResource } from '../../../hooks/createPolledResource';
import { formatShortDateTime, formatUSD } from '../../../lib/format';
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

function mutationFeature() {
  return healthStore.features?.loom_control_plane_mutations;
}

function isCurrentUserAdmin(): boolean {
  return currentUser()?.role === 'admin';
}

// canMutate gates the slice-6 control buttons: both the dark-launch flag
// (loom_control_plane_mutations, backend default off) and an admin role are
// required. The backend enforces both independently (503 + 403); this only
// decides whether to render the controls at all.
function canMutate(): boolean {
  return isLoomMutationsEnabled(healthStore.features) && isCurrentUserAdmin();
}

function mutationReadiness(): { label: string; detail: string; tone: BadgeTone } {
  const feature = mutationFeature();
  if (isLoomMutationsEnabled(healthStore.features)) {
    if (isCurrentUserAdmin()) {
      return { label: 'Controls enabled', detail: 'Admin controls are available.', tone: 'ok' };
    }
    return { label: 'Admin role required', detail: 'Signed-in user is not an admin.', tone: 'warn' };
  }
  switch (feature?.mode) {
    case 'operator_disabled':
      return { label: 'Operator disabled', detail: feature.reason || 'Mills operator is disabled or unconfigured.', tone: 'default' };
    case 'missing_admin_token':
      return { label: 'Admin token missing', detail: feature.reason || 'LOOM_MILLS_ADMIN_TOKEN is not configured.', tone: 'warn' };
    case 'dark_launch':
      return { label: 'Dark launch off', detail: feature.reason || 'LOOM_MILLS_MUTATIONS_ENABLED is false.', tone: 'default' };
    default:
      return { label: 'Controls unavailable', detail: feature?.reason || 'Mills mutation readiness is unavailable.', tone: 'default' };
  }
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

const MILLS_OFFLINE = 'Mills operator unavailable.';

function millsStateTone(state: string): BadgeTone {
  const s = (state || '').toLowerCase();
  if (['done', 'merged', 'success', 'green', 'pass'].includes(s)) return 'ok';
  if (['error', 'red', 'gate_fail', 'fail'].includes(s)) return 'error';
  if (['escalated', 'paused', 'partial', 'conflict', 'amber', 'yellow'].includes(s)) return 'warn';
  if (['queued', 'planning', 'slicing', 'implementing', 'testing', 'reviewing', 'mr', 'ci', 'merging', 'running'].includes(s)) return 'info';
  return 'default';
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

const MutationReadiness: Component = () => {
  const readiness = () => mutationReadiness();
  return (
    <div class="surface flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div>
        <div class="heading-label mb-1">Mutation readiness</div>
        <div class="text-xs text-text-muted">{readiness().detail}</div>
      </div>
      <Badge tone={readiness().tone} size="sm">{readiness().label}</Badge>
    </div>
  );
};

const OverviewPanel: Component = () => {
  const status = createPolledResource<MillsStatus>('mills-status', loomMillsApi.status, { interval: 10000 });
  return (
    <Show when={status.data()} fallback={<PanelState error={status.error()} loaded={status.loaded()} empty="No status." offlineLabel={MILLS_OFFLINE} />}>
      {(s) => (
        <div class="space-y-3">
          <div class="grid gap-2 sm:grid-cols-3">
            <MetricTile label="Autonomy" value={s().autonomy_ready ? 'ready' : 'blocked'} tone={s().autonomy_ready ? 'ok' : 'warn'} />
            <MetricTile label="Active pipelines" value={String(s().active_pipeline_runs ?? 0)} />
            <MetricTile label="Blockers" value={String(s().autonomy_blockers?.length ?? 0)} tone={(s().autonomy_blockers?.length ?? 0) > 0 ? 'warn' : 'ok'} />
          </div>
          <MutationReadiness />
          <Show when={s().capabilities?.length}>
            <div>
              <div class="heading-label mb-1">Capabilities</div>
              <div class="space-y-1">
                <For each={s().capabilities}>
                  {(c) => (
                    <ListRow
                      dense
                      class="text-xs"
                      trailing={
                        <>
                          <Show when={c.message}><span class="hidden text-text-muted sm:inline">{c.message}</span></Show>
                          <Badge tone={millsStateTone(c.status)} size="sm">{c.status}</Badge>
                        </>
                      }
                    >
                      <span class="text-text-main">{c.id}</span>
                    </ListRow>
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
  const backlog = createPolledResource<MillsBacklogItem[]>('mills-backlog', loomMillsApi.backlog, { key: 'ID' });
  const items = () => backlog.data() ?? [];
  return (
    <Show when={items().length > 0} fallback={<PanelState error={backlog.error()} loaded={backlog.loaded()} empty="Backlog is empty." offlineLabel={MILLS_OFFLINE} />}>
      <div class="space-y-1">
        <For each={items()}>
          {(it) => (
            <ListRow
              trailing={
                <>
                  <Show when={it.Priority}><span class="text-[11px] text-text-dim">{it.Priority}</span></Show>
                  <Badge tone={millsStateTone(it.State)} size="sm">{it.State}</Badge>
                </>
              }
            >
              <div class="truncate text-sm text-text-main">{it.Title || it.ID}</div>
              <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
                <span class="font-mono">{it.ID}</span>
                <Show when={it.PlanID}><span>plan {it.PlanID}</span></Show>
                <Show when={it.Labels?.length}><span>{it.Labels!.join(', ')}</span></Show>
              </div>
            </ListRow>
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
  const runs = createPolledResource<MillsPipelineRun[]>('mills-pipelines', loomMillsApi.pipelineRuns, { interval: 10000, key: 'ID' });
  const [detail, setDetail] = createSignal<MillsPipelineDetail | null>(null);
  const [openErr, setOpenErr] = createSignal<string | null>(null);
  const items = () => runs.data() ?? [];

  const open = async (id: string) => {
    try {
      setDetail(await loomMillsApi.pipelineRun(id));
      setOpenErr(null);
    } catch {
      setOpenErr(`Could not load pipeline ${id}.`);
    }
  };

  return (
    <>
      <Show when={openErr()}>
        <div class="mb-1 text-xs text-status-error" role="alert">{openErr()}</div>
      </Show>
      <Show when={items().length > 0} fallback={<PanelState error={runs.error()} loaded={runs.loaded()} empty="No pipeline runs." offlineLabel={MILLS_OFFLINE} />}>
        <div class="space-y-1">
          <For each={items()}>
            {(run) => (
              <ListRow
                onClick={() => void open(run.ID)}
                trailing={
                  <>
                    <span class="text-[11px] tabular-nums text-text-dim">{formatUSD(run.CostUSD)}</span>
                    <Badge tone={millsStateTone(run.State)} size="sm">{run.State}</Badge>
                  </>
                }
              >
                <div class="truncate text-sm text-text-main">{run.BacklogID || run.ID}</div>
                <div class="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-text-muted">
                  <span class="font-mono">{run.ID}</span>
                  <Show when={run.CurrentStage}><span>@ {run.CurrentStage}</span></Show>
                  <Show when={run.Attempts}><span>attempt {run.Attempts}</span></Show>
                  <Show when={run.Depth > 0}><span>depth {run.Depth}</span></Show>
                </div>
              </ListRow>
            )}
          </For>
        </div>
      </Show>

      <Show when={detail()}>
        {(d) => (
          <DetailPanel
            title={`Pipeline ${d().run.ID}`}
            subtitle={`${d().run.BacklogID} · ${d().run.State} · ${formatUSD(d().run.CostUSD)}`}
            status={toneToPanelStatus(millsStateTone(d().run.State))}
            onClose={() => setDetail(null)}
          >
            <div class="space-y-2 px-4 py-4 sm:px-6">
              <Show when={canMutate()}>
                <div class="flex flex-wrap items-center gap-2 border-b border-white/[0.06] pb-3">
                  <span class="heading-label">Controls</span>
                  <ControlButton label="Pause" run={() => loomMillsApi.pausePipelineRun(d().run.ID)} onDone={() => void open(d().run.ID)} />
                  <ControlButton label="Resume" run={() => loomMillsApi.resumePipelineRun(d().run.ID)} onDone={() => void open(d().run.ID)} />
                  <ControlButton label="Escalate" run={() => loomMillsApi.escalatePipelineRun(d().run.ID)} onDone={() => void open(d().run.ID)} />
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
                          <span class="text-[11px] tabular-nums text-text-dim">{formatUSD(st.CostUSD)}</span>
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
  const runs = createPolledResource<MillsCouncilRun[]>('mills-council', loomMillsApi.councilRuns, { key: 'ID' });
  const [debate, setDebate] = createSignal<{ run: MillsCouncilRun; rounds: MillsDebateRound[] } | null>(null);
  const [openErr, setOpenErr] = createSignal<string | null>(null);
  const items = () => runs.data() ?? [];

  const open = async (run: MillsCouncilRun) => {
    try {
      setDebate({ run, rounds: (await loomMillsApi.councilDebate(run.ID)) ?? [] });
      setOpenErr(null);
    } catch {
      setOpenErr(`Could not load debate for ${run.ID}.`);
    }
  };

  return (
    <>
      <Show when={openErr()}>
        <div class="mb-1 text-xs text-status-error" role="alert">{openErr()}</div>
      </Show>
      <Show when={items().length > 0} fallback={<PanelState error={runs.error()} loaded={runs.loaded()} empty="No council runs." offlineLabel={MILLS_OFFLINE} />}>
        <div class="space-y-1">
          <For each={items()}>
            {(run) => (
              <ListRow
                onClick={() => void open(run)}
                trailing={<Badge tone={millsStateTone(run.Outcome)} size="sm">{run.Outcome}</Badge>}
              >
                <div class="truncate text-sm text-text-main">{run.Trigger || 'council'} <span class="font-mono text-[11px] text-text-muted">{run.ID}</span></div>
                <div class="mt-0.5 text-[11px] text-text-muted">{formatShortDateTime(run.StartedAt)} · {formatUSD(run.CostFrontierUSD + run.CostLocalUSD)}</div>
              </ListRow>
            )}
          </For>
        </div>
      </Show>

      <Show when={debate()}>
        {(d) => (
          <DetailPanel
            title={`Council ${d().run.ID}`}
            subtitle={`${d().run.Trigger} · ${d().run.Outcome}`}
            status={toneToPanelStatus(millsStateTone(d().run.Outcome))}
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
                        <span class="text-[11px] tabular-nums text-text-dim">{formatUSD(rd.CostUSD)}</span>
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
  const raw = createPolledResource<unknown>(`mills-raw-${props.id}`, () => loomMillsApi.raw(props.path), { interval: 30000, key: 'ID' });
  const items = () => (Array.isArray(raw.data()) ? (raw.data() as unknown[]) : []);
  return (
    <Show when={items().length > 0} fallback={<PanelState error={raw.error()} loaded={raw.loaded()} empty={props.empty} offlineLabel={MILLS_OFFLINE} />}>
      <div class="space-y-1">
        <For each={items()}>
          {(it) => {
            const label = () => pick(it, ['ID', 'id', 'Name', 'name', 'Title', 'title', 'Model', 'model']) || '—';
            const state = () => pick(it, ['State', 'state', 'Outcome', 'outcome', 'Kind', 'kind', 'Status', 'status', 'Severity', 'severity']);
            return (
              <ListRow class="text-sm" trailing={<Show when={state()}><Badge tone={millsStateTone(state())} size="sm">{state()}</Badge></Show>}>
                <span class="truncate text-text-main">{label()}</span>
              </ListRow>
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
      <MutationReadiness />
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
