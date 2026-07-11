import { Component, createUniqueId, onCleanup, onMount } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import type { Agent } from '../../lib/types';

type EditableAgentType = 'langgraph' | 'custom';

export interface AgentFormData {
  id: string;
  name: string;
  description: string;
  type: EditableAgentType;
  url: string;
  api_key: string;
  model: string;
  tags: string;
}

export interface AgentFormModalProps {
  formData: AgentFormData;
  setFormData: SetStoreFunction<AgentFormData>;
  editingAgent: Agent | null;
  actionLoading: string | null;
  onSubmit: () => void;
  onClose: () => void;
}

const AgentFormModal: Component<AgentFormModalProps> = (props) => {
  const uid = createUniqueId();
  const fieldId = (name: string) => `agent-form-${uid}-${name}`;
  const titleId = fieldId('title');

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      class="fixed inset-0 z-modal flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div class="surface w-full max-w-md p-6">
        <h3 id={titleId} class="mb-4 text-lg font-medium text-text-main">
          {props.editingAgent ? 'Edit Agent' : 'Add Agent'}
        </h3>

        <div class="space-y-4">
          <div>
            <label for={fieldId('id')} class="mb-1 block text-xs text-text-dim">ID</label>
            <input
              id={fieldId('id')}
              type="text"
              value={props.formData.id}
              onInput={(e) => props.setFormData('id', e.target.value)}
              disabled={!!props.editingAgent}
              placeholder="my-agent"
              class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim disabled:opacity-50"
            />
          </div>

          <div>
            <label for={fieldId('name')} class="mb-1 block text-xs text-text-dim">Name</label>
            <input
              id={fieldId('name')}
              type="text"
              value={props.formData.name}
              onInput={(e) => props.setFormData('name', e.target.value)}
              placeholder="My Agent"
              class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
            />
          </div>

          <div>
            <label for={fieldId('description')} class="mb-1 block text-xs text-text-dim">Description</label>
            <textarea
              id={fieldId('description')}
              value={props.formData.description}
              onInput={(e) => props.setFormData('description', e.target.value)}
              placeholder="What does this agent do?"
              rows={2}
              class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
            />
          </div>

          <div>
            <label for={fieldId('type')} class="mb-1 block text-xs text-text-dim">Type</label>
            <select
              id={fieldId('type')}
              value={props.formData.type}
              onChange={(e) => props.setFormData('type', e.target.value as EditableAgentType)}
              class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main"
            >
              <option value="langgraph">LangGraph</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div>
            <label for={fieldId('url')} class="mb-1 block text-xs text-text-dim">URL</label>
            <input
              id={fieldId('url')}
              type="text"
              value={props.formData.url}
              onInput={(e) => props.setFormData('url', e.target.value)}
              placeholder="http://localhost:8000"
              class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
            />
          </div>

          <div>
            <label for={fieldId('api-key')} class="mb-1 block text-xs text-text-dim">API Key (optional)</label>
            <input
              id={fieldId('api-key')}
              type="password"
              value={props.formData.api_key}
              onInput={(e) => props.setFormData('api_key', e.target.value)}
              placeholder="Bearer token"
              class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
            />
          </div>

          <div>
            <label for={fieldId('model')} class="mb-1 block text-xs text-text-dim">Model (optional)</label>
            <input
              id={fieldId('model')}
              type="text"
              value={props.formData.model}
              onInput={(e) => props.setFormData('model', e.target.value)}
              placeholder="gpt-4, claude-3, etc."
              class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
            />
          </div>

          <div>
            <label for={fieldId('tags')} class="mb-1 block text-xs text-text-dim">Tags (comma-separated)</label>
            <input
              id={fieldId('tags')}
              type="text"
              value={props.formData.tags}
              onInput={(e) => props.setFormData('tags', e.target.value)}
              placeholder="chatbot, rag, search"
              class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
            />
          </div>
        </div>

        <div class="mt-6 flex gap-3">
          <button
            onClick={props.onClose}
            class="flex-1 rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-white/20"
          >
            Cancel
          </button>
          <button
            onClick={props.onSubmit}
            disabled={props.actionLoading === 'form' || !props.formData.id || !props.formData.name || !props.formData.url}
            class="flex-1 rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            {props.actionLoading === 'form' ? 'Saving...' : props.editingAgent ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AgentFormModal;
