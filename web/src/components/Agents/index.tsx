import { Component, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Agent, AgentUsage } from '../../lib/types';
import { agentsApi } from '../../lib/api';

const Agents: Component = () => {
  const [agents, setAgents] = createStore<Agent[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);

  // Form state for creating/editing agents
  const [showForm, setShowForm] = createSignal(false);
  const [editingAgent, setEditingAgent] = createSignal<Agent | null>(null);
  const [formData, setFormData] = createStore({
    id: '',
    name: '',
    description: '',
    type: 'langgraph' as 'langgraph' | 'custom',
    url: '',
    api_key: '',
    model: '',
    tags: '',
  });

  // Test dialog state
  const [testingAgent, setTestingAgent] = createSignal<Agent | null>(null);
  const [testInput, setTestInput] = createSignal('{"message": "Hello"}');
  const [testResult, setTestResult] = createSignal<string | null>(null);
  const [testLoading, setTestLoading] = createSignal(false);

  const fetchAgents = async () => {
    try {
      const data = await agentsApi.list();
      setAgents(data.agents || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  };

  const checkHealth = async () => {
    try {
      const healthData = await agentsApi.health();
      // Update agent statuses based on health check
      const healthMap = healthData.health || {};
      setAgents(agents.map(a => ({
        ...a,
        status: healthMap[a.id] || a.status,
      })));
    } catch (err) {
      console.error('Health check failed:', err);
    }
  };

  createEffect(() => {
    fetchAgents();
    const interval = setInterval(() => {
      fetchAgents();
      checkHealth();
    }, 30000);
    onCleanup(() => clearInterval(interval));
  });

  const openCreateForm = () => {
    setEditingAgent(null);
    setFormData({
      id: '',
      name: '',
      description: '',
      type: 'langgraph',
      url: '',
      api_key: '',
      model: '',
      tags: '',
    });
    setShowForm(true);
  };

  const openEditForm = (agent: Agent) => {
    setEditingAgent(agent);
    setFormData({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      type: agent.type,
      url: agent.url,
      api_key: agent.api_key || '',
      model: agent.model || '',
      tags: (agent.tags || []).join(', '),
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    setActionLoading('form');
    try {
      const agentData = {
        id: formData.id,
        name: formData.name,
        description: formData.description,
        type: formData.type,
        url: formData.url,
        api_key: formData.api_key || undefined,
        model: formData.model || undefined,
        tags: formData.tags.split(',').map(t => t.trim()).filter(Boolean),
      };

      if (editingAgent()) {
        await agentsApi.update(agentData.id, agentData);
      } else {
        await agentsApi.create(agentData);
      }

      await fetchAgents();
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save agent');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this agent?')) return;
    setActionLoading(id);
    try {
      await agentsApi.delete(id);
      await fetchAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCheckHealth = async (id: string) => {
    setActionLoading(id);
    try {
      const result = await agentsApi.checkHealth(id);
      setAgents(agents.map(a => a.id === id ? { ...a, status: result.status } : a));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setActionLoading(null);
    }
  };

  const openTestDialog = (agent: Agent) => {
    setTestingAgent(agent);
    setTestResult(null);
    setTestInput('{"message": "Hello"}');
  };

  const handleTest = async () => {
    const agent = testingAgent();
    if (!agent) return;

    setTestLoading(true);
    setTestResult(null);
    try {
      const input = JSON.parse(testInput());
      const result = await agentsApi.test(agent.id, input);
      setTestResult(JSON.stringify(result, null, 2));
    } catch (err) {
      setTestResult(`Error: ${err instanceof Error ? err.message : 'Test failed'}`);
    } finally {
      setTestLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-status-ok';
      case 'unhealthy': return 'text-status-error';
      default: return 'text-text-dim';
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'healthy': return 'status-dot-ok';
      case 'unhealthy': return 'status-dot-error';
      default: return 'bg-text-dim/50 h-2 w-2 rounded-full';
    }
  };

  return (
    <div class="flex h-full flex-col gap-4">
      {/* Header */}
      <div class="glass-panel flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-4">
          <h2 class="text-lg font-medium text-text-main">AI Agents</h2>
          <span class="text-sm text-text-dim">
            {agents.filter(a => a.status === 'healthy').length} healthy
          </span>
        </div>

        <div class="flex gap-2">
          <button
            onClick={fetchAgents}
            disabled={loading()}
            class="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            onClick={openCreateForm}
            class="rounded-md bg-neon-cyan/20 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30"
          >
            + Add Agent
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="glass-panel p-4 text-sm text-status-error">{error()}</div>
      </Show>

      {/* Agents Grid */}
      <Show
        when={!loading() || agents.length > 0}
        fallback={
          <div class="glass-panel flex flex-1 items-center justify-center">
            <div class="text-center">
              <div class="mb-4 text-4xl animate-pulse-glow text-neon-cyan">⬡</div>
              <p class="text-text-dim">Loading agents...</p>
            </div>
          </div>
        }
      >
        <Show
          when={agents.length > 0}
          fallback={
            <div class="glass-panel flex flex-1 items-center justify-center">
              <div class="text-center">
                <div class="mb-4 text-6xl text-neon-purple/30">🤖</div>
                <h3 class="mb-2 text-xl font-medium text-text-main">No Agents Registered</h3>
                <p class="mb-4 text-text-dim">Add your first agent to get started.</p>
                <button
                  onClick={openCreateForm}
                  class="rounded-md bg-neon-cyan/20 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30"
                >
                  + Add Agent
                </button>
              </div>
            </div>
          }
        >
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <For each={agents}>
              {(agent) => (
                <div class="glass-panel p-4">
                  <div class="mb-3 flex items-start justify-between">
                    <div class="flex-1 min-w-0">
                      <h3 class="font-medium text-text-main truncate">{agent.name}</h3>
                      <p class="text-xs text-text-dim font-mono truncate">{agent.id}</p>
                    </div>
                    <div class="flex items-center gap-2 ml-2">
                      <span class={getStatusDot(agent.status)} />
                      <span class={`text-sm capitalize ${getStatusColor(agent.status)}`}>
                        {agent.status}
                      </span>
                    </div>
                  </div>

                  <p class="mb-3 text-xs text-text-dim line-clamp-2">
                    {agent.description || 'No description'}
                  </p>

                  <div class="mb-3 space-y-1 text-xs">
                    <div class="flex justify-between">
                      <span class="text-text-dim">Type</span>
                      <span class="text-text-muted capitalize">{agent.type}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-text-dim">URL</span>
                      <span class="text-text-muted truncate max-w-[150px]">{agent.url}</span>
                    </div>
                    <Show when={agent.model}>
                      <div class="flex justify-between">
                        <span class="text-text-dim">Model</span>
                        <span class="text-neon-purple truncate max-w-[150px]">{agent.model}</span>
                      </div>
                    </Show>
                  </div>

                  <Show when={agent.tags && agent.tags.length > 0}>
                    <div class="mb-3 flex flex-wrap gap-1">
                      <For each={agent.tags.slice(0, 3)}>
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
                      onClick={() => openTestDialog(agent)}
                      disabled={agent.status !== 'healthy'}
                      class="flex-1 rounded-md bg-neon-purple/20 px-3 py-1.5 text-sm font-medium text-neon-purple transition-colors hover:bg-neon-purple/30 disabled:opacity-50"
                    >
                      Test
                    </button>
                    <button
                      onClick={() => handleCheckHealth(agent.id)}
                      disabled={actionLoading() === agent.id}
                      class="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-white/20 disabled:opacity-50"
                    >
                      Check
                    </button>
                    <button
                      onClick={() => openEditForm(agent)}
                      class="rounded-md bg-white/10 px-2 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-white/20"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDelete(agent.id)}
                      disabled={actionLoading() === agent.id}
                      class="rounded-md bg-status-error/20 px-2 py-1.5 text-sm font-medium text-status-error transition-colors hover:bg-status-error/30 disabled:opacity-50"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>

      {/* Create/Edit Form Modal */}
      <Show when={showForm()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div class="glass-panel w-full max-w-md p-6">
            <h3 class="mb-4 text-lg font-medium text-text-main">
              {editingAgent() ? 'Edit Agent' : 'Add Agent'}
            </h3>

            <div class="space-y-4">
              <div>
                <label class="mb-1 block text-xs text-text-dim">ID</label>
                <input
                  type="text"
                  value={formData.id}
                  onInput={(e) => setFormData('id', e.target.value)}
                  disabled={!!editingAgent()}
                  placeholder="my-agent"
                  class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim disabled:opacity-50"
                />
              </div>

              <div>
                <label class="mb-1 block text-xs text-text-dim">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onInput={(e) => setFormData('name', e.target.value)}
                  placeholder="My Agent"
                  class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
                />
              </div>

              <div>
                <label class="mb-1 block text-xs text-text-dim">Description</label>
                <textarea
                  value={formData.description}
                  onInput={(e) => setFormData('description', e.target.value)}
                  placeholder="What does this agent do?"
                  rows={2}
                  class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
                />
              </div>

              <div>
                <label class="mb-1 block text-xs text-text-dim">Type</label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData('type', e.target.value as 'langgraph' | 'custom')}
                  class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main"
                >
                  <option value="langgraph">LangGraph</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div>
                <label class="mb-1 block text-xs text-text-dim">URL</label>
                <input
                  type="text"
                  value={formData.url}
                  onInput={(e) => setFormData('url', e.target.value)}
                  placeholder="http://localhost:8000"
                  class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
                />
              </div>

              <div>
                <label class="mb-1 block text-xs text-text-dim">API Key (optional)</label>
                <input
                  type="password"
                  value={formData.api_key}
                  onInput={(e) => setFormData('api_key', e.target.value)}
                  placeholder="Bearer token"
                  class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
                />
              </div>

              <div>
                <label class="mb-1 block text-xs text-text-dim">Model (optional)</label>
                <input
                  type="text"
                  value={formData.model}
                  onInput={(e) => setFormData('model', e.target.value)}
                  placeholder="gpt-4, claude-3, etc."
                  class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
                />
              </div>

              <div>
                <label class="mb-1 block text-xs text-text-dim">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={formData.tags}
                  onInput={(e) => setFormData('tags', e.target.value)}
                  placeholder="chatbot, rag, search"
                  class="w-full rounded-md bg-white/10 px-3 py-2 text-sm text-text-main placeholder-text-dim"
                />
              </div>
            </div>

            <div class="mt-6 flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                class="flex-1 rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-white/20"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={actionLoading() === 'form' || !formData.id || !formData.name || !formData.url}
                class="flex-1 rounded-md bg-neon-cyan/20 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
              >
                {actionLoading() === 'form' ? 'Saving...' : editingAgent() ? 'Save' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* Test Dialog Modal */}
      <Show when={testingAgent()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div class="glass-panel w-full max-w-lg p-6">
            <h3 class="mb-4 text-lg font-medium text-text-main">
              Test: {testingAgent()?.name}
            </h3>

            <div class="space-y-4">
              <div>
                <label class="mb-1 block text-xs text-text-dim">Input (JSON)</label>
                <textarea
                  value={testInput()}
                  onInput={(e) => setTestInput(e.target.value)}
                  rows={4}
                  class="w-full rounded-md bg-white/10 px-3 py-2 font-mono text-sm text-text-main placeholder-text-dim"
                />
              </div>

              <Show when={testResult()}>
                <div>
                  <label class="mb-1 block text-xs text-text-dim">Result</label>
                  <pre class="max-h-48 overflow-auto rounded-md bg-white/5 p-3 font-mono text-xs text-text-muted">
                    {testResult()}
                  </pre>
                </div>
              </Show>
            </div>

            <div class="mt-6 flex gap-3">
              <button
                onClick={() => setTestingAgent(null)}
                class="flex-1 rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-white/20"
              >
                Close
              </button>
              <button
                onClick={handleTest}
                disabled={testLoading()}
                class="flex-1 rounded-md bg-neon-purple/20 px-4 py-2 text-sm font-medium text-neon-purple transition-colors hover:bg-neon-purple/30 disabled:opacity-50"
              >
                {testLoading() ? 'Testing...' : 'Run Test'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default Agents;
