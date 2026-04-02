/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    claims: vi.fn(async () => ({ claims: [] })),
    createPolling: vi.fn((id: string, task: () => Promise<void> | void) => {
      if (id === 'agents-hud-pull' || id === 'hud-now-ticker') {
        queueMicrotask(() => {
          void task();
        });
      }
    }),
    degradedFeed: true,
    eventsConnectionLabel: 'STALE',
    feedState: 'stale',
    hudMode,
    presence: vi.fn(async () => ({
      agents: [
        {
          agentId: 'codex-1',
          agentType: 'codex',
          status: 'active',
          activeFiles: ['/tmp/example.ts'],
          conflicts: [],
        },
      ],
    })),
    tasks: vi.fn(async () => ({
      tasks: [
        {
          id: 'task-1',
          title: 'Review coverage slice',
          status: 'pending',
          priority: 2,
          tags: [],
        },
      ],
    })),
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
    workflows: vi.fn(async () => ({ workflows: [] })),
  };
});

vi.mock('../../lib/api', () => ({
  agentsApi: {
    list: hudMocks.agentsList,
  },
  hudApi: {
    approveWorkflow: vi.fn(async () => {}),
    cancelWorkflow: vi.fn(async () => {}),
    claims: hudMocks.claims,
    presence: hudMocks.presence,
    rejectWorkflow: vi.fn(async () => {}),
    tasks: hudMocks.tasks,
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
    hudMocks.degradedFeed = true;
    hudMocks.eventsConnectionLabel = 'STALE';
    hudMocks.feedState = 'stale';
    hudMocks.hudMode.pullEnabled = true;
    hudMocks.hudMode.pushEnabled = false;
    hudMocks.hudMode.modeLabel = 'pull + push';
    hudMocks.hudMode.modeDescription = 'Pull feeds with push fallback.';
    hudMocks.hudMode.disabledReason = '';

    hudMocks.agentsList.mockClear();
    hudMocks.claims.mockClear();
    hudMocks.createPolling.mockClear();
    hudMocks.presence.mockReset();
    hudMocks.tasks.mockReset();
    hudMocks.timeline.mockReset();
    hudMocks.workflows.mockReset();

    hudMocks.presence.mockResolvedValue({
      agents: [
        {
          agentId: 'codex-1',
          agentType: 'codex',
          status: 'active',
          activeFiles: ['/tmp/example.ts'],
          conflicts: [],
        },
      ],
    });
    hudMocks.claims.mockResolvedValue({ claims: [] });
    hudMocks.tasks.mockResolvedValue({
      tasks: [
        {
          id: 'task-1',
          title: 'Review coverage slice',
          status: 'pending',
          priority: 2,
          tags: [],
        },
      ],
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
    expect(text).toContain('Live HUD operations');
    expect(text).toContain('Degraded feed');
    expect(text).toContain('Timeline state is stale');
    expect(text).toContain('Presence');
  });

  it('renders the HUD error alert when pull refresh fails', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.presence.mockRejectedValue(new Error('HUD pull offline'));
    hudMocks.claims.mockRejectedValue(new Error('HUD pull offline'));
    hudMocks.tasks.mockRejectedValue(new Error('HUD pull offline'));
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
});
