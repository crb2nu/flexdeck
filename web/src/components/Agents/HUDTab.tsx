import { Component, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { hudApi } from '../../lib/api';
import type { HUDAgentPresence, HUDTask, HUDWorkflow, HUDTimelineEvent } from '../../lib/types';
import HUDActivityFeed from './HUDActivityFeed';

const HUDTab: Component = () => {
  const [presence, setPresence] = createSignal<HUDAgentPresence[]>([]);
  const [tasks, setTasks] = createSignal<HUDTask[]>([]);
  const [workflows, setWorkflows] = createSignal<HUDWorkflow[]>([]);
  const [timeline, setTimeline] = createSignal<HUDTimelineEvent[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [approving, setApproving] = createSignal<string | null>(null);

  const fetchAll = async () => {
    try {
      const [p, t, w, tl] = await Promise.allSettled([
        hudApi.presence(),
        hudApi.tasks(),
        hudApi.workflows(),
        hudApi.timeline(),
      ]);

      if (p.status === 'fulfilled') setPresence(Array.isArray(p.value) ? p.value : (p.value as any)?.agents || []);
      if (t.status === 'fulfilled') setTasks(Array.isArray(t.value) ? t.value : (t.value as any)?.tasks || []);
      if (w.status === 'fulfilled') setWorkflows(Array.isArray(w.value) ? w.value : (w.value as any)?.workflows || []);
      if (tl.status === 'fulfilled') setTimeline(Array.isArray(tl.value) ? tl.value : (tl.value as any)?.events || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch HUD data');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    setApproving(id);
    try {
      await hudApi.approveWorkflow(id);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve workflow');
    } finally {
      setApproving(null);
    }
  };

  const handleReject = async (id: string) => {
    setApproving(id);
    try {
      await hudApi.rejectWorkflow(id);
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject workflow');
    } finally {
      setApproving(null);
    }
  };

  createEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 15000);
    onCleanup(() => clearInterval(interval));
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

  const pendingTasks = () => tasks().filter(t => t.status === 'pending');
  const inProgressTasks = () => tasks().filter(t => t.status === 'in_progress');
  const completedTasks = () => tasks().filter(t => t.status === 'completed').slice(0, 10);

  return (
    <div class="flex flex-col gap-4">
      <Show when={error()}>
        <div class="glass-panel p-3 text-sm text-status-error">{error()}</div>
      </Show>

      <Show when={loading() && presence().length === 0}>
        <div class="glass-panel flex items-center justify-center py-8">
          <div class="text-text-dim animate-pulse">Loading HUD data...</div>
        </div>
      </Show>

      {/* Agent Presence Grid */}
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

      {/* Task Board */}
      <Show when={tasks().length > 0}>
        <div class="glass-panel p-4">
          <h3 class="text-sm font-medium text-neon-cyan mb-3">Task Board</h3>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Pending */}
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
            {/* In Progress */}
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
            {/* Completed */}
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

      {/* Workflow Monitor */}
      <Show when={workflows().length > 0}>
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

                  {/* Step indicators */}
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

                  {/* Current step name */}
                  <Show when={wf.steps[wf.currentStep]}>
                    <div class="text-xs text-text-dim mb-2">
                      Step {wf.currentStep + 1}/{wf.steps.length}: {wf.steps[wf.currentStep].name}
                    </div>
                  </Show>

                  {/* Approval buttons */}
                  <Show when={wf.steps[wf.currentStep]?.requiresApproval && wf.status === 'awaiting_approval'}>
                    <div class="flex gap-2 mt-2">
                      <button
                        onClick={() => handleApprove(wf.id)}
                        disabled={approving() === wf.id}
                        class="rounded-md bg-status-ok/20 px-3 py-1 text-xs font-medium text-status-ok hover:bg-status-ok/30 disabled:opacity-50"
                      >
                        {approving() === wf.id ? '...' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleReject(wf.id)}
                        disabled={approving() === wf.id}
                        class="rounded-md bg-status-error/20 px-3 py-1 text-xs font-medium text-status-error hover:bg-status-error/30 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Activity Feed */}
      <HUDActivityFeed initialEvents={timeline()} />
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
