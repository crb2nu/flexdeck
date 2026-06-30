/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoomPlansList, LoomPlanDetail } from '../../../lib/api/loomPlans';

const mocks = vi.hoisted(() => ({
  list: vi.fn(
    async (): Promise<LoomPlansList> => ({
      plans: [
        {
          id: 'plan-a',
          slug: 'plan-a',
          title: 'Alpha Plan',
          project: 'services/x',
          namespace: 'x/feat',
          phase: 'in_progress',
          kill_test_status: 'passed 2026-06-30',
          riskiest_assumption: 'mills reachable',
          mr_refs: 2,
          issue_iid: 7,
          issue_url: 'https://gl/x/-/issues/7',
          slice_total: 4,
          slice_done: 1,
          updated_at: '2026-06-30T10:00:00Z',
        },
      ],
    }),
  ),
  get: vi.fn(async (): Promise<LoomPlanDetail> => ({}) as LoomPlanDetail),
  createPolling: vi.fn((_id: string, task: () => Promise<void> | void) => {
    queueMicrotask(() => {
      void task();
    });
  }),
}));

vi.mock('../../../lib/api/loomPlans', () => ({
  loomPlansApi: { list: mocks.list, get: mocks.get },
}));

vi.mock('../../../hooks/createPolling', () => ({
  createPolling: mocks.createPolling,
}));

import Plans from './index';

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

describe('Loom Plans surface', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('renders plan rows from the API with kill-test verdict and slice progress', async () => {
    const m = mount(() => <Plans />);
    cleanup = m.cleanup;

    await flush();

    expect(mocks.list).toHaveBeenCalled();
    const text = m.container.textContent ?? '';
    expect(text).toContain('Alpha Plan');
    expect(text).toContain('1/4'); // slice progress bar
    expect(text).toContain('passed'); // kill-test verdict badge
    expect(text).toContain('in_progress'); // phase badge
  });
});
