import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DashboardSummaryResponse } from '../lib/api/infrastructure';

const mocks = vi.hoisted(() => {
  const pollTasks = new Map<string, () => Promise<void> | void>();

  return {
    pollTasks,
    register: vi.fn((id: string, task: () => Promise<void> | void) => {
      pollTasks.set(id, task);
    }),
    summary: vi.fn<() => Promise<DashboardSummaryResponse>>(),
    unregister: vi.fn((id: string) => {
      pollTasks.delete(id);
    }),
  };
});

vi.mock('../lib/api/infrastructure', () => ({
  dashboardApi: {
    summary: mocks.summary,
  },
}));

vi.mock('../lib/polling', () => ({
  pollingScheduler: {
    register: mocks.register,
    unregister: mocks.unregister,
  },
}));

function buildSummary(updatedAt: string, cpuPercent: number): DashboardSummaryResponse {
  return {
    cluster: {
      cpu_percent: cpuPercent,
      memory_used: 512,
      memory_total: 1024,
    },
    nodes: [
      {
        node: 'node-a',
        cpu_percent: cpuPercent,
        mem_percent: 50,
        mem_used: 512,
        mem_total: 1024,
        gpu: null,
      },
    ],
    pods: [
      {
        namespace: 'apps',
        pod: 'api-0',
        cpu_percent: cpuPercent / 2,
        memory_used: 128,
        memory_limit: 256,
      },
    ],
    updated_at: updatedAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('dashboardSummary + metricsStore', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.summary.mockReset();
    mocks.register.mockClear();
    mocks.unregister.mockClear();
    mocks.pollTasks.clear();
  });

  it('hydrates metrics from the server timestamp instead of stamping a local refresh time', async () => {
    const updatedAt = '2026-04-07T18:15:00.000Z';
    mocks.summary.mockResolvedValue(buildSummary(updatedAt, 37.5));

    const dashboardSummaryStore = await import('./dashboardSummary');
    const metricsStoreModule = await import('./metrics');

    await dashboardSummaryStore.refreshDashboardSummary();

    expect(dashboardSummaryStore.dashboardSummaryLoading()).toBe(false);
    expect(dashboardSummaryStore.dashboardSummaryRefreshing()).toBe(false);
    expect(dashboardSummaryStore.dashboardSummaryError()).toBeNull();
    expect(dashboardSummaryStore.dashboardSummaryUpdatedAt()).toBe(Date.parse(updatedAt));

    expect(metricsStoreModule.metricsStore.clusterCpu).toBe(37.5);
    expect(metricsStoreModule.metricsStore.clusterMemory).toBe(512);
    expect(metricsStoreModule.metricsStore.loading).toBe(false);
    expect(metricsStoreModule.metricsStore.error).toBeNull();
    expect(metricsStoreModule.metricsStore.lastUpdate).toBe(Date.parse(updatedAt));
  });

  it('keeps the last good snapshot while a refresh is in flight and surfaces stale errors on failure', async () => {
    const initialUpdatedAt = '2026-04-07T18:15:00.000Z';
    const refreshRequest = deferred<DashboardSummaryResponse>();

    mocks.summary
      .mockResolvedValueOnce(buildSummary(initialUpdatedAt, 27.3))
      .mockImplementationOnce(() => refreshRequest.promise);

    const dashboardSummaryStore = await import('./dashboardSummary');
    const metricsStoreModule = await import('./metrics');

    await dashboardSummaryStore.refreshDashboardSummary();

    const refreshPromise = dashboardSummaryStore.refreshDashboardSummary();

    expect(dashboardSummaryStore.dashboardSummaryLoading()).toBe(false);
    expect(dashboardSummaryStore.dashboardSummaryRefreshing()).toBe(true);
    expect(metricsStoreModule.metricsStore.clusterCpu).toBe(27.3);
    expect(metricsStoreModule.metricsStore.loading).toBe(true);
    expect(metricsStoreModule.metricsStore.lastUpdate).toBe(Date.parse(initialUpdatedAt));

    refreshRequest.reject(new Error('summary offline'));
    await refreshPromise;

    expect(dashboardSummaryStore.dashboardSummaryRefreshing()).toBe(false);
    expect(dashboardSummaryStore.dashboardSummaryError()).toBe('summary offline');
    expect(metricsStoreModule.metricsStore.clusterCpu).toBe(27.3);
    expect(metricsStoreModule.metricsStore.loading).toBe(false);
    expect(metricsStoreModule.metricsStore.error).toBe('summary offline');
    expect(metricsStoreModule.metricsStore.lastUpdate).toBe(Date.parse(initialUpdatedAt));
  });
});
