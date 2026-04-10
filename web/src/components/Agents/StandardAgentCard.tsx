import { Component, For, Show } from 'solid-js';
import type { Agent } from '../../lib/types';

export interface StandardAgentCardProps {
  agent: Agent;
  isBuiltIn: boolean;
  onChat: (agent: Agent) => void;
  onCheckHealth: (id: string) => void;
  onEdit: (agent: Agent) => void;
  onDelete: (id: string) => void;
  actionLoading: string | null;
  getStatusColor: (status: string) => string;
  getStatusDot: (status: string) => string;
}

const StandardAgentCard: Component<StandardAgentCardProps> = (props) => {
  return (
    <div class={`glass-panel p-4 ${props.isBuiltIn ? 'border-white/20' : ''}`}>
      <div class="mb-3 flex items-start justify-between">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <h3 class={`font-medium truncate ${props.isBuiltIn ? 'text-white' : 'text-text-main'}`}>
              {props.agent.name}
            </h3>
            <Show when={props.isBuiltIn}>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-text-muted border border-white/15">
                BUILT-IN
              </span>
            </Show>
          </div>
          <p class="text-xs text-text-dim font-mono truncate">{props.agent.id}</p>
        </div>
        <div class="flex items-center gap-2 ml-2">
          <span class={props.getStatusDot(props.agent.status)} />
          <span class={`text-sm capitalize ${props.getStatusColor(props.agent.status)}`}>
            {props.agent.status}
          </span>
        </div>
      </div>

      <p class="mb-3 text-xs text-text-dim line-clamp-2">
        {props.agent.description || 'No description'}
      </p>

      <div class="mb-3 space-y-1 text-xs">
        <div class="flex justify-between">
          <span class="text-text-dim">Type</span>
          <span class="text-text-muted capitalize">{props.agent.type}</span>
        </div>
        <Show when={!props.isBuiltIn}>
          <div class="flex justify-between">
            <span class="text-text-dim">URL</span>
            <span class="text-text-muted truncate max-w-[150px]">{props.agent.url}</span>
          </div>
        </Show>
        <Show when={props.agent.metadata?.backend === 'flexinfer'}>
          <div class="flex justify-between">
            <span class="text-text-dim">Backend</span>
            <span class="text-text-muted">FlexInfer</span>
          </div>
        </Show>
        <Show when={props.agent.model}>
          <div class="flex justify-between">
            <span class="text-text-dim">Model</span>
            <span class="text-text-muted truncate max-w-[150px]">{props.agent.model}</span>
          </div>
        </Show>
      </div>

      <Show when={props.agent.tags && props.agent.tags.length > 0}>
        <div class="mb-3 flex flex-wrap gap-1">
          <For each={props.agent.tags.filter(t => t !== 'built-in').slice(0, 3)}>
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
          onClick={() => props.onChat(props.agent)}
          class={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
            props.isBuiltIn
              ? 'bg-white/10 border border-white/20 text-white hover:bg-white/15'
              : 'bg-white/10 border border-white/15 text-white hover:bg-white/15'
          }`}
        >
          Chat
        </button>
        <Show when={!props.isBuiltIn}>
          <button
            onClick={() => props.onCheckHealth(props.agent.id)}
            disabled={props.actionLoading === props.agent.id}
            class="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            Check
          </button>
          <button
            onClick={() => props.onEdit(props.agent)}
            class="rounded-md bg-white/10 px-2 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-white/20"
          >
            &#x270E;
          </button>
          <button
            onClick={() => props.onDelete(props.agent.id)}
            disabled={props.actionLoading === props.agent.id}
            class="rounded-md bg-status-error/20 px-2 py-1.5 text-sm font-medium text-status-error transition-colors hover:bg-status-error/30 disabled:opacity-50"
          >
            &#x2715;
          </button>
        </Show>
      </div>
    </div>
  );
};

export default StandardAgentCard;
