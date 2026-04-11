import { Component, For, Show } from 'solid-js';
import type { Agent } from '../../lib/types';

export interface HUDAgentCardProps {
  agent: Agent;
  onOpenSessions: (agent: Agent) => void;
}

const HUDAgentCard: Component<HUDAgentCardProps> = (props) => {
  const hudMeta = () => props.agent.metadata || {};
  const presenceStatus = () => (hudMeta().presence_status as string) || 'unknown';
  const activeFiles = () => (hudMeta().active_files as string[]) || [];
  const conflicts = () => (hudMeta().conflicts as string[]) || [];
  const heartbeatLabel = () => {
    const raw = hudMeta().last_heartbeat as string;
    if (!raw) return 'never';
    const diff = Date.now() - new Date(raw).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <div class="surface p-4 border-white/15">
      <div class="mb-3 flex items-start justify-between">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="font-medium truncate text-text-main">{props.agent.name}</h3>
            <span class="rounded-full border border-white/15 bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.16em] text-text-muted">
              HUD
            </span>
          </div>
          <p class="text-xs text-text-dim font-mono truncate">{hudMeta().agent_type as string || props.agent.id}</p>
        </div>
        <div class="flex items-center gap-2 ml-2">
          <span class={`h-2 w-2 rounded-full ${
            presenceStatus() === 'active' ? 'bg-status-ok animate-pulse' :
            presenceStatus() === 'idle' ? 'bg-yellow-400' :
            'bg-text-dim/50'
          }`} />
          <span class={`text-sm capitalize ${
            presenceStatus() === 'active' ? 'text-status-ok' :
            presenceStatus() === 'idle' ? 'text-yellow-400' :
            'text-text-dim'
          }`}>
            {presenceStatus()}
          </span>
        </div>
      </div>

      <Show when={hudMeta().current_task}>
        <p class="mb-3 text-xs text-text-muted line-clamp-2">
          {hudMeta().current_task as string}
        </p>
      </Show>

      <div class="mb-3 grid grid-cols-2 gap-2 text-xs">
        <Show when={hudMeta().branch}>
          <div class="rounded-lg bg-white/5 px-2 py-2">
            <div class="text-[10px] uppercase tracking-[0.18em] text-text-dim">Branch</div>
            <div class="mt-1 font-mono text-text-muted truncate">{hudMeta().branch as string}</div>
          </div>
        </Show>
        <Show when={hudMeta().pr_url}>
          <div class="rounded-lg bg-white/5 px-2 py-2">
            <div class="text-[10px] uppercase tracking-[0.18em] text-text-dim">PR</div>
            <a href={hudMeta().pr_url as string} target="_blank" rel="noopener noreferrer" class="mt-1 block truncate text-white hover:underline">
              View PR
            </a>
          </div>
        </Show>
        <Show when={activeFiles().length}>
          <div class="rounded-lg bg-white/5 px-2 py-2">
            <div class="text-[10px] uppercase tracking-[0.18em] text-text-dim">Active Files</div>
            <div class="mt-1 text-text-muted">{activeFiles().length}</div>
          </div>
        </Show>
        <Show when={hudMeta().namespace}>
          <div class="rounded-lg bg-white/5 px-2 py-2">
            <div class="text-[10px] uppercase tracking-[0.18em] text-text-dim">Namespace</div>
            <div class="mt-1 truncate font-mono text-text-muted">{hudMeta().namespace as string}</div>
          </div>
        </Show>
        <Show when={hudMeta().session_count}>
          <div class="rounded-lg bg-white/5 px-2 py-2">
            <div class="text-[10px] uppercase tracking-[0.18em] text-text-dim">Sessions</div>
            <div class="mt-1 text-text-muted">{hudMeta().session_count as number}</div>
          </div>
        </Show>
        <Show when={hudMeta().last_heartbeat}>
          <div class="rounded-lg bg-white/5 px-2 py-2">
            <div class="text-[10px] uppercase tracking-[0.18em] text-text-dim">Last Seen</div>
            <div class="mt-1 text-text-muted">{heartbeatLabel()}</div>
          </div>
        </Show>
      </div>

      <Show when={props.agent.tags && props.agent.tags.length > 0}>
        <div class="mb-3 flex flex-wrap gap-1">
          <For each={props.agent.tags.filter(t => t !== 'hud' && t !== 'cli').slice(0, 3)}>
            {(tag) => (
              <span class="rounded-full bg-white/10 px-2 py-0.5 text-xs text-text-dim">
                {tag}
              </span>
            )}
          </For>
        </div>
      </Show>

      <Show when={conflicts().length > 0}>
        <div class="mb-3 rounded-lg border border-status-error/20 bg-status-error/10 px-2 py-2 text-xs text-status-error">
          {conflicts().length} active conflict{conflicts().length === 1 ? '' : 's'}
        </div>
      </Show>

      <div class="flex gap-2">
        <button
          onClick={() => props.onOpenSessions(props.agent)}
          class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all bg-white/10 border border-white/15 text-text-muted hover:bg-white/15"
        >
          Open sessions
        </button>
      </div>
    </div>
  );
};

export default HUDAgentCard;
