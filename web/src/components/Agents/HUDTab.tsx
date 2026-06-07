import { batch, Component, createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { agentsApi, hudApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import { healthStore } from '../../stores/health';
import { createAsyncStatusController } from '../../lib/asyncState';
import type { HUDAgentPresence, HUDClaim, HUDTask, HUDWorkflow, HUDTimelineEvent, HUDHandoff } from '../../lib/types';
import HUDActivityFeed from './HUDActivityFeed';
import { getHudModeState } from '../../lib/featureFlags';
import {
  feedConnectionLabel,
  feedConnectionState,
  hasDegradedHUDFeed,
  HUD_PULL_STALE_THRESHOLD_MS,
  type FeedConnectionState,
} from './hudDegradedMode';
import {
  applyWorkflowCancel,
  countClaimConflicts,
  extractItems,
  getClaimField,
  groupClaimsByAgent,
  normalizePresenceFromPush,
  toErrorMessage,
} from './hudUtils';
import HUDConsoleScaffold, { type HUDConsoleMetric } from '../LoomHUD/HUDConsoleScaffold';

type HUDTabFocus = 'full' | 'overview' | 'presence' | 'workflows' | 'handoffs' | 'claims' | 'timeline';

interface HUDTabProps {
  focus?: HUDTabFocus;
}

const HUDTab: Component<HUDTabProps> = (props) => {
  const [presence, setPresence] = createSignal<HUDAgentPresence[]>([]);
  const [claims, setClaims] = createSignal<HUDClaim[]>([]);
  const [tasks, setTasks] = createSignal<HUDTask[]>([]);
  const [workflows, setWorkflows] = createSignal<HUDWorkflow[]>([]);
  const [timeline, setTimeline] = createSignal<HUDTimelineEvent[]>([]);
  const [handoffs, setHandoffs] = createSignal<HUDHandoff[]>([]);
  const asyncState = createAsyncStatusController({
    workflowAction: null as string | null,
    handoffAction: null as string | null,
    eventsConnection: 'disabled' as FeedConnectionState,
    lastSuccessfulPull: 0,
    now: Date.now(),
  });
  const state = asyncState.state;
  const patchState = asyncState.patch;

  const hudMode = createMemo(() => getHudModeState(healthStore.features || {}));
  const pullEnabled = () => hudMode().pullEnabled;
  const pushEnabled = () => hudMode().pushEnabled;

  const fetchAllPull = async () => {
    const [fleetResult, workflowsResult, timelineResult, handoffsResult] = await Promise.allSettled([
      hudApi.fleet(),
      hudApi.workflows(),
      hudApi.timeline(),
      hudApi.handoffs(),
    ]);

    batch(() => {
      if (fleetResult.status === 'fulfilled') {
        setPresence(extractItems<HUDAgentPresence>(fleetResult.value, 'agents'));
        setClaims(extractItems<HUDClaim>(fleetResult.value, 'claims'));
        setTasks(extractItems<HUDTask>(fleetResult.value, 'tasks'));
      }
      if (workflowsResult.status === 'fulfilled') setWorkflows(extractItems<HUDWorkflow>(workflowsResult.value, 'workflows'));
      if (timelineResult.status === 'fulfilled') setTimeline(extractItems<HUDTimelineEvent>(timelineResult.value, 'events'));
      if (handoffsResult.status === 'fulfilled') setHandoffs(extractItems<HUDHandoff>(handoffsResult.value, 'handoffs'));
    });

    // Handoffs are supplementary — a handoff failure must not blank the HUD, so
    // only treat the core fleet/workflow/timeline trio as fatal when all fail.
    const failed = [fleetResult, workflowsResult, timelineResult]
      .filter((result) => result.status === 'rejected');

    if (failed.length === 3) {
      const reason = failed[0] as PromiseRejectedResult;
      throw new Error(toErrorMessage(reason.reason, 'Failed to fetch HUD pull data'));
    }

    patchState({
      lastSuccessfulPull: Date.now(),
      error: '',
    });
  };

  const fetchAllPush = async () => {
    const response = await agentsApi.list();
    const agents = Array.isArray(response?.agents) ? response.agents : [];
    setPresence(normalizePresenceFromPush(agents as Array<Record<string, unknown>>));
    setClaims([]);
    setTasks([]);
    setWorkflows([]);
    setTimeline([]);
    setHandoffs([]);
    patchState({ error: '' });
  };

  const fetchAll = async () => {
    asyncState.start();
    try {
      if (pullEnabled()) {
        await fetchAllPull();
      } else if (pushEnabled()) {
        await fetchAllPush();
      } else {
        asyncState.fail(hudMode().disabledReason || 'Loom HUD is disabled');
      }
    } catch (err) {
      asyncState.fail(toErrorMessage(err, 'Failed to fetch HUD data'));
      return;
    }
    asyncState.succeed();
  };

  const handleApprove = async (id: string) => {
    patchState({ workflowAction: `approve:${id}` });
    try {
      await hudApi.approveWorkflow(id);
      await fetchAll();
    } catch (err) {
      patchState({ error: toErrorMessage(err, 'Failed to approve workflow') });
    } finally {
      patchState({ workflowAction: null });
    }
  };

  const handleReject = async (id: string) => {
    patchState({ workflowAction: `reject:${id}` });
    try {
      await hudApi.rejectWorkflow(id);
      await fetchAll();
    } catch (err) {
      patchState({ error: toErrorMessage(err, 'Failed to reject workflow') });
    } finally {
      patchState({ workflowAction: null });
    }
  };

  const handleCancel = async (id: string) => {
    patchState({ workflowAction: `cancel:${id}` });
    try {
      await hudApi.cancelWorkflow(id, 'Cancelled from FlexDeck HUD panel');
      setWorkflows((current) => applyWorkflowCancel(current, id));
      await fetchAll();
    } catch (err) {
      patchState({ error: toErrorMessage(err, 'Failed to cancel workflow') });
    } finally {
      patchState({ workflowAction: null });
    }
  };

  const handleAcceptHandoff = async (handoff: HUDHandoff) => {
    patchState({ handoffAction: `accept:${handoff.id}` });
    try {
      const target = handoff.targetAgentId || handoff.toAgent;
      await hudApi.acceptHandoff(handoff.id, target ? { target_agent_id: target, import_entries: true } : { import_entries: true });
      await fetchAll();
    } catch (err) {
      patchState({ error: toErrorMessage(err, 'Failed to accept handoff') });
    } finally {
      patchState({ handoffAction: null });
    }
  };

  const handleRejectHandoff = async (handoff: HUDHandoff) => {
    patchState({ handoffAction: `reject:${handoff.id}` });
    try {
      await hudApi.rejectHandoff(handoff.id, 'Declined from FlexDeck HUD');
      await fetchAll();
    } catch (err) {
      patchState({ error: toErrorMessage(err, 'Failed to reject handoff') });
    } finally {
      patchState({ handoffAction: null });
    }
  };

  // Relative age label driven by the shared 5s `now` ticker so it stays fresh
  // without its own timer.
  const relativeAge = (iso: string | undefined): string => {
    if (!iso) return 'no signal';
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return 'no signal';
    const age = Math.max(0, state.now - parsed);
    if (age < 10_000) return 'live';
    if (age < 60_000) return `${Math.floor(age / 1000)}s ago`;
    if (age < 3_600_000) return `${Math.floor(age / 60_000)}m ago`;
    if (age < 86_400_000) return `${Math.floor(age / 3_600_000)}h ago`;
    return `${Math.floor(age / 86_400_000)}d ago`;
  };

  createPolling('agents-hud-pull', fetchAll, 15000, true, false);

  createPolling('hud-now-ticker', () => { patchState({ now: Date.now() }); }, 5000);

  createEffect(() => {
    if (!pullEnabled()) {
      patchState({ eventsConnection: 'disabled' });
    } else if (state.eventsConnection === 'disabled') {
      patchState({ eventsConnection: 'connecting' });
    }
  });

  const statusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-status-ok';
      case 'idle': return 'bg-yellow-400';
      case 'offline': return 'bg-white/30';
      default: return 'bg-white/20';
    }
  };

  const taskStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-status-ok';
      case 'in_progress': return 'text-white';
      case 'blocked': return 'text-status-error';
      default: return 'text-text-dim';
    }
  };

  const activePresence = () => presence().filter((agent) => agent.status === 'active').length;
  const idlePresence = () => presence().filter((agent) => agent.status === 'idle').length;
  const offlinePresence = () => presence().filter((agent) => agent.status === 'offline').length;
  const pendingTasks = () => tasks().filter((task) => task.status === 'pending');
  const inProgressTasks = () => tasks().filter((task) => task.status === 'in_progress');
  const completedTasks = () => tasks().filter((task) => task.status === 'completed').slice(0, 10);
  const awaitingApprovalWorkflows = () => workflows().filter((workflow) => workflow.status === 'awaiting_approval' || workflow.steps[workflow.currentStep]?.requiresApproval).length;
  const isHandoffActionable = (status: string) => {
    const normalized = (status || '').toLowerCase();
    return normalized === '' || normalized === 'pending' || normalized === 'viewed' || normalized === 'created' || normalized === 'offered';
  };
  const pendingHandoffs = () => handoffs().filter((handoff) => isHandoffActionable(handoff.status));

  const claimsByAgent = () => {
    return groupClaimsByAgent(claims());
  };
  const claimConflictCount = () => countClaimConflicts(claims());
  const taskBacklog = () => pendingTasks().length + inProgressTasks().length;
  const feedStateLabel = () => feedConnectionLabel(state.eventsConnection);
  const feedStateTone = (): HUDConsoleMetric['tone'] => {
    const feedState = feedConnectionState(state.eventsConnection);
    if (feedState === 'ready') return 'ok';
    if (feedState === 'fallback' || feedState === 'stale') return 'warn';
    return 'cyan';
  };

  const hasStaleWarning = () =>
    hasDegradedHUDFeed(pullEnabled(), state.eventsConnection, state.lastSuccessfulPull, state.now);
  const hasInitialData = () =>
    presence().length > 0 ||
    claims().length > 0 ||
    tasks().length > 0 ||
    workflows().length > 0 ||
    timeline().length > 0;
  const isInitialLoading = () => state.loading && !state.error && !hasInitialData();
  const metrics = (): HUDConsoleMetric[] => [
    {
      label: 'Presence',
      value: `${activePresence()}/${presence().length}`,
      detail: `${idlePresence()} idle · ${offlinePresence()} offline`,
      tone: activePresence() > 0 ? 'ok' : 'warn',
    },
    {
      label: 'Claims',
      value: `${claims().length}`,
      detail: `${claimConflictCount()} conflict${claimConflictCount() === 1 ? '' : 's'}`,
      tone: claimConflictCount() > 0 ? 'error' : 'cyan',
    },
    {
      label: 'Tasks',
      value: `${taskBacklog()}`,
      detail: `${pendingTasks().length} pending · ${inProgressTasks().length} running`,
      tone: taskBacklog() > 0 ? 'purple' : 'cyan',
    },
    {
      label: 'Workflows',
      value: `${workflows().length}`,
      detail: `${awaitingApprovalWorkflows()} awaiting approval`,
      tone: awaitingApprovalWorkflows() > 0 ? 'warn' : 'ok',
    },
    {
      label: 'Handoffs',
      value: `${pendingHandoffs().length}`,
      detail: `${handoffs().length} total`,
      tone: pendingHandoffs().length > 0 ? 'warn' : 'cyan',
    },
    {
      label: 'Timeline',
      value: `${timeline().length}`,
      detail: feedStateLabel(),
      tone: feedStateTone(),
    },
  ];
  const focus = () => props.focus ?? 'full';
  const showOverview = () => focus() === 'overview';
  const showPresence = () => focus() === 'full' || focus() === 'presence';
  const showWorkflows = () => focus() === 'full' || focus() === 'workflows';
  const showHandoffs = () => focus() === 'full' || focus() === 'handoffs';
  const showClaims = () => focus() === 'full' || focus() === 'claims';
  const showTimeline = () => focus() === 'full' || focus() === 'timeline';
  const useSplitLayout = () => focus() === 'full';
  const nextWorkflow = () => workflows().find((workflow) => workflow.status === 'awaiting_approval') || workflows()[0];
  const latestTimelineEvent = () => timeline()[0];

  const overviewPanel = () => (
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <OverviewSignalCard
        label="Presence"
        value={`${activePresence()}/${presence().length || 0}`}
        detail={`${idlePresence()} idle · ${offlinePresence()} offline`}
        tone={activePresence() > 0 ? 'text-status-ok' : 'text-status-warn'}
      />
      <OverviewSignalCard
        label="Task backlog"
        value={`${taskBacklog()}`}
        detail={`${pendingTasks().length} pending · ${inProgressTasks().length} active`}
        tone={taskBacklog() > 0 ? 'text-white' : 'text-text-main'}
      />
      <OverviewSignalCard
        label="Approvals"
        value={`${awaitingApprovalWorkflows()}`}
        detail={nextWorkflow() ? nextWorkflow()!.definitionId : 'None waiting'}
        tone={awaitingApprovalWorkflows() > 0 ? 'text-status-warn' : 'text-status-ok'}
      />
      <OverviewSignalCard
        label="Handoffs"
        value={`${pendingHandoffs().length}`}
        detail={pendingHandoffs().length > 0 ? `${pendingHandoffs()[0].fromAgent} → ${pendingHandoffs()[0].toAgent || pendingHandoffs()[0].targetAgentId || '—'}` : 'Inbox clear'}
        tone={pendingHandoffs().length > 0 ? 'text-status-warn' : 'text-status-ok'}
      />
      <OverviewSignalCard
        label="Feed health"
        value={feedStateLabel()}
        detail={latestTimelineEvent()?.summary || 'No events yet'}
        tone={feedStateTone() === 'ok' ? 'text-status-ok' : feedStateTone() === 'warn' ? 'text-status-warn' : 'text-white'}
      />
    </div>
  );

  const presencePanel = () => (
    <div class="space-y-4">
      <div class="surface p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h3 class="heading-section">Presence map</h3>
          <span class="text-xs font-mono text-text-dim tabular-nums">
            {presence().length}
          </span>
        </div>
        <Show when={presence().length === 0}>
          <div class="rounded-md border border-dashed border-white/10 px-3 py-3 text-xs text-text-dim">
            No agents online
          </div>
        </Show>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <For each={presence()}>
            {(agent) => (
              <div class="rounded-xl border border-white/8 bg-white/5 p-3">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class={`h-2.5 w-2.5 rounded-full ${statusColor(agent.status)} ${agent.status === 'active' ? 'animate-pulse' : ''}`} />
                      <span class="truncate font-mono text-sm text-text-main">{agent.agentId}</span>
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-text-dim">
                      <span class="rounded-full bg-black/20 px-2 py-0.5 uppercase tracking-[0.16em]">{agent.agentType}</span>
                      <span class="capitalize">{agent.status}</span>
                    </div>
                  </div>
                  <span class="whitespace-nowrap text-[10px] text-text-dim" title={agent.lastHeartbeat || undefined}>
                    {relativeAge(agent.lastHeartbeat)}
                  </span>
                </div>

                <Show when={agent.activeFiles.length > 0}>
                  <div class="mt-3 rounded-lg bg-black/20 px-2 py-2">
                    <div class="text-[10px] uppercase tracking-[0.18em] text-text-dim">Active files</div>
                    <div class="mt-1 space-y-0.5">
                      <For each={agent.activeFiles.slice(0, 3)}>
                        {(file) => <div class="truncate font-mono text-[11px] text-text-muted">{file}</div>}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={agent.conflicts.length > 0}>
                  <div class="mt-2 rounded-lg border border-status-error/20 bg-status-error/10 px-2 py-2 text-xs text-status-error">
                    {agent.conflicts.length} conflict{agent.conflicts.length === 1 ? '' : 's'} detected
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="surface p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h3 class="heading-section">Task board</h3>
          <span class="text-xs font-mono text-text-dim tabular-nums">
            {taskBacklog()} open
          </span>
        </div>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <div class="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-dim">Pending ({pendingTasks().length})</div>
            <div class="flex flex-col gap-2">
              <For each={pendingTasks()}>
                {(task) => <TaskCard task={task} statusColor={taskStatusColor} />}
              </For>
              <Show when={pendingTasks().length === 0}>
                <div class="rounded-lg border border-dashed border-white/10 bg-white/5 px-3 py-4 text-xs text-text-dim">
                  No pending tasks
                </div>
              </Show>
            </div>
          </div>
          <div>
            <div class="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-dim">In Progress ({inProgressTasks().length})</div>
            <div class="flex flex-col gap-2">
              <For each={inProgressTasks()}>
                {(task) => <TaskCard task={task} statusColor={taskStatusColor} />}
              </For>
              <Show when={inProgressTasks().length === 0}>
                <div class="rounded-lg border border-dashed border-white/10 bg-white/5 px-3 py-4 text-xs text-text-dim">
                  None active
                </div>
              </Show>
            </div>
          </div>
          <div>
            <div class="mb-2 text-[10px] uppercase tracking-[0.18em] text-text-dim">Completed ({completedTasks().length})</div>
            <div class="flex flex-col gap-2">
              <For each={completedTasks()}>
                {(task) => <TaskCard task={task} statusColor={taskStatusColor} />}
              </For>
              <Show when={completedTasks().length === 0}>
                <div class="rounded-lg border border-dashed border-white/10 bg-white/5 px-3 py-4 text-xs text-text-dim">
                  No recent completions
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const claimsPanel = () => (
    <Show when={pullEnabled()} fallback={
      <div class="surface p-4 text-sm text-text-dim">
        Push mode — claims unavailable
      </div>
    }>
      <div class="surface p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h3 class="heading-section">Claim ledger</h3>
          <Show when={claimConflictCount() > 0}>
            <span class="text-xs text-status-error">
              {claimConflictCount()} conflict{claimConflictCount() === 1 ? '' : 's'}
            </span>
          </Show>
        </div>

        <Show when={claims().length === 0}>
          <div class="rounded-md border border-dashed border-white/10 px-3 py-3 text-xs text-text-dim">
            No active claims
          </div>
        </Show>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Show when={claims().length > 0}>
            <For each={Object.entries(claimsByAgent())}>
              {([agentId, agentClaims]) => (
                <div class="rounded-xl border border-white/8 bg-white/5 p-3">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <div class="text-xs font-mono text-text-main">{agentId}</div>
                    <div class="text-[10px] text-text-dim">{agentClaims.length} files</div>
                  </div>
                  <div class="flex max-h-32 flex-col gap-1 overflow-y-auto">
                    <For each={agentClaims}>
                      {(claim) => (
                        <div class={`truncate font-mono text-[11px] ${claim.stale ? 'text-status-warn' : 'text-text-dim'}`}>
                          {getClaimField(claim, ['filePath', 'file_path'], 'unknown-file')}
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </Show>
  );

  const workflowsPanel = () => (
    <Show when={pullEnabled()} fallback={
      <div class="surface p-4 text-sm text-text-dim">
        Push mode — workflows unavailable
      </div>
    }>
      <div class="surface p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h3 class="heading-section">Workflow queue</h3>
          <span class="text-xs font-mono text-text-dim tabular-nums">
            {awaitingApprovalWorkflows()} waiting
          </span>
        </div>

        <Show when={workflows().length > 0} fallback={
          <div class="rounded-md border border-dashed border-white/10 px-3 py-3 text-xs text-text-dim">
            No active workflows
          </div>
        }>
          <div class="flex flex-col gap-3">
            <For each={workflows()}>
              {(wf) => (
                <div class="rounded-xl border border-white/8 bg-white/5 p-3">
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <div class="flex min-w-0 items-center gap-2">
                      <span class="truncate text-sm font-mono text-text-main">{wf.definitionId}</span>
                      <span class="rounded-full bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-text-dim">{wf.status}</span>
                    </div>
                    <span class="text-[10px] text-text-dim">{new Date(wf.startedAt).toLocaleString()}</span>
                  </div>

                  <WorkflowPhaseDetail workflow={wf} />

                  <div class="flex flex-wrap gap-2">
                    <Show when={wf.steps[wf.currentStep]?.requiresApproval && wf.status === 'awaiting_approval'}>
                      <button
                        type="button"
                        onClick={() => handleApprove(wf.id)}
                        disabled={state.workflowAction === `approve:${wf.id}`}
                        class="rounded-md bg-status-ok/20 px-3 py-1.5 text-xs font-medium text-status-ok transition-colors hover:bg-status-ok/30 disabled:opacity-50"
                      >
                        {state.workflowAction === `approve:${wf.id}` ? 'Approving...' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReject(wf.id)}
                        disabled={state.workflowAction === `reject:${wf.id}`}
                        class="rounded-md bg-status-error/20 px-3 py-1.5 text-xs font-medium text-status-error transition-colors hover:bg-status-error/30 disabled:opacity-50"
                      >
                        {state.workflowAction === `reject:${wf.id}` ? 'Rejecting...' : 'Reject'}
                      </button>
                    </Show>
                    <button
                      type="button"
                      onClick={() => handleCancel(wf.id)}
                      disabled={state.workflowAction === `cancel:${wf.id}`}
                      class="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-text-main transition-colors hover:bg-white/20 disabled:opacity-50"
                    >
                      {state.workflowAction === `cancel:${wf.id}` ? 'Cancelling...' : 'Cancel'}
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );

  const handoffsPanel = () => (
    <Show when={pullEnabled()} fallback={
      <div class="surface p-4 text-sm text-text-dim">
        Push mode — handoffs unavailable
      </div>
    }>
      <div class="surface p-4">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h3 class="heading-section">Handoff inbox</h3>
          <span class="text-xs font-mono text-text-dim tabular-nums">
            {pendingHandoffs().length} pending
          </span>
        </div>

        <Show when={handoffs().length > 0} fallback={
          <div class="rounded-md border border-dashed border-white/10 px-3 py-3 text-xs text-text-dim">
            No handoffs in flight
          </div>
        }>
          <div class="flex flex-col gap-3">
            <For each={handoffs()}>
              {(handoff) => {
                const acceptKey = () => `accept:${handoff.id}`;
                const rejectKey = () => `reject:${handoff.id}`;
                const busy = () => state.handoffAction === acceptKey() || state.handoffAction === rejectKey();
                return (
                  <div class="rounded-xl border border-white/8 bg-white/5 p-3">
                    <div class="mb-2 flex items-start justify-between gap-2">
                      <div class="flex min-w-0 items-center gap-1.5 font-mono text-sm text-text-main">
                        <span class="truncate">{handoff.fromAgent || 'unknown'}</span>
                        <span class="text-text-dim" aria-hidden="true">{'→'}</span>
                        <span class="truncate">{handoff.toAgent || handoff.targetAgentId || 'unassigned'}</span>
                      </div>
                      <span class={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${handoffStatusTone(handoff.status)}`}>
                        {handoffStatusLabel(handoff.status)}
                      </span>
                    </div>

                    <Show when={handoff.summary}>
                      <p class="mb-2 line-clamp-3 text-xs text-text-muted">{handoff.summary}</p>
                    </Show>

                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span class="text-[10px] text-text-dim">
                        <Show when={handoff.createdAt} fallback="just now">
                          received {relativeAge(handoff.createdAt)}
                        </Show>
                      </span>
                      <Show when={isHandoffActionable(handoff.status)} fallback={
                        <span class="text-[10px] uppercase tracking-[0.14em] text-text-dim">
                          {handoff.acceptedAt ? `accepted ${relativeAge(handoff.acceptedAt)}` : 'closed'}
                        </span>
                      }>
                        <div class="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleAcceptHandoff(handoff)}
                            disabled={busy()}
                            class="rounded-md bg-status-ok/20 px-3 py-1.5 text-xs font-medium text-status-ok transition-colors hover:bg-status-ok/30 disabled:opacity-50"
                          >
                            {state.handoffAction === acceptKey() ? 'Accepting...' : 'Accept'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectHandoff(handoff)}
                            disabled={busy()}
                            class="rounded-md bg-status-error/20 px-3 py-1.5 text-xs font-medium text-status-error transition-colors hover:bg-status-error/30 disabled:opacity-50"
                          >
                            {state.handoffAction === rejectKey() ? 'Rejecting...' : 'Reject'}
                          </button>
                        </div>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  );

  const timelinePanel = () => (
    <HUDActivityFeed
      initialEvents={timeline()}
      enabled={pullEnabled()}
      emptyMessage="No events"
      onConnectionStateChange={(connection) => patchState({ eventsConnection: connection })}
    />
  );

  onMount(() => {
    void fetchAll();
  });

  return (
    <div class="flex flex-col gap-4">
      <HUDConsoleScaffold
        title="HUD"
        subtitle={hudMode().modeLabel || 'Live operations'}
        badge={undefined}
        modeLabel={hudMode().modeLabel}
        modeDescription={hudMode().modeDescription}
        metrics={metrics()}
        actions={[
          { label: state.refreshing ? 'Refreshing...' : 'Refresh HUD', onClick: fetchAll, variant: 'primary', disabled: state.loading || state.refreshing },
          { label: state.refreshing ? 'Refreshing...' : 'Reload timeline', onClick: fetchAll, variant: 'secondary', disabled: state.loading || state.refreshing },
        ]}
        alert={hasStaleWarning() ? {
          title: 'Degraded feed',
          message: `Live HUD data may lag. Timeline state is ${feedStateLabel().toLowerCase()} and workflow freshness should be treated as advisory after ${Math.floor(HUD_PULL_STALE_THRESHOLD_MS / 1000)}s.`,
          tone: 'warn',
        } : state.error ? {
          title: 'HUD error',
          message: state.error,
          tone: 'error',
        } : undefined}
      >
        <Show when={isInitialLoading()}>
          <div class="flex items-center justify-center py-10">
            <div class="text-text-dim animate-pulse text-sm">Loading...</div>
          </div>
        </Show>

        <Show when={!isInitialLoading()}>
          <Show when={showOverview()}>
            {overviewPanel()}
          </Show>

          <Show when={useSplitLayout()}>
            <div class="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.9fr)]">
              <div class="space-y-4">
                <Show when={showPresence()}>
                  {presencePanel()}
                </Show>
                <Show when={showClaims()}>
                  {claimsPanel()}
                </Show>
              </div>
              <div class="space-y-4">
                <Show when={showWorkflows()}>
                  {workflowsPanel()}
                </Show>
                <Show when={showHandoffs()}>
                  {handoffsPanel()}
                </Show>
                <Show when={showTimeline()}>
                  {timelinePanel()}
                </Show>
              </div>
            </div>
          </Show>

          <Show when={!useSplitLayout() && !showOverview()}>
            <div class="space-y-4">
              <Show when={showPresence()}>
                {presencePanel()}
              </Show>
              <Show when={showWorkflows()}>
                {workflowsPanel()}
              </Show>
              <Show when={showHandoffs()}>
                {handoffsPanel()}
              </Show>
              <Show when={showClaims()}>
                {claimsPanel()}
              </Show>
              <Show when={showTimeline()}>
                {timelinePanel()}
              </Show>
            </div>
          </Show>
        </Show>
      </HUDConsoleScaffold>
    </div>
  );
};

const OverviewSignalCard: Component<{
  label: string;
  value: string;
  detail: string;
  tone: string;
}> = (props) => (
  <div class="surface px-4 py-3">
    <div class="heading-label">{props.label}</div>
    <div class={`mt-1.5 text-xl font-semibold tabular-nums ${props.tone}`}>{props.value}</div>
    <div class="mt-0.5 text-xs text-text-dim">{props.detail}</div>
  </div>
);

const TaskCard: Component<{
  task: HUDTask;
  statusColor: (status: string) => string;
}> = (props) => (
  <div class="rounded bg-white/5 p-2 border border-white/5">
    <div class="flex items-center gap-2 mb-1">
      <span class={`text-xs font-medium ${props.statusColor(props.task.status)}`}>
        {props.task.status === 'in_progress' ? '\u25B6' : props.task.status === 'completed' ? '\u2713' : '\u25CB'}
      </span>
      <span class="text-xs text-text-main truncate">{props.task.title}</span>
    </div>
    <div class="flex items-center gap-2 text-[10px] text-text-dim">
      <Show when={props.task.agentId}>
        <span class="font-mono">{props.task.agentId}</span>
      </Show>
      <Show when={props.task.priority > 0}>
        <span>P{props.task.priority}</span>
      </Show>
    </div>
    <Show when={props.task.filePath}>
      <div class="text-[10px] font-mono text-text-dim truncate mt-0.5">{props.task.filePath}</div>
    </Show>
  </div>
);

const WorkflowPhaseDetail: Component<{
  workflow: HUDWorkflow;
}> = (props) => {
  const steps = () => props.workflow.steps || [];
  const currentStep = () => steps()[props.workflow.currentStep];
  const completedSteps = () => steps().filter((step) => step.status === 'completed').length;

  return (
    <div class="mb-3 space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wide text-text-dim">
        <span>Phase detail</span>
        <span class="font-mono normal-case tracking-normal">
          {completedSteps()}/{steps().length} complete
        </span>
      </div>

      <div class="grid gap-1.5" style={{ 'grid-template-columns': `repeat(${Math.max(steps().length, 1)}, minmax(0, 1fr))` }}>
        <For each={steps()}>
          {(step, i) => (
            <div
              class={`h-2 rounded-full ${workflowStepRailClass(step.status, i() === props.workflow.currentStep)}`}
              title={`${i() + 1}. ${step.name}: ${step.status}`}
              aria-label={`${step.name}: ${step.status}`}
            />
          )}
        </For>
      </div>

      <Show when={currentStep()} fallback={
        <div class="rounded-md border border-white/8 bg-white/5 px-3 py-2 text-xs text-text-dim">
          No active workflow step
        </div>
      }>
        {(step) => (
          <div class="rounded-md border border-white/8 bg-white/5 px-3 py-2">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="heading-label">Current phase</div>
                <div class="mt-1 truncate text-sm font-medium text-text-main">
                  {step().name}
                </div>
              </div>
              <div class="flex flex-wrap justify-end gap-1.5">
                <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${workflowStatusTone(step().status)}`}>
                  {workflowStatusLabel(step().status)}
                </span>
                <Show when={step().requiresApproval}>
                  <span class="rounded-full bg-status-warn/15 px-2 py-0.5 text-[10px] font-medium text-status-warn">
                    Approval required
                  </span>
                </Show>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};

function workflowStepRailClass(status: string, isCurrent: boolean): string {
  if (status === 'completed') return 'bg-status-ok';
  if (status === 'failed') return 'bg-status-error';
  if (status === 'running' || status === 'in_progress') return 'bg-white/45 animate-pulse';
  if (isCurrent) return 'bg-status-warn/60';
  return 'bg-white/10';
}

function workflowStatusTone(status: string): string {
  switch (status) {
    case 'completed':
      return 'bg-status-ok/20 text-status-ok';
    case 'failed':
      return 'bg-status-error/20 text-status-error';
    case 'running':
    case 'in_progress':
      return 'bg-white/10 text-white';
    case 'awaiting_approval':
    case 'pending':
      return 'bg-status-warn/15 text-status-warn';
    case 'canceled':
    case 'cancelled':
      return 'bg-white/10 text-text-muted';
    default:
      return 'bg-white/10 text-text-dim';
  }
}

function workflowStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

function handoffStatusTone(status: string): string {
  switch ((status || '').toLowerCase()) {
    case 'accepted':
      return 'bg-status-ok/20 text-status-ok';
    case 'rejected':
    case 'expired':
      return 'bg-status-error/20 text-status-error';
    case 'viewed':
      return 'bg-white/10 text-white';
    case '':
    case 'pending':
    case 'created':
    case 'offered':
      return 'bg-status-warn/15 text-status-warn';
    default:
      return 'bg-white/10 text-text-dim';
  }
}

function handoffStatusLabel(status: string): string {
  const normalized = (status || '').trim();
  if (normalized === '') return 'pending';
  return normalized.replace(/_/g, ' ');
}

export default HUDTab;
