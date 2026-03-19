import { Component, createSignal, For, Show, lazy, Suspense, ErrorBoundary } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Agent, AgentNode, AgentEdge } from '../../lib/types';
import { agentsApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import { TabBar, LoadingState, EmptyState, ErrorState } from '../shared';
import PageScrollBody from '../shared/PageScrollBody';
import AgentChat from './AgentChat';
import AgentFlowGraph from './AgentFlowGraph';
import AgentSessionPanel from './AgentSessionPanel';
import HUDAgentCard from './HUDAgentCard';
import StandardAgentCard from './StandardAgentCard';
import AgentFormModal from './AgentFormModal';
import { isHUDAgent } from './hudUtils';

const HUDTab = lazy(() => import('./HUDTab'));

type ViewMode = 'grid' | 'flow' | 'hud';
type EditableAgentType = 'langgraph' | 'custom';

const toEditableAgentType = (type: Agent['type']): EditableAgentType =>
  type === 'langgraph' ? 'langgraph' : 'custom';

const VIEW_TABS = [
  { id: 'grid' as const, label: 'Grid' },
  { id: 'flow' as const, label: 'Flow' },
  { id: 'hud' as const, label: 'HUD' },
];

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
    type: 'langgraph' as EditableAgentType,
    url: '',
    api_key: '',
    model: '',
    tags: '',
  });

  // Chat/Test state
  const [chatAgent, setChatAgent] = createSignal<Agent | null>(null);
  // Session panel for HUD agents
  const [sessionAgent, setSessionAgent] = createSignal<Agent | null>(null);

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

  createPolling('agents-main', () => {
    void fetchAgents();
    void fetchGraph();
    void checkHealth();
  }, 10000);

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
      type: toEditableAgentType(agent.type),
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
    <div class="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div class="glass-panel flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex items-center gap-3 sm:gap-4">
          <h2 class="text-lg font-medium text-text-main">AI Agents</h2>
          <span class="text-sm text-text-dim">
            {agents.filter(a => a.status === 'healthy').length} healthy
          </span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <TabBar
            tabs={VIEW_TABS}
            active={viewMode()}
            onChange={(id) => setViewMode(id as ViewMode)}
            size="md"
          />
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
        <ErrorState message={error()} />
      </Show>

      <PageScrollBody class={viewMode() === 'grid' ? '' : 'overflow-hidden'}>
      {/* Content area */}
      <Show
        when={!loading() || agents.length > 0}
        fallback={<LoadingState message="Loading agents..." />}
      >
        <Show
          when={agents.length > 0}
          fallback={
            <EmptyState
              icon="🤖"
              title="No Agents Registered"
              subtitle="Add your first agent to get started."
              action={{ label: '+ Add Agent', onClick: openCreateForm }}
            />
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

                  if (isHUDAgent(agent)) {
                    return (
                      <HUDAgentCard
                        agent={agent}
                        onOpenSessions={openChat}
                      />
                    );
                  }

                  return (
                    <StandardAgentCard
                      agent={agent}
                      isBuiltIn={isBuiltIn}
                      onChat={openChat}
                      onCheckHealth={handleCheckHealth}
                      onEdit={openEditForm}
                      onDelete={handleDelete}
                      actionLoading={actionLoading()}
                      getStatusColor={getStatusColor}
                      getStatusDot={getStatusDot}
                    />
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
      </PageScrollBody>

      {/* Create/Edit Form Modal */}
      <Show when={showForm()}>
        <AgentFormModal
          formData={formData}
          setFormData={setFormData}
          editingAgent={editingAgent()}
          actionLoading={actionLoading()}
          onSubmit={handleSubmit}
          onClose={() => setShowForm(false)}
        />
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
