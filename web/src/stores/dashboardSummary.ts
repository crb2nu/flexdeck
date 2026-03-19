import { createSignal } from 'solid-js';
import { dashboardApi } from '../lib/api/infrastructure';
import type { DashboardSummaryResponse } from '../lib/api/infrastructure';
import { pollingScheduler } from '../lib/polling';

const POLL_INTERVAL = 15_000;
const POLL_ID = 'dashboard-summary';

const [summary, setSummary] = createSignal<DashboardSummaryResponse | null>(null);
const [summaryLoading, setSummaryLoading] = createSignal(true);
const [summaryError, setSummaryError] = createSignal<string | null>(null);

async function fetchSummary() {
  try {
    const data = await dashboardApi.summary();
    setSummary(data);
    setSummaryLoading(false);
    setSummaryError(null);
  } catch (err) {
    setSummaryLoading(false);
    setSummaryError(err instanceof Error ? err.message : 'Failed to fetch dashboard summary');
  }
}

export function startDashboardSummaryPolling() {
  pollingScheduler.register(POLL_ID, fetchSummary, POLL_INTERVAL);
}

export function stopDashboardSummaryPolling() {
  pollingScheduler.unregister(POLL_ID);
}

export { summary as dashboardSummary, summaryLoading as dashboardSummaryLoading, summaryError as dashboardSummaryError };
