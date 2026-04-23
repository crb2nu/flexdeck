/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HUDWorkflow } from '../../lib/types';

const hudMocks = vi.hoisted(() => {
  const hudMode = {
    pullEnabled: true,
    pushEnabled: false,
    modeLabel: 'pull + push',
    modeDescription: 'Pull feeds with push fallback.',
    disabledReason: '',
  };

  return {
    agentsList: vi.fn(async () => ({ agents: [] })),
    autoRunPolling: true,
    fleet: vi.fn(async () => ({
      agents: [
        {
          agentId: 'codex-1',
          agentType: 'codex',
          status: 'active',
          activeFiles: ['/tmp/example.ts'],
          conflicts: [],
        },
      ],
      claims: [],
      tasks: [
        {
          id: 'task-1',
          title: 'Review coverage slice',
          status: 'pending',
          priority: 2,
          tags: [],
        },
      ],
      kpis: {},
    })),
    createPolling: vi.fn((id: string, task: () => Promise<void> | void) => {
      if (hudMocks.autoRunPolling && (id === 'agents-hud-pull' || id === 'hud-now-ticker')) {
        queueMicrotask(() => {
          void task();
        });
      }
    }),
    degradedFeed: true,
    eventsConnectionLabel: 'STALE',
    feedState: 'stale',
    hudMode,
    timeline: vi.fn(async () => ({
      events: [
        {
          timestamp: '2026-03-29T14:00:00Z',
          type: 'heartbeat',
          agentId: 'codex-1',
          summary: 'heartbeat ok',
        },
      ],
    })),
    workflows: vi.fn(async (): Promise<{ workflows: HUDWorkflow[] }> => ({ workflows: [] })),
  };
});

vi.mock('../../lib/api', () => ({
  agentsApi: {
    list: hudMocks.agentsList,
  },
  hudApi: {
    approveWorkflow: vi.fn(async () => {}),
    cancelWorkflow: vi.fn(async () => {}),
    fleet: hudMocks.fleet,
    rejectWorkflow: vi.fn(async () => {}),
    timeline: hudMocks.timeline,
    workflows: hudMocks.workflows,
  },
}));

vi.mock('../../hooks/createPolling', () => ({
  createPolling: hudMocks.createPolling,
}));

vi.mock('../../stores/health', () => ({
  healthStore: {
    features: {
      loom_hud: { enabled: true },
      loom_hud_push: { enabled: true },
    },
  },
}));

vi.mock('../../lib/featureFlags', () => ({
  getHudModeState: () => hudMocks.hudMode,
}));

vi.mock('./hudDegradedMode', () => ({
  HUD_PULL_STALE_THRESHOLD_MS: 30_000,
  feedConnectionLabel: () => hudMocks.eventsConnectionLabel,
  feedConnectionState: () => hudMocks.feedState,
  hasDegradedHUDFeed: () => hudMocks.degradedFeed,
}));

vi.mock('./hudUtils', () => ({
  applyWorkflowCancel: <T,>(current: T[]) => current,
  countClaimConflicts: () => 0,
  extractItems: <T,>(value: Record<string, unknown>, key: string): T[] => {
    const items = value[key];
    return Array.isArray(items) ? (items as T[]) : [];
  },
  getClaimField: (claim: Record<string, unknown>, fields: string[], fallback: string) => {
    for (const field of fields) {
      const value = claim[field];
      if (typeof value === 'string' && value.length > 0) return value;
    }
    return fallback;
  },
  groupClaimsByAgent: () => ({}),
  normalizePresenceFromPush: () => [],
  toErrorMessage: (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback,
}));

vi.mock('./HUDActivityFeed', () => ({
  default: (props: { emptyMessage?: string }) => (
    <div data-testid="hud-activity-feed">{props.emptyMessage || 'activity feed'}</div>
  ),
}));

import HUDTab from './HUDTab';

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

describe('HUDTab', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    hudMocks.autoRunPolling = true;
    hudMocks.degradedFeed = true;
    hudMocks.eventsConnectionLabel = 'STALE';
    hudMocks.feedState = 'stale';
    hudMocks.hudMode.pullEnabled = true;
    hudMocks.hudMode.pushEnabled = false;
    hudMocks.hudMode.modeLabel = 'pull + push';
    hudMocks.hudMode.modeDescription = 'Pull feeds with push fallback.';
    hudMocks.hudMode.disabledReason = '';

    hudMocks.agentsList.mockClear();
    hudMocks.fleet.mockClear();
    hudMocks.createPolling.mockClear();
    hudMocks.timeline.mockReset();
    hudMocks.workflows.mockReset();

    hudMocks.fleet.mockResolvedValue({
      agents: [
        {
          agentId: 'codex-1',
          agentType: 'codex',
          status: 'active',
          activeFiles: ['/tmp/example.ts'],
          conflicts: [],
        },
      ],
      claims: [],
      tasks: [
        {
          id: 'task-1',
          title: 'Review coverage slice',
          status: 'pending',
          priority: 2,
          tags: [],
        },
      ],
      kpis: {},
    });
    hudMocks.timeline.mockResolvedValue({
      events: [
        {
          timestamp: '2026-03-29T14:00:00Z',
          type: 'heartbeat',
          agentId: 'codex-1',
          summary: 'heartbeat ok',
        },
      ],
    });
    hudMocks.workflows.mockResolvedValue({ workflows: [] });
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  it('renders the degraded-feed alert when pull mode is stale', async () => {
    cleanup = mount(() => <HUDTab />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Degraded feed');
    });

    const text = pageText();
    expect(text).toContain('HUD');
    expect(text).toContain('Degraded feed');
    expect(text).toContain('Timeline state is stale');
    expect(text).toContain('Presence');
  });

  it('renders the HUD error alert when pull refresh fails', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.fleet.mockRejectedValue(new Error('HUD pull offline'));
    hudMocks.timeline.mockRejectedValue(new Error('HUD pull offline'));
    hudMocks.workflows.mockRejectedValue(new Error('HUD pull offline'));

    cleanup = mount(() => <HUDTab />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('HUD error');
    });

    const text = pageText();
    expect(text).toContain('HUD error');
    expect(text).toContain('HUD pull offline');
  });

  it('triggers an immediate pull on mount instead of waiting for the first polling interval', async () => {
    hudMocks.autoRunPolling = false;

    cleanup = mount(() => <HUDTab />);

    await vi.waitFor(() => {
      expect(hudMocks.fleet.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    await vi.waitFor(() => {
      expect(pageText()).not.toContain('Loading...');
    });
  });

  it('renders push-only mode without pull-only sections', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.eventsConnectionLabel = 'DISABLED';
    hudMocks.feedState = 'disabled';
    hudMocks.hudMode.pullEnabled = false;
    hudMocks.hudMode.pushEnabled = true;
    hudMocks.hudMode.modeLabel = 'Push mode (agent snapshots)';
    hudMocks.hudMode.modeDescription = 'Presence snapshots only';

    cleanup = mount(() => <HUDTab />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Push mode (agent snapshots)');
    });

    const text = pageText();
    expect(text).toContain('Presence snapshots only');
    expect(text).not.toContain('Claim ledger');
    expect(text).not.toContain('Workflow queue');
  });

  it('renders workflow phase detail for the active Loom workflow step', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.workflows.mockResolvedValue({
      workflows: [
        {
          id: 'wf-1',
          definitionId: 'feature-dev',
          status: 'awaiting_approval',
          currentStep: 2,
          startedAt: '2026-03-29T14:00:00Z',
          steps: [
            { name: 'Plan slice', status: 'completed', requiresApproval: false },
            { name: 'Implement patch', status: 'completed', requiresApproval: false },
            { name: 'Review approval', status: 'pending', requiresApproval: true },
            { name: 'Ship branch', status: 'pending', requiresApproval: false },
          ],
        },
      ],
    });

    cleanup = mount(() => <HUDTab />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Current phase');
    });

    const text = pageText();
    expect(text).toContain('Workflow queue');
    expect(text).toContain('Phase detail');
    expect(text).toContain('2/4 complete');
    expect(text).toContain('Review approval');
    expect(text).toContain('Approval required');
  });

  it('surfaces disabled HUD mode as an operator error state', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.eventsConnectionLabel = 'DISABLED';
    hudMocks.feedState = 'disabled';
    hudMocks.hudMode.pullEnabled = false;
    hudMocks.hudMode.pushEnabled = false;
    hudMocks.hudMode.modeLabel = 'Disabled';
    hudMocks.hudMode.modeDescription = 'No HUD data';
    hudMocks.hudMode.disabledReason = 'Loom HUD is disabled by policy';

    cleanup = mount(() => <HUDTab />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('HUD error');
    });

    const text = pageText();
    expect(text).toContain('Disabled');
    expect(text).toContain('Loom HUD is disabled by policy');
    expect(text).not.toContain('Degraded feed');
  });

  it('renders overview focus as signal cards instead of the full queue stack', async () => {
    cleanup = mount(() => <HUDTab focus="overview" />);

    // Wait for data to load (1/1 = 1 active agent out of 1 total)
    await vi.waitFor(() => {
      expect(pageText()).toContain('1/1');
    });

    const text = pageText();
    expect(text).toContain('Task backlog');
    expect(text).toContain('Approvals');
    expect(text).toContain('Feed health');
    expect(text).not.toContain('Claim ledger');
    expect(text).not.toContain('Workflow queue');
  });
});
