/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dashboardMocks = vi.hoisted(() => {
  const pollTasks = new Map<string, () => Promise<void> | void>();

  return {
    agentsList: vi.fn(),
    pollTasks,
    healthFeatures: {
      flexinfer_proxy: { enabled: true },
      loom_hud: { enabled: true },
      loom_hud_push: { enabled: false },
    },
    hudFleet: vi.fn(),
    metricsStore: {
      clusterCpu: 61,
      clusterMemory: 12_000,
      loading: false,
      error: '',
      lastUpdate: Date.now(),
    },
    modelsList: vi.fn(),
    pollingRegister: vi.fn((id: string, task: () => Promise<void> | void) => {
      pollTasks.set(id, task);
    }),
    pollingUnregister: vi.fn((id: string) => {
      pollTasks.delete(id);
    }),
    proxyMetrics: vi.fn(),
  };
});

vi.mock('../../lib/polling', () => ({
  pollingScheduler: {
    register: dashboardMocks.pollingRegister,
    trigger: vi.fn(async (id: string) => {
      const task = dashboardMocks.pollTasks.get(id);
      await task?.();
    }),
    unregister: dashboardMocks.pollingUnregister,
  },
}));

vi.mock('../../lib/api', () => ({
  agentsApi: {
    list: dashboardMocks.agentsList,
  },
  flexinferProxyApi: {
    metrics: dashboardMocks.proxyMetrics,
  },
  hudApi: {
    fleet: dashboardMocks.hudFleet,
  },
  modelsApi: {
    list: dashboardMocks.modelsList,
  },
}));

vi.mock('../../stores/health', () => ({
  healthStore: {
    features: dashboardMocks.healthFeatures,
  },
}));

vi.mock('../../stores/metrics', () => ({
  metricsStore: dashboardMocks.metricsStore,
}));

import { useDashboardSummaryState } from './useDashboardSummaryState';

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return () => {
    dispose();
    container.remove();
  };
}

describe('useDashboardSummaryState', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    dashboardMocks.healthFeatures.flexinfer_proxy.enabled = true;
    dashboardMocks.healthFeatures.loom_hud.enabled = true;
    dashboardMocks.healthFeatures.loom_hud_push.enabled = false;

    dashboardMocks.metricsStore.clusterCpu = 61;
    dashboardMocks.metricsStore.clusterMemory = 12_000;
    dashboardMocks.metricsStore.loading = false;
    dashboardMocks.metricsStore.error = '';
    dashboardMocks.metricsStore.lastUpdate = Date.now();

    dashboardMocks.modelsList.mockReset();
    dashboardMocks.proxyMetrics.mockReset();
    dashboardMocks.hudFleet.mockReset();
    dashboardMocks.agentsList.mockReset();
    dashboardMocks.pollTasks.clear();
    dashboardMocks.pollingRegister.mockClear();
    dashboardMocks.pollingUnregister.mockClear();

    dashboardMocks.modelsList.mockResolvedValue({
      models: [
        { deployment_status: 'deployed' },
        { deployment_status: 'pending' },
      ],
    });
    dashboardMocks.proxyMetrics.mockResolvedValue({
      requests: {},
      latency: {},
      queue_depth: {},
      active_conn: {},
      scale_ups: {},
      byModel: {
        alpha: {
          requestsTotal: 24,
          errorsTotal: 0,
          queueDepth: 2,
          activeConnections: 1,
          scaleUps: 0,
          queueRejectedTotal: 0,
          queuedRequestsTotal: 0,
        },
      },
      totals: {
        modelCount: 1,
        requestsTotal: 24,
        errorsTotal: 0,
        queueDepth: 2,
        activeConnections: 1,
        scaleUps: 0,
        queueRejectedTotal: 0,
        queuedRequestsTotal: 0,
        errorRate: 0,
        parseErrors: 0,
      },
      requestsByStatus: {},
      partial: false,
    });
    dashboardMocks.hudFleet.mockResolvedValue({
      agents: [{ status: 'active' }, { status: 'idle' }],
      tasks: [{ status: 'completed' }, { status: 'pending' }],
      kpis: { pending_approvals: 2 },
    });
    dashboardMocks.agentsList.mockResolvedValue({
      agents: [
        {
          status: 'healthy',
          type: 'cli-agent',
          metadata: { source: 'hud', session_count: 4, presence_status: 'active' },
        },
        {
          status: 'healthy',
          type: 'cli-agent',
          metadata: { source: 'hud', session_count: 1, presence_status: 'idle' },
        },
      ],
    });
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  it('marks HUD agent state as partial in push-only mode while preserving activity totals', async () => {
    dashboardMocks.healthFeatures.loom_hud.enabled = false;
    dashboardMocks.healthFeatures.loom_hud_push.enabled = true;

    let state!: ReturnType<typeof useDashboardSummaryState>;
    cleanup = mount(() => {
      state = useDashboardSummaryState({
        metricsRefreshInterval: 15_000,
        staleAfterMs: 45_000,
      });
      return <div />;
    });

    await vi.waitFor(() => {
      expect(state.agentActivity().loading).toBe(false);
    });

    expect(dashboardMocks.pollingRegister).toHaveBeenCalledWith(
      'dash-agents',
      expect.any(Function),
      15_000,
      false,
    );
    expect(dashboardMocks.agentsList).toHaveBeenCalled();
    expect(dashboardMocks.agentsList).toHaveBeenCalledTimes(1);
    expect(state.agentFeatureEnabled()).toBe(true);
    expect(state.loomHUDPullEnabled()).toBe(false);
    expect(state.loomHUDPushEnabled()).toBe(true);
    expect(state.agentDataState()).toBe('fallback');
    expect(state.agentActivity()).toMatchObject({
      activeAgents: 1,
      totalTasks: 5,
      pendingApprovals: 0,
      error: '',
    });
  });

  it('treats inference as disabled when the flexinfer proxy feature is disabled', () => {
    dashboardMocks.healthFeatures.flexinfer_proxy.enabled = false;
    dashboardMocks.healthFeatures.loom_hud.enabled = false;

    let state!: ReturnType<typeof useDashboardSummaryState>;
    cleanup = mount(() => {
      state = useDashboardSummaryState({
        metricsRefreshInterval: 15_000,
        staleAfterMs: 45_000,
      });
      return <div />;
    });

    expect(dashboardMocks.proxyMetrics).not.toHaveBeenCalled();
    expect(state.inferenceFeatureEnabled()).toBe(false);
    expect(state.inferenceDataState()).toBe('disabled');
    expect(state.inferenceCardError()).toBe('');
  });

  it('uses the HUD fleet payload for ready pull-mode agent summaries', async () => {
    dashboardMocks.healthFeatures.loom_hud.enabled = true;
    dashboardMocks.healthFeatures.loom_hud_push.enabled = false;

    let state!: ReturnType<typeof useDashboardSummaryState>;
    cleanup = mount(() => {
      state = useDashboardSummaryState({
        metricsRefreshInterval: 15_000,
        staleAfterMs: 45_000,
      });
      return <div />;
    });

    await vi.waitFor(() => {
      expect(state.agentActivity().loading).toBe(false);
    });

    expect(dashboardMocks.pollingRegister).toHaveBeenCalledWith(
      'dash-agents',
      expect.any(Function),
      15_000,
      false,
    );
    expect(dashboardMocks.hudFleet).toHaveBeenCalled();
    expect(dashboardMocks.hudFleet).toHaveBeenCalledTimes(1);
    expect(state.agentDataState()).toBe('ready');
    expect(state.agentActivity()).toMatchObject({
      activeAgents: 1,
      totalTasks: 1,
      pendingApprovals: 2,
      error: '',
    });
  });
});
