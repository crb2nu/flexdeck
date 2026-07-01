/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MillsStatus } from '../../../lib/api/loomMills';

const mocks = vi.hoisted(() => ({
  status: vi.fn(
    async (): Promise<MillsStatus> => ({
      autonomy_ready: true,
      active_pipeline_runs: 2,
      autonomy_blockers: [],
      capabilities: [{ id: 'sqlite_store', status: 'green' }],
    }),
  ),
  backlog: vi.fn(async () => []),
  pipelineRuns: vi.fn(async () => []),
  pipelineRun: vi.fn(),
  councilRuns: vi.fn(async () => []),
  councilDebate: vi.fn(),
  raw: vi.fn(async () => []),
  createPolling: vi.fn((_id: string, task: () => Promise<void> | void) => {
    queueMicrotask(() => {
      void task();
    });
  }),
}));

vi.mock('../../../lib/api/loomMills', () => ({
  loomMillsApi: {
    status: mocks.status,
    backlog: mocks.backlog,
    pipelineRuns: mocks.pipelineRuns,
    pipelineRun: mocks.pipelineRun,
    councilRuns: mocks.councilRuns,
    councilDebate: mocks.councilDebate,
    raw: mocks.raw,
  },
}));

vi.mock('../../../hooks/createPolling', () => ({
  createPolling: mocks.createPolling,
}));

import Mills from './index';

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

describe('Loom Mills surface', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('renders the Overview panel from mills status (autonomy + capabilities)', async () => {
    const m = mount(() => <Mills />);
    cleanup = m.cleanup;

    await flush();

    expect(mocks.status).toHaveBeenCalled();
    const text = m.container.textContent ?? '';
    expect(text).toContain('ready'); // autonomy_ready
    expect(text).toContain('2'); // active_pipeline_runs
    expect(text).toContain('sqlite_store'); // capability id
    // Only the active (Overview) panel mounts — backlog/pipelines aren't fetched.
    expect(mocks.backlog).not.toHaveBeenCalled();
    expect(mocks.pipelineRuns).not.toHaveBeenCalled();
  });
});
