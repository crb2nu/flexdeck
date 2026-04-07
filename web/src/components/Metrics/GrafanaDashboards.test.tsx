/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const grafanaMocks = vi.hoisted(() => ({
  dashboards: vi.fn(),
  query: vi.fn(),
  queryRange: vi.fn(),
}));

vi.mock('../../lib/api', () => ({
  grafanaApi: {
    dashboards: grafanaMocks.dashboards,
    dashboard: vi.fn(),
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

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('GrafanaDashboards', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    grafanaMocks.dashboards.mockReset();
    grafanaMocks.query.mockReset();
    grafanaMocks.queryRange.mockReset();
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
  });

  it('renders dashboards after the initial resource load', async () => {
    grafanaMocks.dashboards.mockResolvedValue([
      {
        uid: 'cluster-overview',
        title: 'Cluster Overview',
        url: '/d/cluster-overview',
        type: 'dash-db',
        tags: ['k8s', 'overview'],
        folderTitle: 'Operations',
      },
    ]);

    cleanup = mount(() => <GrafanaDashboards />);
    await flush();

    const text = document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(text).toContain('Cluster Overview');
    expect(text).toContain('Operations');
    expect(text).not.toContain('Connection Error');
  });

  it('renders a sanitized connection error when the list request fails with html', async () => {
    grafanaMocks.dashboards.mockRejectedValue(new Error('<!DOCTYPE html><html>bad gateway</html>'));

    cleanup = mount(() => <GrafanaDashboards />);
    await flush();

    const text = document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(text).toContain('Connection Error');
    expect(text).toContain('Received an invalid response from the server');
  });
});
