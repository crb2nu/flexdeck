/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const historyMocks = vi.hoisted(() => ({
  getProjectHistory: vi.fn<(projectId: number, limit: number) => Promise<Array<Record<string, unknown>>>>(async () => []),
}));

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return {
    ...actual,
    ciApi: {
      ...actual.ciApi,
      getProjectHistory: historyMocks.getProjectHistory,
    },
  };
});

import PipelineHistory from './PipelineHistory';

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

describe('PipelineHistory', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    historyMocks.getProjectHistory.mockReset();
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  it('shows disabled state before project selection and ready state after loading history', async () => {
    historyMocks.getProjectHistory.mockImplementation(async () => [
      {
        pipeline_id: 101,
        project_id: 7,
        ref: 'main',
        status: 'success',
        duration_s: 45,
        created_at: '2026-04-02T20:00:00Z',
        stages: [{ name: 'build', status: 'success', duration_s: 20 }],
      },
    ]);

    cleanup = mount(() => (
      <PipelineHistory
        repos={[
          {
            id: 7,
            name: 'flexdeck',
            path: 'services/flexdeck',
            type: 'gitlab',
            hasConfig: true,
          },
        ]}
      />
    ));

    expect(pageText()).toContain('DISABLED · select project');

    const select = document.querySelector('select') as HTMLSelectElement | null;
    expect(select).toBeTruthy();
    select!.value = '7';
    select!.dispatchEvent(new Event('change', { bubbles: true }));

    await vi.waitFor(() => {
      expect(pageText()).toContain('READY · 1 recent run');
    });

    const text = pageText();
    expect(text).toContain('Execution history browser');
    expect(text).toContain('READY · 1 recent run');
    expect(text).toContain('#101');
  });
});
