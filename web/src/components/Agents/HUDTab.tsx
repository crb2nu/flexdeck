import { Component, createMemo, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { agentsApi, hudApi } from '../../lib/api';
import { healthStore } from '../../stores/health';
import type { HUDAgentPresence, HUDClaim, HUDTask, HUDWorkflow, HUDTimelineEvent } from '../../lib/types';
import HUDActivityFeed from './HUDActivityFeed';
import { getHudModeState } from '../../lib/featureFlags';
import { HUD_PULL_STALE_THRESHOLD_MS, isWorkflowDataStale, type FeedConnectionState } from './hudDegradedMode';
import {
  applyWorkflowCancel,
  countClaimConflicts,
  extractItems,
  getClaimField,
  groupClaimsByAgent,
  normalizePresenceFromPush,
  toErrorMessage,
} from './hudUtils';

const HUDTab: Component = () => {
  const [presence, setPresence] = createSignal<HUDAgentPresence[]>([]);
  const [claims, setClaims] = createSignal<HUDClaim[]>([]);
  const [tasks, setTasks] = createSignal<HUDTask[]>([]);
  const [workflows, setWorkflows] = createSignal<HUDWorkflow[]>([]);
  const [timeline, setTimeline] = createSignal<HUDTimelineEvent[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [workflowAction, setWorkflowAction] = createSignal<string | null>(null);
  const [eventsConnection, setEventsConnection] = createSignal<FeedConnectionState>('connecting');
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

  createEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    onCleanup(() => clearInterval(interval));
  });

  createEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 5000);
    onCleanup(() => clearInterval(ticker));
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

  const pendingTasks = () => tasks().filter((task) => task.status === 'pending');
  const inProgressTasks = () => tasks().filter((task) => task.status === 'in_progress');
  const completedTasks = () => tasks().filter((task) => task.status === 'completed').slice(0, 10);

  const claimsByAgent = () => {
    return groupClaimsByAgent(claims());
  };
  const claimConflictCount = () => countClaimConflicts(claims());

  const workflowDataStale = () =>
    isWorkflowDataStale(pullEnabled(), lastSuccessfulPull(), now());

  const hasStaleWarning = () => eventsConnection() === 'stale' || workflowDataStale();

  return (
    <div class="flex flex-col gap-4">
      <div class="glass-panel p-3 flex items-center justify-between">
        <div class="text-xs text-text-dim">
          HUD mode: <span class="text-text-main font-mono">{hudMode().modeLabel}</span>
        </div>
        <div class="text-[10px] text-text-dim">
          {hudMode().modeDescription}
        </div>
      </div>

      <Show when={hasStaleWarning()}>
        <div class="glass-panel p-3 text-xs text-status-warn">
          Stale data warning: live HUD stream is not connected or polling is delayed beyond {Math.floor(HUD_PULL_STALE_THRESHOLD_MS / 1000)}s. Displayed data may lag.
        </div>
      </Show>

      <Show when={error()}>
        <div class="glass-panel p-3 text-sm text-status-error">{error()}</div>
      </Show>

      <Show when={loading() && presence().length === 0}>
        <div class="glass-panel flex items-center justify-center py-8">
          <div class="text-text-dim animate-pulse">Loading HUD data...</div>
        </div>
      </Show>

      <Show when={presence().length > 0}>
        <div class="glass-panel p-4">
          <h3 class="text-sm font-medium text-neon-purple mb-3">Agent Presence</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <For each={presence()}>
              {(agent) => (
                <div class="rounded-lg bg-white/5 p-3 border border-white/5">
                  <div class="flex items-center gap-2 mb-2">
                    <div class={`w-2 h-2 rounded-full ${statusColor(agent.status)} ${agent.status === 'active' ? 'animate-pulse' : ''}`} />
                    <span class="text-sm font-mono text-text-main truncate">{agent.agentId}</span>
                  </div>
                  <div class="flex items-center gap-2 text-xs text-text-dim">
                    <span class="px-1.5 py-0.5 rounded bg-white/5">{agent.agentType}</span>
                    <span>{agent.status}</span>
                  </div>
                  <Show when={agent.activeFiles && agent.activeFiles.length > 0}>
                    <div class="mt-2 text-[10px] text-text-dim">
                      <For each={agent.activeFiles.slice(0, 3)}>
                        {(file) => <div class="font-mono truncate">{file}</div>}
                      </For>
                    </div>
                  </Show>
                  <Show when={agent.conflicts && agent.conflicts.length > 0}>
                    <div class="mt-1 text-[10px] text-status-error">
                      {agent.conflicts.length} conflict(s)
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={pullEnabled()}>
        <div class="glass-panel p-4">
          <h3 class="text-sm font-medium text-status-warn mb-3">File Claims</h3>
          <Show when={claimConflictCount() > 0}>
            <div class="mb-3 rounded border border-status-error/40 bg-status-error/10 px-2 py-1 text-[11px] text-status-error">
              Conflict detected on {claimConflictCount()} file{claimConflictCount() === 1 ? '' : 's'}.
            </div>
          </Show>
          <Show when={claims().length === 0}>
            <div class="text-xs text-text-dim">No active file claims.</div>
          </Show>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Show when={claims().length > 0}>
              <For each={Object.entries(claimsByAgent())}>
                {([agentId, agentClaims]) => (
                  <div class="rounded-lg bg-white/5 p-3 border border-white/5">
                    <div class="text-xs text-text-main font-mono mb-2">{agentId}</div>
                    <div class="flex flex-col gap-1 max-h-32 overflow-y-auto">
                      <For each={agentClaims}>
                        {(claim) => (
                          <div class="text-[10px] text-text-dim font-mono truncate">
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

      <Show when={pullEnabled() && tasks().length > 0}>
        <div class="glass-panel p-4">
          <h3 class="text-sm font-medium text-neon-cyan mb-3">Task Board</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <div class="text-xs text-text-dim uppercase mb-2">Pending ({pendingTasks().length})</div>
              <div class="flex flex-col gap-2">
                <For each={pendingTasks()}>
                  {(task) => <TaskCard task={task} statusColor={taskStatusColor} />}
                </For>
                <Show when={pendingTasks().length === 0}>
                  <div class="text-xs text-text-dim py-2">None</div>
                </Show>
              </div>
            </div>
            <div>
              <div class="text-xs text-text-dim uppercase mb-2">In Progress ({inProgressTasks().length})</div>
              <div class="flex flex-col gap-2">
                <For each={inProgressTasks()}>
                  {(task) => <TaskCard task={task} statusColor={taskStatusColor} />}
                </For>
                <Show when={inProgressTasks().length === 0}>
                  <div class="text-xs text-text-dim py-2">None</div>
                </Show>
              </div>
            </div>
            <div>
              <div class="text-xs text-text-dim uppercase mb-2">Completed ({completedTasks().length})</div>
              <div class="flex flex-col gap-2">
                <For each={completedTasks()}>
                  {(task) => <TaskCard task={task} statusColor={taskStatusColor} />}
                </For>
                <Show when={completedTasks().length === 0}>
                  <div class="text-xs text-text-dim py-2">None</div>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={pullEnabled() && workflows().length > 0}>
        <div class="glass-panel p-4">
          <h3 class="text-sm font-medium text-status-ok mb-3">Workflows</h3>
          <div class="flex flex-col gap-3">
            <For each={workflows()}>
              {(wf) => (
                <div class="rounded-lg bg-white/5 p-3 border border-white/5">
                  <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-mono text-text-main">{wf.definitionId}</span>
                      <span class="text-xs px-1.5 py-0.5 rounded bg-white/10 text-text-dim">{wf.status}</span>
                    </div>
                    <span class="text-[10px] text-text-dim">
                      {new Date(wf.startedAt).toLocaleString()}
                    </span>
                  </div>

                  <div class="flex gap-1 mb-2">
                    <For each={wf.steps}>
                      {(step, i) => (
                        <div
                          class={`flex-1 h-1.5 rounded-full ${
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
                    <div class="text-xs text-text-dim mb-2">
                      Step {wf.currentStep + 1}/{wf.steps.length}: {wf.steps[wf.currentStep].name}
                    </div>
                  </Show>

                  <div class="flex gap-2 mt-2">
                    <Show when={wf.steps[wf.currentStep]?.requiresApproval && wf.status === 'awaiting_approval'}>
                      <button
                        onClick={() => handleApprove(wf.id)}
                        disabled={workflowAction() === `approve:${wf.id}`}
                        class="rounded-md bg-status-ok/20 px-3 py-1 text-xs font-medium text-status-ok hover:bg-status-ok/30 disabled:opacity-50"
                      >
                        {workflowAction() === `approve:${wf.id}` ? '...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleReject(wf.id)}
                        disabled={workflowAction() === `reject:${wf.id}`}
                        class="rounded-md bg-status-error/20 px-3 py-1 text-xs font-medium text-status-error hover:bg-status-error/30 disabled:opacity-50"
                      >
                        {workflowAction() === `reject:${wf.id}` ? '...' : 'Reject'}
                      </button>
                    </Show>
                    <button
                      onClick={() => handleCancel(wf.id)}
                      disabled={workflowAction() === `cancel:${wf.id}`}
                      class="rounded-md bg-white/10 px-3 py-1 text-xs font-medium text-text-main hover:bg-white/20 disabled:opacity-50"
                    >
                      {workflowAction() === `cancel:${wf.id}` ? '...' : 'Cancel'}
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
        onConnectionStateChange={setEventsConnection}
      />
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
