import { Component, createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js';
import { agentsApi, hudApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import { healthStore } from '../../stores/health';
import type { HUDAgentPresence, HUDClaim, HUDTask, HUDWorkflow, HUDTimelineEvent } from '../../lib/types';
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

const HUDTab: Component = () => {
  const [presence, setPresence] = createSignal<HUDAgentPresence[]>([]);
  const [claims, setClaims] = createSignal<HUDClaim[]>([]);
  const [tasks, setTasks] = createSignal<HUDTask[]>([]);
  const [workflows, setWorkflows] = createSignal<HUDWorkflow[]>([]);
  const [timeline, setTimeline] = createSignal<HUDTimelineEvent[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [workflowAction, setWorkflowAction] = createSignal<string | null>(null);
  const [eventsConnection, setEventsConnection] = createSignal<FeedConnectionState>('disabled');
  const [lastSuccessfulPull, setLastSuccessfulPull] = createSignal<number>(0);
  const [now, setNow] = createSignal(Date.now());

  const hudMode = createMemo(() => getHudModeState(healthStore.features || {}));
  const pullEnabled = () => hudMode().pullEnabled;
  const pushEnabled = () => hudMode().pushEnabled;

  const fetchAllPull = async () => {
    const [presenceResult, claimsResult, tasksResult, workflowsResult, timelineResult] = await Promise.allSettled([
      hudApi.presence(),
      hudApi.claims(),
      hudApi.tasks(),
      hudApi.workflows(),
      hudApi.timeline(),
    ]);

    if (presenceResult.status === 'fulfilled') setPresence(extractItems<HUDAgentPresence>(presenceResult.value, 'agents'));
    if (claimsResult.status === 'fulfilled') setClaims(extractItems<HUDClaim>(claimsResult.value, 'claims'));
    if (tasksResult.status === 'fulfilled') setTasks(extractItems<HUDTask>(tasksResult.value, 'tasks'));
    if (workflowsResult.status === 'fulfilled') setWorkflows(extractItems<HUDWorkflow>(workflowsResult.value, 'workflows'));
    if (timelineResult.status === 'fulfilled') setTimeline(extractItems<HUDTimelineEvent>(timelineResult.value, 'events'));

    const failed = [presenceResult, claimsResult, tasksResult, workflowsResult, timelineResult]
      .filter((result) => result.status === 'rejected');

    if (failed.length === 5) {
      const reason = failed[0] as PromiseRejectedResult;
      throw new Error(toErrorMessage(reason.reason, 'Failed to fetch HUD pull data'));
    }

    setLastSuccessfulPull(Date.now());
    setError('');
  };

  const fetchAllPush = async () => {
    const response = await agentsApi.list();
    const agents = Array.isArray(response?.agents) ? response.agents : [];
    setPresence(normalizePresenceFromPush(agents as Array<Record<string, unknown>>));
    setClaims([]);
    setTasks([]);
    setWorkflows([]);
    setTimeline([]);
    setError('');
  };

  const fetchAll = async () => {
    try {
      if (pullEnabled()) {
        await fetchAllPull();
      } else if (pushEnabled()) {
        await fetchAllPush();
      } else {
        setError(hudMode().disabledReason || 'Loom HUD is disabled');
      }
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to fetch HUD data'));
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    setWorkflowAction(`approve:${id}`);
    try {
      await hudApi.approveWorkflow(id);
      await fetchAll();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to approve workflow'));
    } finally {
      setWorkflowAction(null);
    }
  };

  const handleReject = async (id: string) => {
    setWorkflowAction(`reject:${id}`);
    try {
      await hudApi.rejectWorkflow(id);
      await fetchAll();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to reject workflow'));
    } finally {
      setWorkflowAction(null);
    }
  };

  const handleCancel = async (id: string) => {
    setWorkflowAction(`cancel:${id}`);
    try {
      await hudApi.cancelWorkflow(id, 'Cancelled from FlexDeck HUD panel');
      setWorkflows((current) => applyWorkflowCancel(current, id));
      await fetchAll();
    } catch (err) {
      setError(toErrorMessage(err, 'Failed to cancel workflow'));
    } finally {
      setWorkflowAction(null);
    }
  };

  createPolling('agents-hud-pull', fetchAll, 15000);

  createPolling('hud-now-ticker', () => { setNow(Date.now()); }, 5000);

  createEffect(() => {
    if (!pullEnabled()) {
      setEventsConnection('disabled');
    } else if (eventsConnection() === 'disabled') {
      setEventsConnection('connecting');
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
      case 'in_progress': return 'text-neon-cyan';
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

  const claimsByAgent = () => {
    return groupClaimsByAgent(claims());
  };
  const claimConflictCount = () => countClaimConflicts(claims());
  const taskBacklog = () => pendingTasks().length + inProgressTasks().length;
  const feedStateLabel = () => feedConnectionLabel(eventsConnection());
  const feedStateTone = (): HUDConsoleMetric['tone'] => {
    const state = feedConnectionState(eventsConnection());
    if (state === 'ready') return 'ok';
    if (state === 'fallback' || state === 'stale') return 'warn';
    return 'cyan';
  };

  const hasStaleWarning = () =>
    hasDegradedHUDFeed(pullEnabled(), eventsConnection(), lastSuccessfulPull(), now());
  const hasInitialData = () =>
    presence().length > 0 ||
    claims().length > 0 ||
    tasks().length > 0 ||
    workflows().length > 0 ||
    timeline().length > 0;
  const isInitialLoading = () => loading() && !error() && !hasInitialData();
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
      label: 'Timeline',
      value: `${timeline().length}`,
      detail: feedStateLabel(),
      tone: feedStateTone(),
    },
  ];

  onMount(() => {
    void fetchAll();
  });

  return (
    <div class="flex flex-col gap-4">
      <HUDConsoleScaffold
        title="Live HUD operations"
        subtitle="Loom HUD turns the old registry page into a control surface. Presence, claim pressure, task backlog, approvals, and feed health are surfaced first, with registry tooling kept as a secondary path."
        badge={hudMode().modeLabel}
        modeLabel={hudMode().modeLabel}
        modeDescription={hudMode().modeDescription}
        metrics={metrics()}
        actions={[
          { label: 'Refresh HUD', onClick: fetchAll, variant: 'primary', disabled: loading() },
          { label: 'Reload timeline', onClick: fetchAll, variant: 'secondary', disabled: loading() },
        ]}
        alert={hasStaleWarning() ? {
          title: 'Degraded feed',
          message: `Live HUD data may lag. Timeline state is ${feedStateLabel().toLowerCase()} and workflow freshness should be treated as advisory after ${Math.floor(HUD_PULL_STALE_THRESHOLD_MS / 1000)}s.`,
          tone: 'warn',
        } : error() ? {
          title: 'HUD error',
          message: error(),
          tone: 'error',
        } : undefined}
      >
        <Show when={isInitialLoading()}>
          <div class="glass-panel flex items-center justify-center py-10">
            <div class="text-text-dim animate-pulse">Loading HUD signals...</div>
          </div>
        </Show>

        <Show when={!isInitialLoading()}>
          <div class="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.9fr)]">
          <div class="space-y-4">
            <div class="glass-panel p-4">
              <div class="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-sm font-medium text-text-main">Presence map</h3>
                  <p class="text-[11px] text-text-dim">Who is active, what they are editing, and where pressure is building.</p>
                </div>
                <span class="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-text-dim">
                  {presence().length} agents
                </span>
              </div>
              <Show when={presence().length === 0}>
                <div class="rounded-lg border border-dashed border-white/10 bg-white/5 px-3 py-4 text-xs text-text-dim">
                  No active HUD agents are visible yet. Once the first heartbeat lands, live presence will appear here with file activity and conflict signals.
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
                        <span class="text-[10px] text-text-dim">heartbeat live</span>
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

            <div class="glass-panel p-4">
              <div class="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 class="text-sm font-medium text-text-main">Task board</h3>
                  <p class="text-[11px] text-text-dim">Pending work, active execution, and recently completed slices.</p>
                </div>
                <span class="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-text-dim">
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
                        No queued work. The backlog is clear.
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
                        Nothing in flight right now.
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
                        Recent completions will show here.
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
            </div>

            <Show when={pullEnabled()}>
              <div class="glass-panel p-4">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 class="text-sm font-medium text-text-main">Claim ledger</h3>
                    <p class="text-[11px] text-text-dim">File claims grouped by agent with conflicts called out first.</p>
                  </div>
                  <span class={`rounded-full border px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] ${
                    claimConflictCount() > 0
                      ? 'border-status-error/30 bg-status-error/10 text-status-error'
                      : 'border-white/10 bg-white/5 text-text-dim'
                  }`}>
                    {claimConflictCount()} conflict{claimConflictCount() === 1 ? '' : 's'}
                  </span>
                </div>

                <Show when={claims().length === 0}>
                  <div class="rounded-lg border border-dashed border-white/10 bg-white/5 px-3 py-4 text-xs text-text-dim">
                    No active file claims. The workspace is clear for the next slice.
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
          </div>

          <div class="space-y-4">
            <Show when={pullEnabled() && workflows().length > 0}>
              <div class="glass-panel p-4">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 class="text-sm font-medium text-text-main">Workflow queue</h3>
                    <p class="text-[11px] text-text-dim">Direct approvals, rejections, and cancel actions are available from here.</p>
                  </div>
                  <span class="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-text-dim">
                    {awaitingApprovalWorkflows()} waiting
                  </span>
                </div>

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

                        <div class="mb-2 flex gap-1">
                          <For each={wf.steps}>
                            {(step, i) => (
                              <div
                                class={`h-1.5 flex-1 rounded-full ${
                                  step.status === 'completed' ? 'bg-status-ok' :
                                  step.status === 'running' ? 'bg-neon-cyan animate-pulse' :
                                  step.status === 'failed' ? 'bg-status-error' :
                                  i() === wf.currentStep ? 'bg-neon-cyan/50' :
                                  'bg-white/10'
                                }`}
                                title={`${step.name}: ${step.status}`}
                              />
                            )}
                          </For>
                        </div>

                        <Show when={wf.steps[wf.currentStep]}>
                          <div class="mb-3 text-xs text-text-dim">
                            Step {wf.currentStep + 1}/{wf.steps.length}: {wf.steps[wf.currentStep].name}
                          </div>
                        </Show>

                        <div class="flex flex-wrap gap-2">
                          <Show when={wf.steps[wf.currentStep]?.requiresApproval && wf.status === 'awaiting_approval'}>
                            <button
                              type="button"
                              onClick={() => handleApprove(wf.id)}
                              disabled={workflowAction() === `approve:${wf.id}`}
                              class="rounded-md bg-status-ok/20 px-3 py-1.5 text-xs font-medium text-status-ok transition-colors hover:bg-status-ok/30 disabled:opacity-50"
                            >
                              {workflowAction() === `approve:${wf.id}` ? 'Approving...' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleReject(wf.id)}
                              disabled={workflowAction() === `reject:${wf.id}`}
                              class="rounded-md bg-status-error/20 px-3 py-1.5 text-xs font-medium text-status-error transition-colors hover:bg-status-error/30 disabled:opacity-50"
                            >
                              {workflowAction() === `reject:${wf.id}` ? 'Rejecting...' : 'Reject'}
                            </button>
                          </Show>
                          <button
                            type="button"
                            onClick={() => handleCancel(wf.id)}
                            disabled={workflowAction() === `cancel:${wf.id}`}
                            class="rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-text-main transition-colors hover:bg-white/20 disabled:opacity-50"
                          >
                            {workflowAction() === `cancel:${wf.id}` ? 'Cancelling...' : 'Cancel'}
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <HUDActivityFeed
              initialEvents={timeline()}
              enabled={pullEnabled()}
              emptyMessage="No timeline entries yet. Live operations will appear here as soon as agents heartbeat, claim files, or transition workflows."
              onConnectionStateChange={setEventsConnection}
            />
          </div>
          </div>
        </Show>
      </HUDConsoleScaffold>
    </div>
  );
};

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

export default HUDTab;
