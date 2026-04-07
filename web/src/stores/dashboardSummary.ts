import { batch, createSignal } from 'solid-js';
import { dashboardApi } from '../lib/api/infrastructure';
import type { DashboardSummaryResponse } from '../lib/api/infrastructure';
import { pollingScheduler } from '../lib/polling';

const POLL_INTERVAL = 15_000;
const POLL_ID = 'dashboard-summary';

const [summary, setSummary] = createSignal<DashboardSummaryResponse | null>(null);
const [summaryLoading, setSummaryLoading] = createSignal(true);
const [summaryRefreshing, setSummaryRefreshing] = createSignal(false);
const [summaryError, setSummaryError] = createSignal<string | null>(null);
const [summaryUpdatedAt, setSummaryUpdatedAt] = createSignal(0);

function resolveSummaryUpdatedAtMs(data: DashboardSummaryResponse): number {
  const parsed = Date.parse(data.updated_at);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

async function fetchSummary() {
  const hasSnapshot = summary() !== null;

  batch(() => {
    if (hasSnapshot) {
      setSummaryRefreshing(true);
    } else {
      setSummaryLoading(true);
    }
    setSummaryError(null);
  });

  try {
    const data = await dashboardApi.summary();
    batch(() => {
      setSummary(data);
      setSummaryUpdatedAt(resolveSummaryUpdatedAtMs(data));
      setSummaryLoading(false);
      setSummaryRefreshing(false);
      setSummaryError(null);
    });
  } catch (err) {
    batch(() => {
      setSummaryLoading(false);
      setSummaryRefreshing(false);
      setSummaryError(err instanceof Error ? err.message : 'Failed to fetch dashboard summary');
    });
  }
}

export async function refreshDashboardSummary() {
  await fetchSummary();
}

export function startDashboardSummaryPolling() {
  pollingScheduler.register(POLL_ID, refreshDashboardSummary, POLL_INTERVAL);
}

export function stopDashboardSummaryPolling() {
  pollingScheduler.unregister(POLL_ID);
}

export {
  summary as dashboardSummary,
  summaryError as dashboardSummaryError,
  summaryLoading as dashboardSummaryLoading,
  summaryRefreshing as dashboardSummaryRefreshing,
  summaryUpdatedAt as dashboardSummaryUpdatedAt,
};
