import { Component, createEffect, createMemo, createSignal, For, on, Show, lazy, Suspense, ErrorBoundary } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { Agent, AgentNode, AgentEdge } from '../../lib/types';
import { agentsApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import { LoadingState, EmptyState, ErrorState, OperationsSidebarNav } from '../shared';
import PageScrollBody from '../shared/PageScrollBody';
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

type OperationsSection = 'overview' | 'presence' | 'workflows' | 'claims' | 'timeline' | 'registry' | 'flow';
type EditableAgentType = 'langgraph' | 'custom';

const toEditableAgentType = (type: Agent['type']): EditableAgentType =>
  type === 'langgraph' ? 'langgraph' : 'custom';

const Agents: Component = () => {
  const [agents, setAgents] = createStore<Agent[]>([]);
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
  }, 10000, () => !isToolingSection(), false);

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
    {
      id: 'overview' as const,
      label: 'Overview',
      eyebrow: 'Cockpit',
      detail: 'Start with a live HUD briefing, then move into a focused lane.',
      group: 'Primary',
    },
    {
      id: 'presence' as const,
      label: 'Presence & tasks',
      eyebrow: 'Live HUD',
      detail: 'Who is active and how much slice work is building.',
      group: 'Live HUD',
    },
    {
      id: 'workflows' as const,
      label: 'Workflow queue',
      eyebrow: 'Live HUD',
      detail: 'Approvals, rejections, and in-flight execution.',
      group: 'Live HUD',
    },
    {
      id: 'claims' as const,
      label: 'Claim ledger',
      eyebrow: 'Live HUD',
      detail: 'File pressure and conflict hotspots across the workspace.',
      group: 'Live HUD',
    },
    {
      id: 'timeline' as const,
      label: 'Timeline',
      eyebrow: 'Live HUD',
      detail: 'Heartbeat and workflow event feed health.',
      group: 'Live HUD',
    },
    {
      id: 'registry' as const,
      label: 'Registry',
      eyebrow: 'Tooling',
      detail: 'Definitions, health checks, and manual agent tools.',
      group: 'Tooling',
    },
    {
      id: 'flow' as const,
      label: 'Flow graph',
      eyebrow: 'Tooling',
      detail: 'Relationship view for registered agents.',
      group: 'Tooling',
    },
  ]);

  const hudFocus = createMemo(() => {
    switch (activeSection()) {
      case 'overview':
        return 'overview' as const;
      case 'presence':
        return 'presence' as const;
      case 'workflows':
        return 'workflows' as const;
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
      <div class="glass-panel flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="rounded-full border border-neon-cyan/30 bg-neon-cyan/10 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.22em] text-neon-cyan">
              Loom HUD
            </span>
            <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-text-dim">
              Operations console
            </span>
          </div>
          <h2 class="text-xl font-semibold tracking-tight text-text-main">Live agent control plane</h2>
          <p class="max-w-3xl text-sm text-text-dim">
            The HUD is the primary surface now. Registry, graph, and manual agent tools remain available, but they sit behind the live operational view.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <Show when={hudEntry().directEntryEnabled && hudEntry().directUrl}>
            <button
              type="button"
              onClick={() => window.open(hudEntry().directUrl!, '_blank', 'noopener,noreferrer')}
              class="rounded-md bg-neon-cyan/20 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30"
            >
              Open web HUD
            </button>
          </Show>
          <button
            onClick={() => { fetchAgents(); fetchGraph(); }}
            disabled={loading() || !isToolingSection()}
            class="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh registry
          </button>
        </div>
      </div>

      <Show when={error() && isToolingSection()}>
        <ErrorState message={error()} />
      </Show>

      <PageScrollBody
        class={activeSection() === 'flow' ? 'overflow-hidden' : ''}
        viewportRef={(element) => { scrollViewport = element; }}
      >
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
          <OperationsSidebarNav
            title="Operations lanes"
            description="The live HUD and the older registry tools now share one page shell. Pick a lane on the left instead of scanning the whole surface at once."
            items={sectionNav()}
            active={activeSection()}
            onChange={(section) => setActiveSection(section as OperationsSection)}
          />

          <div class="min-w-0">
        <Show when={!isToolingSection()}>
          <ErrorBoundary fallback={(err) => (
            <div class="glass-panel border border-status-error/20 p-4 text-sm text-status-error">
              HUD error: {err.message}
            </div>
          )}>
            <Suspense fallback={
              <div class="flex items-center justify-center py-12">
                <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-neon-purple" />
              </div>
            }>
              <div class="space-y-4">
                <HUDTab focus={hudFocus()} />
                <Show when={activeSection() === 'overview'}>
                  <div class="grid gap-4 lg:grid-cols-2">
                    <div class="glass-panel p-4">
                      <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim">Tooling lanes</div>
                      <div class="mt-3 grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => setActiveSection('registry')}
                          class="rounded-2xl border border-white/8 bg-white/5 p-4 text-left transition-colors hover:border-neon-cyan/20 hover:bg-white/7"
                        >
                          <div class="text-sm font-medium text-text-main">Registry</div>
                          <div class="mt-1 text-xs leading-5 text-text-dim">Definitions, health checks, and manual agent controls remain available here when you need deeper tooling.</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveSection('flow')}
                          class="rounded-2xl border border-white/8 bg-white/5 p-4 text-left transition-colors hover:border-neon-cyan/20 hover:bg-white/7"
                        >
                          <div class="text-sm font-medium text-text-main">Flow graph</div>
                          <div class="mt-1 text-xs leading-5 text-text-dim">Switch to the relationship graph when you need to inspect topology instead of live operator pressure.</div>
                        </button>
                      </div>
                    </div>

                    <div class="glass-panel p-4">
                      <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-dim">Operating posture</div>
                      <div class="mt-3 space-y-3 text-sm text-text-dim">
                        <div class="rounded-md border border-white/5 bg-black/20 p-3">
                          <div class="font-medium text-text-main">Live HUD first</div>
                          <div class="mt-1 text-xs">Presence, work queue, claims, and the timeline now act as the primary control plane.</div>
                        </div>
                        <div class="rounded-md border border-white/5 bg-black/20 p-3">
                          <div class="font-medium text-text-main">Tooling second</div>
                          <div class="mt-1 text-xs">Registry and graph views are still available, but they no longer compete with the live operations surface for attention.</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Show>
              </div>
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
                  <div class="glass-panel flex items-center justify-between px-4 py-3">
                    <div>
                      <div class="text-sm font-medium text-text-main">Registry support</div>
                      <div class="text-xs text-text-dim">Agent definitions, graph relationships, and health checks live here when you need them.</div>
                    </div>
                    <button
                      onClick={openCreateForm}
                      class="rounded-md bg-neon-cyan/20 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30"
                    >
                      + Add Agent
                    </button>
                  </div>

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
