import { Component, createSignal, createEffect, onCleanup, For, Show, lazy, Suspense, ErrorBoundary } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Agent, AgentNode, AgentEdge } from '../../lib/types';
import { agentsApi } from '../../lib/api';
import AgentChat from './AgentChat';
import AgentFlowGraph from './AgentFlowGraph';
import AgentSessionPanel from './AgentSessionPanel';

const HUDTab = lazy(() => import('./HUDTab'));

type ViewMode = 'grid' | 'flow' | 'hud';

const Agents: Component = () => {
  const [agents, setAgents] = createStore<Agent[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);
  const [viewMode, setViewMode] = createSignal<ViewMode>('grid');

  // Graph data
  const [graphNodes, setGraphNodes] = createSignal<AgentNode[]>([]);
  const [graphEdges, setGraphEdges] = createSignal<AgentEdge[]>([]);

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

  // Chat/Test state
  const [chatAgent, setChatAgent] = createSignal<Agent | null>(null);
  // Session panel for HUD agents
  const [sessionAgent, setSessionAgent] = createSignal<Agent | null>(null);

  const isHUDAgent = (agent: Agent) => agent.type === 'cli-agent' || agent.metadata?.source === 'hud';

  const fetchAgents = async () => {
    try {
      const data = await agentsApi.list();
      
      // Fetch built-in Agent Builder info
      try {
        const builderInfo = await agentsApi.builderInfo();
        // Prepend agent builder to the list
        const agentsList = data.agents || [];
        const hasBuilder = agentsList.some((a: Agent) => a.id === 'agent-builder');
        if (!hasBuilder && builderInfo) {
          setAgents([builderInfo, ...agentsList]);
        } else {
          setAgents(agentsList);
        }
      } catch {
        // If builder not available, just use regular agents
        setAgents(data.agents || []);
      }
      
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
    } finally {
      setLoading(false);
    }
  };

  const fetchGraph = async () => {
    try {
      const data = await agentsApi.graph();
      setGraphNodes(data.nodes || []);
      setGraphEdges(data.edges || []);
    } catch {
      // Graph endpoint may not be available; silently ignore
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
    fetchGraph();
    const interval = setInterval(() => {
      fetchAgents();
      fetchGraph();
      checkHealth();
    }, 10000);
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

  const openChat = (agent: Agent) => {
    if (isHUDAgent(agent)) {
      setSessionAgent(agent);
    } else {
      setChatAgent(agent);
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
          {/* View toggle */}
          <div class="flex rounded-md bg-white/5 p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              class={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode() === 'grid'
                  ? 'bg-white/15 text-text-main'
                  : 'text-text-dim hover:text-text-muted'
              }`}
            >
              Grid
            </button>
            <button
              onClick={() => setViewMode('flow')}
              class={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode() === 'flow'
                  ? 'bg-white/15 text-text-main'
                  : 'text-text-dim hover:text-text-muted'
              }`}
            >
              Flow
            </button>
            <button
              onClick={() => setViewMode('hud')}
              class={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode() === 'hud'
                  ? 'bg-white/15 text-text-main'
                  : 'text-text-dim hover:text-text-muted'
              }`}
            >
              HUD
            </button>
          </div>
          <button
            onClick={() => { fetchAgents(); fetchGraph(); }}
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

      {/* Content area */}
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
          {/* Flow View */}
          <Show when={viewMode() === 'flow'}>
            <div class="flex-1 min-h-[400px]">
              <AgentFlowGraph
                nodes={graphNodes()}
                edges={graphEdges()}
                onAgentClick={(node) => {
                  const agent = agents.find(a => a.id === node.id);
                  if (agent) setChatAgent(agent);
                }}
              />
            </div>
          </Show>

          {/* Grid View */}
          <Show when={viewMode() === 'grid'}>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <For each={agents}>
                {(agent) => {
                  const isBuiltIn = agent.id === 'agent-builder' || agent.tags?.includes('built-in');
                  const isHUD = isHUDAgent(agent);
                  const hudMeta = () => agent.metadata || {};
                  const presenceStatus = () => (hudMeta().presence_status as string) || 'unknown';

                  // HUD Agent Card (CLI agents)
                  if (isHUD) {
                    return (
                      <div class="glass-panel p-4 border-neon-purple/30 shadow-[0_0_15px_rgba(168,85,247,0.08)]">
                        <div class="mb-3 flex items-start justify-between">
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-2">
                              <h3 class="font-medium truncate text-text-main">{agent.name}</h3>
                              <span class="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/20 text-neon-purple border border-neon-purple/30">
                                CLI
                              </span>
                            </div>
                            <p class="text-xs text-text-dim font-mono truncate">{hudMeta().agent_type as string || agent.id}</p>
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

                        <Show when={agent.tags && agent.tags.length > 0}>
                          <div class="mb-3 flex flex-wrap gap-1">
                            <For each={agent.tags.filter(t => t !== 'hud' && t !== 'cli').slice(0, 3)}>
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
                            onClick={() => openChat(agent)}
                            class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all bg-neon-purple/15 border border-neon-purple/30 text-neon-purple hover:bg-neon-purple/25 hover:shadow-[0_0_12px_rgba(168,85,247,0.2)]"
                          >
                            Sessions
                          </button>
                        </div>
                      </div>
                    );
                  }

                  // Standard agent card (registry agents)
                  return (
                    <div class={`glass-panel p-4 ${isBuiltIn ? 'border-neon-cyan/40 shadow-[0_0_20px_rgba(0,217,255,0.1)]' : ''}`}>
                      <div class="mb-3 flex items-start justify-between">
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-2">
                            <h3 class={`font-medium truncate ${isBuiltIn ? 'text-neon-cyan' : 'text-text-main'}`}>
                              {agent.name}
                            </h3>
                            <Show when={isBuiltIn}>
                              <span class="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/20 text-neon-purple border border-neon-purple/30">
                                BUILT-IN
                              </span>
                            </Show>
                          </div>
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
                        <Show when={!isBuiltIn}>
                          <div class="flex justify-between">
                            <span class="text-text-dim">URL</span>
                            <span class="text-text-muted truncate max-w-[150px]">{agent.url}</span>
                          </div>
                        </Show>
                        <Show when={agent.metadata?.backend === 'flexinfer'}>
                          <div class="flex justify-between">
                            <span class="text-text-dim">Backend</span>
                            <span class="text-neon-purple">FlexInfer</span>
                          </div>
                        </Show>
                        <Show when={agent.model}>
                          <div class="flex justify-between">
                            <span class="text-text-dim">Model</span>
                            <span class="text-neon-purple truncate max-w-[150px]">{agent.model}</span>
                          </div>
                        </Show>
                      </div>

                      <Show when={agent.tags && agent.tags.length > 0}>
                        <div class="mb-3 flex flex-wrap gap-1">
                          <For each={agent.tags.filter(t => t !== 'built-in').slice(0, 3)}>
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
                          onClick={() => openChat(agent)}
                          class={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                            isBuiltIn
                              ? 'bg-neon-cyan/20 border border-neon-cyan/40 text-neon-cyan hover:bg-neon-cyan/30 hover:shadow-[0_0_15px_rgba(0,217,255,0.3)]'
                              : 'bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/20 hover:shadow-[0_0_10px_rgba(0,217,255,0.2)]'
                          }`}
                        >
                          Chat
                        </button>
                        <Show when={!isBuiltIn}>
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
                            &#x270E;
                          </button>
                          <button
                            onClick={() => handleDelete(agent.id)}
                            disabled={actionLoading() === agent.id}
                            class="rounded-md bg-status-error/20 px-2 py-1.5 text-sm font-medium text-status-error transition-colors hover:bg-status-error/30 disabled:opacity-50"
                          >
                            &#x2715;
                          </button>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>

          {/* HUD View */}
          <Show when={viewMode() === 'hud'}>
            <ErrorBoundary fallback={(err) => (
              <div class="glass-panel p-4 text-sm text-status-error border border-status-error/20">
                HUD error: {err.message}
              </div>
            )}>
              <Suspense fallback={
                <div class="flex items-center justify-center py-12">
                  <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-neon-purple" />
                </div>
              }>
                <HUDTab />
              </Suspense>
            </ErrorBoundary>
          </Show>
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

      {/* Agent Chat Modal */}
      <Show when={chatAgent()}>
        {(agent) => (
          <AgentChat
            agent={agent()}
            onClose={() => setChatAgent(null)}
          />
        )}
      </Show>

      {/* HUD Agent Session Panel */}
      <Show when={sessionAgent()}>
        {(agent) => (
          <AgentSessionPanel
            agent={agent()}
            onClose={() => setSessionAgent(null)}
          />
        )}
      </Show>
    </div>
  );
};

export default Agents;
