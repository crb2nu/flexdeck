import { Component, createEffect, createMemo, createSignal, For, on, Show, lazy, Suspense, ErrorBoundary } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Agent, AgentNode, AgentEdge } from '../../lib/types';
import { agentsApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import { stableListByKey } from '../../lib/stableList';
import { LoadingState, EmptyState, ErrorState, OperationsSidebarNav } from '../shared';
import PageScrollBody from '../shared/PageScrollBody';
import PageHeader from '../shared/PageHeader';
import Button from '../shared/Button';
import { getHudEntryState } from '../../lib/featureFlags';
import { healthStore } from '../../stores/health';
import AgentChat from './AgentChat';
import AgentFlowGraph from './AgentFlowGraph';
import AgentSessionPanel from './AgentSessionPanel';
import HUDAgentCard from './HUDAgentCard';
import StandardAgentCard from './StandardAgentCard';
import AgentFormModal from './AgentFormModal';
import { isHUDAgent } from './hudUtils';

const HUDTab = lazy(() => import('./HUDTab'));

type OperationsSection = 'overview' | 'presence' | 'sessions' | 'workflows' | 'handoffs' | 'claims' | 'timeline' | 'registry' | 'flow';
type EditableAgentType = 'langgraph' | 'custom';

const toEditableAgentType = (type: Agent['type']): EditableAgentType =>
  type === 'langgraph' ? 'langgraph' : 'custom';

const Agents: Component = () => {
  const [agents, setAgents] = createStore<Agent[]>([]);
  // Each poll replaces the whole store array with freshly-built objects, which
  // tears down every registry card's DOM (losing hover/menu state). Reuse the
  // prior object ref for any agent whose structural signature is unchanged so
  // <For> can skip the remount.
  const stableAgents = stableListByKey(() => agents, (agent) => agent.id);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);
  const [activeSection, setActiveSection] = createSignal<OperationsSection>('overview');
  const hudEntry = createMemo(() => getHudEntryState(healthStore.features || {}));
  const isToolingSection = createMemo(() => activeSection() === 'registry' || activeSection() === 'flow');
  let scrollViewport: HTMLDivElement | undefined;

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

  createPolling('agents-main', async () => {
    await Promise.all([fetchAgents(), fetchGraph(), checkHealth()]);
  }, 10000, isToolingSection, false);

  createEffect(() => {
    if (isToolingSection()) {
      void Promise.all([fetchAgents(), fetchGraph(), checkHealth()]);
    }
  });

  createEffect(on(activeSection, () => {
    queueMicrotask(() => {
      scrollViewport?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    });
  }, { defer: true }));

  const sectionNav = createMemo(() => [
    { id: 'overview' as const, label: 'Overview', group: 'Primary' },
    { id: 'presence' as const, label: 'Presence & tasks', group: 'Live HUD' },
    { id: 'sessions' as const, label: 'Sessions', group: 'Live HUD' },
    { id: 'workflows' as const, label: 'Workflow queue', group: 'Live HUD' },
    { id: 'handoffs' as const, label: 'Handoff inbox', group: 'Live HUD' },
    { id: 'claims' as const, label: 'Claim ledger', group: 'Live HUD' },
    { id: 'timeline' as const, label: 'Timeline', group: 'Live HUD' },
    { id: 'registry' as const, label: 'Registry', group: 'Tooling' },
    { id: 'flow' as const, label: 'Flow graph', group: 'Tooling' },
  ]);

  const hudFocus = createMemo(() => {
    switch (activeSection()) {
      case 'overview':
        return 'overview' as const;
      case 'presence':
        return 'presence' as const;
      case 'sessions':
        return 'sessions' as const;
      case 'workflows':
        return 'workflows' as const;
      case 'handoffs':
        return 'handoffs' as const;
      case 'claims':
        return 'claims' as const;
      case 'timeline':
        return 'timeline' as const;
      default:
        return 'full' as const;
    }
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
      <PageHeader title="Agents">
        <Show when={hudEntry().directEntryEnabled && hudEntry().directUrl}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.open(hudEntry().directUrl!, '_blank', 'noopener,noreferrer')}
          >
            Open web HUD
          </Button>
        </Show>
        <Show when={isToolingSection()}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { fetchAgents(); fetchGraph(); }}
            disabled={loading()}
          >
            Refresh registry
          </Button>
        </Show>
      </PageHeader>

      <Show when={error() && isToolingSection()}>
        <ErrorState message={error()} />
      </Show>

      <PageScrollBody
        class={activeSection() === 'flow' ? 'overflow-hidden' : ''}
        viewportRef={(element) => { scrollViewport = element; }}
      >
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
          <OperationsSidebarNav
            title="Agents"
            description=""
            items={sectionNav()}
            active={activeSection()}
            onChange={(section) => setActiveSection(section as OperationsSection)}
          />

          <div class="min-w-0">
        <Show when={!isToolingSection()}>
          <ErrorBoundary fallback={(err) => (
            <div class="surface border-status-error/20 p-4 text-sm text-status-error">
              HUD error: {err.message}
            </div>
          )}>
            <Suspense fallback={
              <div class="flex items-center justify-center py-12">
                <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-white" />
              </div>
            }>
              <HUDTab focus={hudFocus()} />
            </Suspense>
          </ErrorBoundary>
        </Show>

        <Show when={isToolingSection()}>
          <Show
            when={!loading() || agents.length > 0}
            fallback={<LoadingState message="Loading registry..." />}
          >
            <Show
              when={agents.length > 0}
              fallback={
                <EmptyState
                  icon="◈"
                  title="Registry utilities are quiet"
                  subtitle="The HUD is still available. Add an agent only if you need registry, graph, or chat tools."
                  action={{ label: '+ Add Agent', onClick: openCreateForm }}
                />
              }
            >
              <Show when={activeSection() === 'flow'}>
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

              <Show when={activeSection() === 'registry'}>
                <div class="space-y-4">
                  <div class="surface flex items-center justify-between px-4 py-3">
                    <span class="heading-section">Registry</span>
                    <Button variant="primary" size="sm" onClick={openCreateForm}>
                      + Add Agent
                    </Button>
                  </div>

                  <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <For each={stableAgents()}>
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
                </div>
              </Show>
            </Show>
          </Show>
        </Show>
          </div>
        </div>
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
