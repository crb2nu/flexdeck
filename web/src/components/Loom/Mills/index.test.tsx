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
  pausePipelineRun: vi.fn(async () => ({})),
  resumePipelineRun: vi.fn(async () => ({})),
  escalatePipelineRun: vi.fn(async () => ({})),
  killSwitch: vi.fn(async () => ({})),
  createPolling: vi.fn((_id: string, task: () => Promise<void> | void) => {
    queueMicrotask(() => {
      void task();
    });
  }),
  // Mutable gating state read by the mocked health/auth stores below.
  mutationsEnabled: false,
  mutationMode: 'dark_launch',
  mutationReason: 'LOOM_MILLS_MUTATIONS_ENABLED is false',
  role: null as string | null,
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
    pausePipelineRun: mocks.pausePipelineRun,
    resumePipelineRun: mocks.resumePipelineRun,
    escalatePipelineRun: mocks.escalatePipelineRun,
    killSwitch: mocks.killSwitch,
  },
}));

vi.mock('../../../hooks/createPolling', () => ({
  createPolling: mocks.createPolling,
}));

vi.mock('../../../stores/health', () => ({
  healthStore: {
    get features() {
      return {
        loom_control_plane_mutations: {
          enabled: mocks.mutationsEnabled,
          mode: mocks.mutationMode,
          reason: mocks.mutationReason,
        },
      };
    },
  },
}));

vi.mock('../../../stores/auth', () => ({
  currentUser: () => (mocks.role ? { role: mocks.role } : null),
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

function clickButton(container: HTMLElement, label: string): void {
  const btn = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`button "${label}" not found`);
  (btn as HTMLButtonElement).click();
}

describe('Loom Mills surface', () => {
  let cleanup = () => {};
  afterEach(() => {
    cleanup();
    mocks.mutationsEnabled = false;
    mocks.mutationMode = 'dark_launch';
    mocks.mutationReason = 'LOOM_MILLS_MUTATIONS_ENABLED is false';
    mocks.role = null;
    mocks.killSwitch.mockClear();
  });

  it('renders the Overview panel from mills status (autonomy + capabilities)', async () => {
    const m = mount(() => <Mills />);
    cleanup = m.cleanup;

    await flush();

    expect(mocks.status).toHaveBeenCalled();
    const text = m.container.textContent ?? '';
    expect(text).toContain('ready'); // autonomy_ready
    expect(text).toContain('2'); // active_pipeline_runs
    expect(text).toContain('sqlite_store'); // capability id
    expect(text).toContain('Dark launch off');
    expect(text).toContain('LOOM_MILLS_MUTATIONS_ENABLED is false');
    // Only the active (Overview) panel mounts — backlog/pipelines aren't fetched.
    expect(mocks.backlog).not.toHaveBeenCalled();
    expect(mocks.pipelineRuns).not.toHaveBeenCalled();
  });

  it('hides the Policy kill-switch when mutations are disabled (even for an admin)', async () => {
    mocks.mutationsEnabled = false;
    mocks.role = 'admin';
    const m = mount(() => <Mills />);
    cleanup = m.cleanup;
    await flush();

    clickButton(m.container, 'Policy');
    await flush();

    const text = m.container.textContent ?? '';
    expect(text).toContain('Dark launch off');
    expect(text).not.toContain('kill-switch');
    expect(mocks.raw).toHaveBeenCalled(); // policy proposals still render
  });

  it('shows and two-step-confirms the kill-switch for an admin when mutations are enabled', async () => {
    mocks.mutationsEnabled = true;
    mocks.mutationMode = 'enabled';
    mocks.mutationReason = '';
    mocks.role = 'admin';
    const m = mount(() => <Mills />);
    cleanup = m.cleanup;
    await flush();

    clickButton(m.container, 'Policy');
    await flush();
    const text = () => m.container.textContent ?? '';
    expect(text()).toContain('Controls enabled');
    expect(text()).toContain('kill-switch'); // "Autonomy kill-switch"

    // First click arms the confirm without calling the API.
    clickButton(m.container, 'Trip kill-switch');
    await flush();
    expect(mocks.killSwitch).not.toHaveBeenCalled();
    expect(text()).toContain('Confirm halt');

    // Second click executes.
    clickButton(m.container, 'Confirm halt');
    await flush();
    expect(mocks.killSwitch).toHaveBeenCalledTimes(1);
  });

  it('hides mutation controls for a non-admin even when the flag is on', async () => {
    mocks.mutationsEnabled = true;
    mocks.mutationMode = 'enabled';
    mocks.mutationReason = '';
    mocks.role = 'viewer';
    const m = mount(() => <Mills />);
    cleanup = m.cleanup;
    await flush();

    clickButton(m.container, 'Policy');
    await flush();

    const text = m.container.textContent ?? '';
    expect(text).toContain('Admin role required');
    expect(text).not.toContain('kill-switch');
  });

  it('surfaces missing admin token readiness from health metadata', async () => {
    mocks.mutationMode = 'missing_admin_token';
    mocks.mutationReason = 'LOOM_MILLS_ADMIN_TOKEN is not configured';
    mocks.role = 'admin';
    const m = mount(() => <Mills />);
    cleanup = m.cleanup;
    await flush();

    const text = m.container.textContent ?? '';
    expect(text).toContain('Admin token missing');
    expect(text).toContain('LOOM_MILLS_ADMIN_TOKEN is not configured');
  });
});
