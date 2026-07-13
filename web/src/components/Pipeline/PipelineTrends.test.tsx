/* @vitest-environment jsdom */

import { render } from 'solid-js/web';
import { HashRouter, Route } from '@solidjs/router';
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

// Router context is required since PipelineTrends writes ?repo=/?view= via
// useSearchParams when a trend card is clicked.
function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => (
    <HashRouter>
      <Route path="/" component={PipelineTrends} />
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

describe('PipelineTrends', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    trendsMocks.getTrends.mockReset();
    trendsMocks.createPolling.mockClear();
    window.location.hash = '#/';
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
    window.location.hash = '#/';
  });

  const sampleTrend = {
    project_id: 7,
    project_name: 'flexdeck',
    avg_duration_s: 42,
    p95_duration_s: 84,
    success_rate: 99.1,
    total_runs: 12,
    sparkline: [40, 42, 39, 41],
    trend: 'down',
  };

  it('renders shared operator state metadata after trends load', async () => {
    trendsMocks.getTrends.mockImplementation(async () => [sampleTrend]);

    cleanup = mount();

    await vi.waitFor(() => {
      expect(pageText()).toContain('READY · 1 project');
    });

    const text = pageText();
    expect(text).toContain('Execution trend telemetry');
    expect(text).toContain('READY · 1 project');
    expect(text).toContain('flexdeck');
  });

  it('deep-links a trend card click to that repo pipeline detail', async () => {
    trendsMocks.getTrends.mockImplementation(async () => [sampleTrend]);

    cleanup = mount();

    await vi.waitFor(() => {
      expect(pageText()).toContain('flexdeck');
    });

    const card = Array.from(document.querySelectorAll('button')).find(
      (element) => element.textContent?.includes('flexdeck'),
    ) as HTMLButtonElement | undefined;
    expect(card).toBeTruthy();
    card!.click();

    await vi.waitFor(() => {
      expect(window.location.hash).toContain('repo=7');
      expect(window.location.hash).toContain('view=detail');
    });
  });

  it('refetches trends when the manual refresh control is clicked', async () => {
    trendsMocks.getTrends.mockImplementation(async () => [sampleTrend]);

    cleanup = mount();

    await vi.waitFor(() => {
      expect(pageText()).toContain('flexdeck');
    });

    const callsBefore = trendsMocks.getTrends.mock.calls.length;
    const refresh = Array.from(document.querySelectorAll('button')).find(
      (element) => element.textContent?.includes('Refresh'),
    ) as HTMLButtonElement | undefined;
    expect(refresh).toBeTruthy();
    refresh!.click();

    await vi.waitFor(() => {
      expect(trendsMocks.getTrends.mock.calls.length).toBe(callsBefore + 1);
    });
  });
});
