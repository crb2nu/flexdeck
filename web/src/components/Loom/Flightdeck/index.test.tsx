/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlightdeckStalls, FlightdeckSummary } from '../../../lib/api/loomFlightdeck';

const mocks = vi.hoisted(() => ({
  summary: vi.fn(
    async (): Promise<FlightdeckSummary> => ({ wait_minutes_today: 12.5, blocked_now_count: 1 }),
  ),
  stalls: vi.fn(
    async (): Promise<FlightdeckStalls> => ({
      blocked_now: [
        {
          stall_id: 1,
          session_id: 'sess-1',
          repo: 'loom-core',
          reason: 'permission',
          tool_short: 'Bash',
          opened_at: '2026-06-30T10:00:00Z',
          waiting_seconds: 90,
        },
      ],
      pareto: [{ reason: 'permission', tool_short: 'Bash', count: 3, p50_ms: 1200, p95_ms: 5000 }],
      abandoned_and_interrupted: { abandoned_sessions: [], interrupts: [] },
      platform_liveness: [],
      edge_drops: { drops_total: 0 },
    }),
  ),
  contextSummary: vi.fn(),
  catalog: vi.fn(),
  rules: vi.fn(),
  createPolling: vi.fn((_id: string, task: () => Promise<void> | void) => {
    queueMicrotask(() => {
      void task();
    });
  }),
}));

vi.mock('../../../lib/api/loomFlightdeck', () => ({
  loomFlightdeckApi: {
    summary: mocks.summary,
    stalls: mocks.stalls,
    contextSummary: mocks.contextSummary,
    catalog: mocks.catalog,
    rules: mocks.rules,
  },
}));

vi.mock('../../../hooks/createPolling', () => ({
  createPolling: mocks.createPolling,
}));

import Flightdeck from './index';

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return {
    container,
    cleanup: () => {
      dispose();
      container.remove();
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Loom Flightdeck surface', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('renders the Stall Board from summary + stalls', async () => {
    const m = mount(() => <Flightdeck />);
    cleanup = m.cleanup;

    await flush();

    expect(mocks.summary).toHaveBeenCalled();
    expect(mocks.stalls).toHaveBeenCalled();
    const text = m.container.textContent ?? '';
    expect(text).toContain('permission'); // blocked_now reason + pareto row
    expect(text).toContain('Blocked now (1)');
    // Context Ledger tab is inactive, so its endpoints aren't fetched.
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
});
