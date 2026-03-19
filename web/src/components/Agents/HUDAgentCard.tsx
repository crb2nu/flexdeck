import { Component, For, Show } from 'solid-js';
import type { Agent } from '../../lib/types';

export interface HUDAgentCardProps {
  agent: Agent;
  onOpenSessions: (agent: Agent) => void;
}

const HUDAgentCard: Component<HUDAgentCardProps> = (props) => {
  const hudMeta = () => props.agent.metadata || {};
  const presenceStatus = () => (hudMeta().presence_status as string) || 'unknown';

  return (
    <div class="glass-panel p-4 border-neon-purple/30 shadow-[0_0_15px_rgba(168,85,247,0.08)]">
      <div class="mb-3 flex items-start justify-between">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="font-medium truncate text-text-main">{props.agent.name}</h3>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/20 text-neon-purple border border-neon-purple/30">
              CLI
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

      <div class="mb-3 space-y-1 text-xs">
        <Show when={hudMeta().branch}>
          <div class="flex justify-between">
            <span class="text-text-dim">Branch</span>
            <span class="font-mono text-neon-purple truncate max-w-[150px]">{hudMeta().branch as string}</span>
          </div>
        </Show>
        <Show when={hudMeta().pr_url}>
          <div class="flex justify-between">
            <span class="text-text-dim">PR</span>
            <a href={hudMeta().pr_url as string} target="_blank" rel="noopener noreferrer" class="text-neon-cyan hover:underline truncate max-w-[150px]">
              View PR
            </a>
          </div>
        </Show>
        <Show when={(hudMeta().active_files as string[])?.length}>
          <div class="flex justify-between">
            <span class="text-text-dim">Active Files</span>
            <span class="text-text-muted">{(hudMeta().active_files as string[]).length}</span>
          </div>
        </Show>
        <Show when={hudMeta().namespace}>
          <div class="flex justify-between">
            <span class="text-text-dim">Namespace</span>
            <span class="font-mono text-text-muted truncate max-w-[150px]">{hudMeta().namespace as string}</span>
          </div>
        </Show>
        <Show when={hudMeta().session_count}>
          <div class="flex justify-between">
            <span class="text-text-dim">Sessions</span>
            <span class="text-text-muted">{hudMeta().session_count as number}</span>
          </div>
        </Show>
        <Show when={hudMeta().last_heartbeat}>
          <div class="flex justify-between">
            <span class="text-text-dim">Last Seen</span>
            <span class="text-text-muted">
              {(() => {
                const hb = hudMeta().last_heartbeat as string;
                const diff = Date.now() - new Date(hb).getTime();
                const secs = Math.floor(diff / 1000);
                if (secs < 60) return `${secs}s ago`;
                const mins = Math.floor(secs / 60);
                if (mins < 60) return `${mins}m ago`;
                const hrs = Math.floor(mins / 60);
                if (hrs < 24) return `${hrs}h ago`;
                return `${Math.floor(hrs / 24)}d ago`;
              })()}
            </span>
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

      <div class="flex gap-2">
        <button
          onClick={() => props.onOpenSessions(props.agent)}
          class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all bg-neon-purple/15 border border-neon-purple/30 text-neon-purple hover:bg-neon-purple/25 hover:shadow-[0_0_12px_rgba(168,85,247,0.2)]"
        >
          Sessions
        </button>
      </div>
    </div>
  );
};

export default HUDAgentCard;
