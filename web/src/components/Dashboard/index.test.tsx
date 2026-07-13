/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { HashRouter, Route } from '@solidjs/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { K8sNode, K8sPod, K8sService } from '../../lib/types';

type SummaryState = {
  agentActivity: { loading: boolean; activeAgents: number; totalTasks: number; pendingApprovals: number; error: string };
  agentCardError: string;
  agentDataState: 'ready' | 'fallback' | 'partial' | 'stale' | 'offline' | 'disabled';
  agentFeatureEnabled: boolean;
  cpuHistory: number[];
  cpuPercent: number;
  inferenceCardError: string;
  inferenceDataState: 'ready' | 'fallback' | 'partial' | 'stale' | 'offline' | 'disabled';
  inferenceFeatureEnabled: boolean;
  inferenceHealth: { loading: boolean; totalTps: number; modelCount: number; queueDepth: number; error: string };
  loomHUDPullEnabled: boolean;
  loomHUDPushEnabled: boolean;
  memHistory: number[];
  memUsed: number;
  modelCardError: string;
  modelCount: { deployed: number; total: number; loading: boolean };
  modelDataState: 'ready' | 'fallback' | 'partial' | 'stale' | 'offline' | 'disabled';
  resourceCardError: string;
  resourceDataState: 'ready' | 'fallback' | 'partial' | 'stale' | 'offline' | 'disabled';
  resourceLoading: boolean;
  tpsHistory: number[];
};

type TopologyFilterState = {
  clearFilters: ReturnType<typeof vi.fn>;
  filter: { namespace?: string; nodeName?: string; searchTerm?: string; status?: string[] };
  handleSearchChange: ReturnType<typeof vi.fn>;
  hasActiveFilter: boolean;
  isStatusActive: ReturnType<typeof vi.fn>;
  namespaceList: string[];
  nodeNameList: string[];
  searchInput: string;
  setFilter: ReturnType<typeof vi.fn>;
  setSearchInput: ReturnType<typeof vi.fn>;
  toggleStatusFilter: ReturnType<typeof vi.fn>;
};

const dashboardMocks = vi.hoisted(() => {
  const pulseCardCalls: Array<Record<string, unknown>> = [];
  const topologyProps = {
    nodes: [] as K8sNode[],
    pods: [] as K8sPod[],
    services: [] as K8sService[],
    topologyVersion: 0,
    styleVersion: 0,
  };

  const summaryState: SummaryState = {
    agentActivity: { loading: false, activeAgents: 0, totalTasks: 0, pendingApprovals: 0, error: '' },
    agentCardError: '',
    agentDataState: 'ready',
    agentFeatureEnabled: true,
    cpuHistory: [12, 18],
    cpuPercent: 18,
    inferenceCardError: '',
    inferenceDataState: 'ready',
    inferenceFeatureEnabled: true,
    inferenceHealth: { loading: false, totalTps: 0, modelCount: 0, queueDepth: 0, error: '' },
    loomHUDPullEnabled: true,
    loomHUDPushEnabled: false,
    memHistory: [8_000, 8_200],
    memUsed: 8_200,
    modelCardError: '',
    modelCount: { deployed: 0, total: 0, loading: false },
    modelDataState: 'ready',
    resourceCardError: '',
    resourceDataState: 'ready',
    resourceLoading: false,
    tpsHistory: [1, 2],
  };

  const topologyFilters: TopologyFilterState = {
    clearFilters: vi.fn(),
    filter: {},
    handleSearchChange: vi.fn(),
    hasActiveFilter: false,
    isStatusActive: vi.fn(() => false),
    namespaceList: [],
    nodeNameList: [],
    searchInput: '',
    setFilter: vi.fn(),
    setSearchInput: vi.fn(),
    toggleStatusFilter: vi.fn(),
  };

  const k8sStore = {
    nodes: [] as K8sNode[],
    pods: [] as K8sPod[],
    services: [] as K8sService[],
    lastUpdate: 0,
    topologyVersion: 0,
    styleVersion: 0,
    error: '',
    connectionStatus: 'connected' as 'connected' | 'connecting' | 'error' | 'disconnected',
  };

  const pulseCardMock = vi.fn((props: { title: string; value: string; sub?: string; meta?: string; loading?: boolean; error?: string }) => {
    pulseCardCalls.push(props);
    return (
      <div data-testid={`pulse-${props.title}`}>
        {`${props.title} ${props.value} ${props.sub ?? ''} ${props.meta ?? ''} ${props.error ?? ''} ${String(Boolean(props.loading))}`}
      </div>
    );
  });

  const topologyGraphMock = vi.fn((props: {
    nodes: K8sNode[];
    pods: K8sPod[];
    services: K8sService[];
    topologyVersion: number;
    styleVersion: number;
  }) => {
    topologyProps.nodes = props.nodes;
    topologyProps.pods = props.pods;
    topologyProps.services = props.services;
    topologyProps.topologyVersion = props.topologyVersion;
    topologyProps.styleVersion = props.styleVersion;
    return (
      <div
        data-testid="topology-graph"
        data-nodes={String(props.nodes.length)}
        data-pods={String(props.pods.length)}
        data-services={String(props.services.length)}
        data-topology-version={String(props.topologyVersion)}
        data-style-version={String(props.styleVersion)}
      />
    );
  });

  return {
    connectK8sStream: vi.fn(),
    dashboardFilters: topologyFilters,
    disconnectK8sStream: vi.fn(),
    k8sStore,
    pulseCardCalls,
    pulseCardMock,
    summaryState,
    summaryPollingStart: vi.fn(),
    summaryPollingStop: vi.fn(),
    topologyProps,
    topologyGraphMock,
  };
});

vi.mock('../../stores/k8s', () => ({
  connectionStatus: () => dashboardMocks.k8sStore.connectionStatus,
  connectK8sStream: dashboardMocks.connectK8sStream,
  disconnectK8sStream: dashboardMocks.disconnectK8sStream,
  isNodeReady: (node: K8sNode) =>
    Boolean(node.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True')),
  k8sStore: dashboardMocks.k8sStore,
}));

vi.mock('../../stores/dashboardSummary', () => ({
  startDashboardSummaryPolling: dashboardMocks.summaryPollingStart,
  stopDashboardSummaryPolling: dashboardMocks.summaryPollingStop,
}));

vi.mock('../../stores/metrics', () => ({
  getNodeMetrics: vi.fn(),
  getPodMetrics: vi.fn(),
  getUsageColor: vi.fn(),
  getUsageGradient: vi.fn(),
}));

vi.mock('../shared', () => ({
  DetailPanel: (props: { title: string }) => <div data-testid="detail-panel">{props.title}</div>,
  LoadingState: (props: { message?: string }) => <div data-testid="loading-state">{props.message ?? ''}</div>,
  EmptyState: (props: { title: string; subtitle?: string; action?: { label: string; onClick: () => void } }) => (
    <div data-testid="empty-state">
      {props.title}
      {props.subtitle ?? ''}
      {props.action ? (
        <button type="button" onClick={() => props.action!.onClick()}>
          {props.action.label}
        </button>
      ) : null}
    </div>
  ),
  PulseCard: dashboardMocks.pulseCardMock,
  TabBar: (props: { tabs: Array<{ id: string; label: string }>; active: string; onChange: (id: string) => void }) => (
    <div data-testid="tab-bar">
      {props.tabs.map((tab) => (
        <button type="button" data-active={String(props.active === tab.id)} onClick={() => props.onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('./TopologyGraph', () => ({
  default: dashboardMocks.topologyGraphMock,
}));

vi.mock('./HoloDeck', () => ({
  default: (props: { nodes: K8sNode[]; pods: K8sPod[]; services: K8sService[] }) => (
    <div
      data-testid="holodeck"
      data-nodes={String(props.nodes.length)}
      data-pods={String(props.pods.length)}
      data-services={String(props.services.length)}
    />
  ),
}));

vi.mock('./PodLogPanel', () => ({
  default: () => <div data-testid="pod-log-panel" />,
}));

vi.mock('./EventsFeed', () => ({
  default: () => <div data-testid="events-feed" />,
}));

vi.mock('./AlertsPanel', () => ({
  default: () => <div data-testid="alerts-panel" />,
}));

vi.mock('./LangfuseWidget', () => ({
  default: () => <div data-testid="langfuse-widget" />,
}));

vi.mock('./NodeResourcePanel', () => ({
  default: () => <div data-testid="node-resource-panel" />,
}));

vi.mock('./useDashboardSummaryState', () => ({
  useDashboardSummaryState: () => ({
    agentActivity: () => dashboardMocks.summaryState.agentActivity,
    agentCardError: () => dashboardMocks.summaryState.agentCardError,
    agentDataState: () => dashboardMocks.summaryState.agentDataState,
    agentFeatureEnabled: () => dashboardMocks.summaryState.agentFeatureEnabled,
    cpuHistory: () => dashboardMocks.summaryState.cpuHistory,
    cpuPercent: () => dashboardMocks.summaryState.cpuPercent,
    inferenceCardError: () => dashboardMocks.summaryState.inferenceCardError,
    inferenceDataState: () => dashboardMocks.summaryState.inferenceDataState,
    inferenceFeatureEnabled: () => dashboardMocks.summaryState.inferenceFeatureEnabled,
    inferenceHealth: () => dashboardMocks.summaryState.inferenceHealth,
    loomHUDPullEnabled: () => dashboardMocks.summaryState.loomHUDPullEnabled,
    loomHUDPushEnabled: () => dashboardMocks.summaryState.loomHUDPushEnabled,
    memHistory: () => dashboardMocks.summaryState.memHistory,
    memUsed: () => dashboardMocks.summaryState.memUsed,
    modelCardError: () => dashboardMocks.summaryState.modelCardError,
    modelCount: () => dashboardMocks.summaryState.modelCount,
    modelDataState: () => dashboardMocks.summaryState.modelDataState,
    resourceCardError: () => dashboardMocks.summaryState.resourceCardError,
    resourceDataState: () => dashboardMocks.summaryState.resourceDataState,
    resourceLoading: () => dashboardMocks.summaryState.resourceLoading,
    tpsHistory: () => dashboardMocks.summaryState.tpsHistory,
  }),
}));

vi.mock('./useDashboardTopologyFilters', () => ({
  useDashboardTopologyFilters: () => ({
    clearFilters: dashboardMocks.dashboardFilters.clearFilters,
    filter: () => dashboardMocks.dashboardFilters.filter,
    handleSearchChange: dashboardMocks.dashboardFilters.handleSearchChange,
    hasActiveFilter: () => dashboardMocks.dashboardFilters.hasActiveFilter,
    isStatusActive: dashboardMocks.dashboardFilters.isStatusActive,
    namespaceList: () => dashboardMocks.dashboardFilters.namespaceList,
    nodeNameList: () => dashboardMocks.dashboardFilters.nodeNameList,
    searchInput: () => dashboardMocks.dashboardFilters.searchInput,
    setFilter: dashboardMocks.dashboardFilters.setFilter,
    setSearchInput: dashboardMocks.dashboardFilters.setSearchInput,
    toggleStatusFilter: dashboardMocks.dashboardFilters.toggleStatusFilter,
  }),
}));

import Dashboard from './index';

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  // Router context is required since the pinned strip uses useNavigate.
  const dispose = render(() => (
    <HashRouter>
      <Route path="/" component={() => factory()} />
    </HashRouter>
  ), container);
  return () => {
    dispose();
    container.remove();
  };
}

function pageText(): string {
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function buildNode(name: string): K8sNode {
  return {
    metadata: { name },
    status: {
      conditions: [{ type: 'Ready', status: 'True' }],
    },
  };
}

function buildPod(name: string, namespace: string): K8sPod {
  return {
    metadata: { name, namespace },
    spec: { nodeName: 'node-a', containers: [] },
    status: { phase: 'Running' },
  };
}

function buildService(name: string, namespace: string): K8sService {
  return {
    metadata: { name, namespace },
    spec: { type: 'ClusterIP', selector: { app: 'api' } },
  };
}

describe('Dashboard shell', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    dashboardMocks.k8sStore.nodes = [];
    dashboardMocks.k8sStore.pods = [];
    dashboardMocks.k8sStore.services = [];
    dashboardMocks.k8sStore.lastUpdate = 0;
    dashboardMocks.k8sStore.topologyVersion = 0;
    dashboardMocks.k8sStore.styleVersion = 0;
    dashboardMocks.k8sStore.error = '';
    dashboardMocks.k8sStore.connectionStatus = 'connected';

    dashboardMocks.summaryState.agentActivity = { loading: false, activeAgents: 0, totalTasks: 0, pendingApprovals: 0, error: '' };
    dashboardMocks.summaryState.agentCardError = '';
    dashboardMocks.summaryState.agentDataState = 'ready';
    dashboardMocks.summaryState.agentFeatureEnabled = true;
    dashboardMocks.summaryState.cpuHistory = [12, 18];
    dashboardMocks.summaryState.cpuPercent = 18;
    dashboardMocks.summaryState.inferenceCardError = '';
    dashboardMocks.summaryState.inferenceDataState = 'ready';
    dashboardMocks.summaryState.inferenceFeatureEnabled = true;
    dashboardMocks.summaryState.inferenceHealth = { loading: false, totalTps: 0, modelCount: 0, queueDepth: 0, error: '' };
    dashboardMocks.summaryState.loomHUDPullEnabled = true;
    dashboardMocks.summaryState.loomHUDPushEnabled = false;
    dashboardMocks.summaryState.memHistory = [8_000, 8_200];
    dashboardMocks.summaryState.memUsed = 8_200;
    dashboardMocks.summaryState.modelCardError = '';
    dashboardMocks.summaryState.modelCount = { deployed: 0, total: 0, loading: false };
    dashboardMocks.summaryState.modelDataState = 'ready';
    dashboardMocks.summaryState.resourceCardError = '';
    dashboardMocks.summaryState.resourceDataState = 'ready';
    dashboardMocks.summaryState.resourceLoading = false;
    dashboardMocks.summaryState.tpsHistory = [1, 2];

    dashboardMocks.dashboardFilters.clearFilters.mockClear();
    dashboardMocks.dashboardFilters.handleSearchChange.mockClear();
    dashboardMocks.dashboardFilters.isStatusActive.mockClear();
    dashboardMocks.dashboardFilters.setFilter.mockClear();
    dashboardMocks.dashboardFilters.setSearchInput.mockClear();
    dashboardMocks.dashboardFilters.toggleStatusFilter.mockClear();
    dashboardMocks.topologyGraphMock.mockClear();
    dashboardMocks.pulseCardMock.mockClear();
    dashboardMocks.pulseCardCalls.length = 0;
    dashboardMocks.connectK8sStream.mockClear();
    dashboardMocks.disconnectK8sStream.mockClear();
    dashboardMocks.summaryPollingStart.mockClear();
    dashboardMocks.summaryPollingStop.mockClear();

    dashboardMocks.k8sStore.error = '';
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
    localStorage.removeItem('flexdeck.pref.dashboard.layout');
  });

  it('wires dashboard summary cards and topology props from the shell', () => {
    dashboardMocks.k8sStore.nodes = [buildNode('node-a')];
    dashboardMocks.k8sStore.pods = [buildPod('pod-a', 'apps')];
    dashboardMocks.k8sStore.services = [buildService('svc-a', 'apps')];
    dashboardMocks.k8sStore.lastUpdate = Date.now();
    dashboardMocks.k8sStore.topologyVersion = 11;
    dashboardMocks.k8sStore.styleVersion = 22;

    dashboardMocks.summaryState.agentActivity = {
      loading: false,
      activeAgents: 4,
      totalTasks: 9,
      pendingApprovals: 2,
      error: '',
    };
    dashboardMocks.summaryState.cpuPercent = 61.3;
    dashboardMocks.summaryState.inferenceHealth = {
      loading: false,
      totalTps: 12.5,
      modelCount: 5,
      queueDepth: 1,
      error: '',
    };
    dashboardMocks.summaryState.memUsed = 12_345;
    dashboardMocks.summaryState.modelCount = { deployed: 2, total: 3, loading: false };
    dashboardMocks.summaryState.tpsHistory = [4, 8];

    cleanup = mount(() => <Dashboard />);

    expect(dashboardMocks.connectK8sStream).toHaveBeenCalledTimes(1);
    expect(dashboardMocks.summaryPollingStart).toHaveBeenCalledTimes(1);
    expect(dashboardMocks.topologyGraphMock).toHaveBeenCalledTimes(1);
    expect(dashboardMocks.topologyProps).toMatchObject({
      nodes: dashboardMocks.k8sStore.nodes,
      pods: dashboardMocks.k8sStore.pods,
      services: dashboardMocks.k8sStore.services,
      topologyVersion: 11,
      styleVersion: 22,
    });

    expect(pageText()).toContain('Pods 1/1');
    expect(pageText()).toContain('Nodes 1/1');
    expect(pageText()).toContain('Models 2/3');
    expect(pageText()).toContain('Inference 12.5');
    expect(pageText()).toContain('Agents 4');
    expect(document.querySelector('[data-testid="topology-graph"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="topology-skeleton"]')).toBeNull();
  });

  it('shows the loading skeleton while cluster data is still empty', () => {
    dashboardMocks.k8sStore.lastUpdate = 0;
    dashboardMocks.k8sStore.connectionStatus = 'connected';

    cleanup = mount(() => <Dashboard />);

    expect(document.querySelector('[data-testid="topology-skeleton"]')).toBeTruthy();
    expect(dashboardMocks.topologyGraphMock).not.toHaveBeenCalled();
  });

  it('shows a reset escape hatch instead of a blank page when every section is hidden', () => {
    localStorage.setItem(
      'flexdeck.pref.dashboard.layout',
      JSON.stringify([
        { id: 'pinned', visible: false },
        { id: 'cluster', visible: false },
        { id: 'ai-ops', visible: false },
        { id: 'main', visible: false },
      ]),
    );

    cleanup = mount(() => <Dashboard />);

    expect(pageText()).toContain('All sections hidden');
    expect(dashboardMocks.pulseCardMock).not.toHaveBeenCalled();

    const reset = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Reset layout');
    expect(reset).toBeTruthy();
    reset!.click();

    expect(pageText()).not.toContain('All sections hidden');
    expect(document.querySelector('[data-testid="pulse-Pods"]')).toBeTruthy();
  });

  it('surfaces an offline cluster error through the summary cards', () => {
    dashboardMocks.k8sStore.connectionStatus = 'error';
    dashboardMocks.k8sStore.error = 'K8s API offline';
    dashboardMocks.k8sStore.lastUpdate = 0;

    cleanup = mount(() => <Dashboard />);

    expect(pageText()).toContain('K8s API offline');
    expect(pageText()).toContain('OFFLINE');
    expect(pageText()).toContain('K8s API offline');
    expect(document.querySelector('[data-testid="topology-skeleton"]')).toBeNull();
  });
});
