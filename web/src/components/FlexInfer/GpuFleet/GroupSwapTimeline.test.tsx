/* @vitest-environment jsdom */

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupSwapHistoryResponse } from '../../../lib/types';

const apiMocks = vi.hoisted(() => ({
  groupSwapHistory: vi.fn<(group: string, ns: string, hours: number) => Promise<GroupSwapHistoryResponse>>(),
}));

vi.mock('../../../lib/api', () => ({
  modelsApi: { groupSwapHistory: apiMocks.groupSwapHistory },
}));

// Run the task once (the initial fetch) instead of registering with the real
// visibility-aware scheduler; hours-button clicks call fetchHistory directly.
vi.mock('../../../hooks/createPolling', () => ({
  createPolling: (_id: unknown, task: () => void | Promise<void>) => {
    void task();
    return { trigger: () => void task() };
  },
}));

import GroupSwapTimeline from './GroupSwapTimeline';

function response(totalSwaps: number): GroupSwapHistoryResponse {
  return {
    group: 'gpu-a',
    models: ['llama'],
    events: [
      {
        ts: new Date().toISOString(),
        model: 'llama',
        ns: 'flexinfer',
        group: 'gpu-a',
        oldState: 'Queued',
        newState: 'Active',
      },
    ],
    summary: {
      totalSwaps,
      avgQueueWaitSec: 5,
      modelStats: { llama: { swapCount: totalSwaps, totalActiveSec: 60, totalQueuedSec: 5 } },
    },
  };
}

function deferred() {
  let resolve!: (value: GroupSwapHistoryResponse) => void;
  const promise = new Promise<GroupSwapHistoryResponse>((r) => { resolve = r; });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function clickHours(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === label);
  expect(button, `hours button ${label}`).toBeTruthy();
  button!.click();
}

describe('GroupSwapTimeline', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    localStorage.removeItem('flexdeck.pref.flexinfer.swapHours');
    apiMocks.groupSwapHistory.mockReset();
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = render(() => <GroupSwapTimeline group="gpu-a" namespace="flexinfer" />, container);
    cleanup = () => {
      dispose();
      container.remove();
    };
  }

  it('drops a stale slow response that resolves after a newer one (latest wins)', async () => {
    const slow48h = deferred();
    apiMocks.groupSwapHistory
      .mockResolvedValueOnce(response(1)) // initial 24h fetch
      .mockReturnValueOnce(slow48h.promise) // 48h fetch, resolves last
      .mockResolvedValueOnce(response(6)); // 6h fetch, resolves first

    mount();
    await flush();
    expect(document.body.textContent).toContain('1');

    clickHours('48h');
    clickHours('6h');
    await flush();
    expect(document.body.textContent).toContain('6 swaps');

    // The stale 48h response lands after the 6h one — it must be discarded.
    slow48h.resolve(response(48));
    await flush();

    expect(apiMocks.groupSwapHistory).toHaveBeenCalledTimes(3);
    const summary = document.body.textContent ?? '';
    expect(summary).toContain('6');
    expect(summary).not.toContain('48 swaps');
    // Empty-state / axis labels reflect the 6h window, not 48h.
    expect(document.body.textContent).toContain('6h ago');
  });

  it('persists the hours selection across mounts', async () => {
    apiMocks.groupSwapHistory.mockResolvedValue(response(2));

    mount();
    await flush();
    clickHours('48h');
    await flush();
    expect(apiMocks.groupSwapHistory).toHaveBeenLastCalledWith('gpu-a', 'flexinfer', 48);
    expect(localStorage.getItem('flexdeck.pref.flexinfer.swapHours')).toBe('48');

    cleanup();
    cleanup = () => undefined;

    mount();
    await flush();
    expect(apiMocks.groupSwapHistory).toHaveBeenLastCalledWith('gpu-a', 'flexinfer', 48);
  });
});
