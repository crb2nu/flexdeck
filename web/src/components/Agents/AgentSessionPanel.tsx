import { Component, createSignal, For, Show } from 'solid-js';
import type { Agent, AgentSession } from '../../lib/types';
import { agentsApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';

interface AgentSessionPanelProps {
  agent: Agent;
  onClose: () => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function agentTypeLabel(agentType?: string): string {
  switch (agentType) {
    case 'claude-code': return 'Claude Code';
    case 'gemini': return 'Gemini CLI';
    case 'codex': return 'Codex';
    default: return agentType || 'CLI Agent';
  }
}

function presenceStatusColor(status?: string): string {
  switch (status) {
    case 'active': return 'text-status-ok';
    case 'idle': return 'text-status-warn';
    case 'offline': return 'text-status-error';
    default: return 'text-text-dim';
  }
}

function presenceStatusDot(status?: string): string {
  switch (status) {
    case 'active': return 'bg-status-ok';
    case 'idle': return 'bg-yellow-400';
    case 'offline': return 'bg-status-error';
    default: return 'bg-text-dim/50';
  }
}

const AgentSessionPanel: Component<AgentSessionPanelProps> = (props) => {
  const [sessions, setSessions] = createSignal<AgentSession[]>([]);
  const [loadingSessions, setLoadingSessions] = createSignal(true);

  const meta = () => props.agent.metadata || {};
  const presenceStatus = () => (meta().presence_status as string) || 'unknown';
  const currentTask = () => meta().current_task as string | undefined;
  const activeFiles = () => (meta().active_files as string[]) || [];
  const branch = () => meta().branch as string | undefined;
  const prUrl = () => meta().pr_url as string | undefined;
  const lastHeartbeat = () => meta().last_heartbeat as string | undefined;
  const agentType = () => meta().agent_type as string | undefined;

  const fetchSessions = async () => {
    try {
      const data = await agentsApi.sessions(props.agent.id);
      setSessions(data.sessions || []);
    } catch {
      setSessions([]);
    } finally {
      setLoadingSessions(false);
    }
  };

  createPolling(() => 'agent-sessions-' + props.agent.id, fetchSessions, 15_000);

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div class="surface w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div class="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div class="flex items-center gap-3">
            <div class={`h-3 w-3 rounded-full ${presenceStatusDot(presenceStatus())} ${presenceStatus() === 'active' ? 'animate-pulse' : ''}`} />
            <div>
              <h3 class="text-lg font-medium text-text-main">{props.agent.name}</h3>
              <span class="text-xs text-text-dim">{agentTypeLabel(agentType())}</span>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class={`text-sm capitalize ${presenceStatusColor(presenceStatus())}`}>
              {presenceStatus()}
            </span>
            <button
              onClick={props.onClose}
              class="rounded-md bg-white/10 px-2 py-1 text-sm text-text-muted hover:bg-white/20"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Body */}
        <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Current Task */}
          <Show when={currentTask()}>
            <div class="space-y-1">
              <div class="text-xs uppercase tracking-wider text-text-dim">Current Task</div>
              <p class="text-sm text-text-main">{currentTask()}</p>
            </div>
          </Show>

          {/* Branch & PR */}
          <Show when={branch()}>
            <div class="flex items-center gap-3">
              <div class="space-y-1">
                <div class="text-xs uppercase tracking-wider text-text-dim">Branch</div>
                <span class="rounded bg-white/10 px-2 py-0.5 text-xs font-mono text-text-muted">{branch()}</span>
              </div>
              <Show when={prUrl()}>
                <div class="space-y-1">
                  <div class="text-xs uppercase tracking-wider text-text-dim">PR</div>
                  <a href={prUrl()!} target="_blank" rel="noopener noreferrer" class="text-xs text-white hover:underline">
                    View PR
                  </a>
                </div>
              </Show>
            </div>
          </Show>

          {/* Active Files */}
          <Show when={activeFiles().length > 0}>
            <div class="space-y-1">
              <div class="text-xs uppercase tracking-wider text-text-dim">
                Active Files ({activeFiles().length})
              </div>
              <div class="space-y-0.5">
                <For each={activeFiles().slice(0, 8)}>
                  {(file) => (
                    <div class="truncate text-xs font-mono text-text-muted">{file}</div>
                  )}
                </For>
                <Show when={activeFiles().length > 8}>
                  <div class="text-xs text-text-dim">+{activeFiles().length - 8} more</div>
                </Show>
              </div>
            </div>
          </Show>

          {/* Last Heartbeat */}
          <Show when={lastHeartbeat()}>
            <div class="flex items-center gap-2 text-xs text-text-dim">
              <span class={`inline-block h-1.5 w-1.5 rounded-full ${presenceStatus() === 'active' ? 'bg-status-ok animate-pulse' : 'bg-text-dim/50'}`} />
              Last heartbeat: {relativeTime(lastHeartbeat()!)}
            </div>
          </Show>

          {/* Sessions */}
          <div class="space-y-2">
            <div class="text-xs uppercase tracking-wider text-text-dim">Session History</div>
            <Show when={!loadingSessions()} fallback={
              <div class="text-xs text-text-dim animate-pulse">Loading sessions...</div>
            }>
              <Show when={sessions().length > 0} fallback={
                <div class="text-xs text-text-dim">No sessions recorded</div>
              }>
                <div class="space-y-2">
                  <For each={sessions().slice(0, 10)}>
                    {(session) => (
                      <div class="rounded-md border border-white/5 bg-white/5 p-3 text-xs">
                        <div class="flex items-center justify-between mb-1">
                          <span class="font-mono text-text-muted">{session.namespace || session.id.slice(0, 8)}</span>
                          <span class={`capitalize ${session.status === 'active' ? 'text-status-ok' : 'text-text-dim'}`}>
                            {session.status}
                          </span>
                        </div>
                        <Show when={session.description}>
                          <p class="text-text-dim mb-1 line-clamp-2">{session.description}</p>
                        </Show>
                        <div class="flex items-center gap-3 text-text-dim">
                          <span>{relativeTime(session.started_at)}</span>
                          <Show when={session.entry_count}>
                            <span>{session.entry_count} entries</span>
                          </Show>
                          <Show when={session.total_tokens}>
                            <span>{session.total_tokens?.toLocaleString()} tokens</span>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AgentSessionPanel;
