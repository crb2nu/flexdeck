/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const trendsMocks = vi.hoisted(() => ({
  getTrends: vi.fn<() => Promise<Array<Record<string, unknown>>>>(async () => []),
  createPolling: vi.fn((id: string, task: () => Promise<void> | void) => {
    if (id === 'pipeline-trends') {
      queueMicrotask(() => {
        void task();
      });
    }
  }),
}));

vi.mock('../../lib/api', () => ({
  ciApi: {
    getTrends: trendsMocks.getTrends,
  },
}));

vi.mock('../../hooks/createPolling', () => ({
  createPolling: trendsMocks.createPolling,
}));

import PipelineTrends from './PipelineTrends';

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return () => {
    dispose();
    container.remove();
  };
}

function pageText(): string {
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('PipelineTrends', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    trendsMocks.getTrends.mockReset();
    trendsMocks.createPolling.mockClear();
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  it('renders shared operator state metadata after trends load', async () => {
    trendsMocks.getTrends.mockImplementation(async () => [
      {
        project_id: 7,
        project_name: 'flexdeck',
        avg_duration_s: 42,
        p95_duration_s: 84,
        success_rate: 99.1,
        total_runs: 12,
        sparkline: [40, 42, 39, 41],
        trend: 'down',
      },
    ]);

    cleanup = mount(() => <PipelineTrends />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('READY · 1 project');
    });

    const text = pageText();
    expect(text).toContain('Execution trend telemetry');
    expect(text).toContain('READY · 1 project');
    expect(text).toContain('flexdeck');
  });
});
