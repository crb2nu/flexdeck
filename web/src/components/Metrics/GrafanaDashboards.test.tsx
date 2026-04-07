/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const grafanaMocks = vi.hoisted(() => ({
  dashboard: vi.fn(),
  dashboards: vi.fn(),
  query: vi.fn(),
  queryRange: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  grafanaApi: {
    dashboard: grafanaMocks.dashboard,
    dashboards: grafanaMocks.dashboards,
  },
  prom: {
    query: grafanaMocks.query,
    queryRange: grafanaMocks.queryRange,
  },
}));

import GrafanaDashboards from './GrafanaDashboards';

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

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makePanels(count: number) {
  return Array.from({ length: count }, (_value, index) => ({
    id: index + 1,
    title: `Panel ${index + 1}`,
    type: 'timeseries',
    datasource: 'Prometheus',
    targets: [{ expr: `metric_${index + 1}_total` }],
  }));
}

describe('GrafanaDashboards', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    grafanaMocks.dashboards.mockReset();
    grafanaMocks.dashboard.mockReset();
    grafanaMocks.query.mockReset();
    grafanaMocks.queryRange.mockReset();

    grafanaMocks.dashboards.mockResolvedValue([
      {
        uid: 'capacity',
        title: 'Capacity Board',
        url: 'https://grafana.example/capacity',
        type: 'dash-db',
        tags: ['capacity', 'gpu'],
        folderTitle: 'Operations',
      },
      {
        uid: 'cost',
        title: 'Cost Watch',
        url: 'https://grafana.example/cost',
        type: 'dash-db',
        tags: ['cost'],
        folderTitle: 'Finance',
      },
    ]);

    grafanaMocks.dashboard.mockImplementation(async (uid: string) => ({
      dashboard: {
        panels: uid === 'capacity' ? makePanels(14) : makePanels(2),
        templating: { list: [] },
      },
    }));

    grafanaMocks.queryRange.mockResolvedValue({
      data: {
        result: [
          {
            values: [
              [1, '1'],
              [2, '2'],
            ],
          },
        ],
      },
    });
    grafanaMocks.query.mockResolvedValue({
      data: {
        result: [
          {
            value: [2, '2'],
          },
        ],
      },
    });
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  it('filters dashboards and caps live preview queries for expanded boards', async () => {
    cleanup = mount(() => <GrafanaDashboards />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Operational dashboard catalog');
    });

    const searchInput = document.querySelector('input[placeholder*="Search dashboards"]') as HTMLInputElement | null;
    expect(searchInput).toBeTruthy();

    searchInput!.value = 'capacity';
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();

    expect(pageText()).toContain('Capacity Board');
    expect(pageText()).not.toContain('Cost Watch');

    const card = Array.from(document.querySelectorAll('div')).find((element) =>
      element.className.includes('cursor-pointer') && element.textContent?.includes('Capacity Board'),
    ) as HTMLDivElement | undefined;
    expect(card).toBeTruthy();

    card!.click();

    await vi.waitFor(() => {
      expect(grafanaMocks.queryRange).toHaveBeenCalledTimes(12);
    });

    expect(pageText()).toContain('Sampling live previews for the first 12 supported Prometheus panels');
  });

  it('sanitizes HTML error responses from the dashboard list endpoint', async () => {
    grafanaMocks.dashboards.mockRejectedValueOnce(new Error('<html>bad gateway</html>'));

    cleanup = mount(() => <GrafanaDashboards />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Received an invalid response from the server');
    });
  });
});
