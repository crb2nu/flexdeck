/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HUDWorkflow, HUDHandoff, HUDSession, HUDSessionDetail } from '../../lib/types';

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
      sessions: [] as HUDSession[],
      kpis: {},
    })),
    createPolling: vi.fn((
      id: string,
      task: () => Promise<void> | void,
      _interval?: number,
      _enabled?: boolean,
      immediate = true,
    ) => {
      if (hudMocks.autoRunPolling && immediate && (id === 'agents-hud-pull' || id === 'hud-now-ticker')) {
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
    handoffs: vi.fn(async (): Promise<{ handoffs: HUDHandoff[] }> => ({ handoffs: [] })),
    acceptHandoff: vi.fn(async (_id: string, _body?: Record<string, unknown>) => ({ status: 'accepted' })),
    rejectHandoff: vi.fn(async (_id: string, _reason?: string) => ({ status: 'rejected' })),
    sessionDetail: vi.fn(async (_id: string): Promise<HUDSessionDetail> => ({ entries: [] })),
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
    handoffs: hudMocks.handoffs,
    acceptHandoff: hudMocks.acceptHandoff,
    rejectHandoff: hudMocks.rejectHandoff,
    sessionDetail: hudMocks.sessionDetail,
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
    hudMocks.handoffs.mockReset();
    hudMocks.sessionDetail.mockReset();

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
      sessions: [] as HUDSession[],
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
    hudMocks.handoffs.mockResolvedValue({ handoffs: [] });
    hudMocks.sessionDetail.mockResolvedValue({ entries: [] });
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
    expect(hudMocks.createPolling).toHaveBeenCalledWith('agents-hud-pull', expect.any(Function), 15000, true, false);
    expect(hudMocks.fleet).toHaveBeenCalledTimes(1);
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

    // The pull-only panels only render their fallbacks once the push fetch
    // resolves, so wait on a fallback rather than just the mode label.
    await vi.waitFor(() => {
      expect(pageText()).toContain('Push mode — sessions unavailable');
    });

    const text = pageText();
    expect(text).toContain('Push mode (agent snapshots)');
    expect(text).toContain('Presence snapshots only');
    expect(text).not.toContain('Claim ledger');
    expect(text).not.toContain('Workflow queue');
    expect(text).not.toContain('Agent sessions');
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

  it('renders the handoff inbox and accepts a handoff with its target agent', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.handoffs.mockResolvedValue({
      handoffs: [
        {
          id: 'ho-1',
          fromAgent: 'claude',
          toAgent: 'codex',
          targetAgentId: 'codex',
          status: 'pending',
          summary: 'Finish the auth refactor and run the suite',
          createdAt: '2026-06-07T12:00:00Z',
        },
      ],
    });

    cleanup = mount(() => <HUDTab />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Handoff inbox');
    });

    const text = pageText();
    expect(text).toContain('claude');
    expect(text).toContain('codex');
    expect(text).toContain('Finish the auth refactor');
    expect(text).toContain('1 pending');

    const acceptButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Accept',
    );
    const rejectButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Reject',
    );
    expect(acceptButton).toBeTruthy();
    expect(rejectButton).toBeTruthy();

    acceptButton!.click();

    await vi.waitFor(() => {
      expect(hudMocks.acceptHandoff).toHaveBeenCalled();
    });
    const [calledId, calledBody] = hudMocks.acceptHandoff.mock.calls[0];
    expect(calledId).toBe('ho-1');
    expect(calledBody).toMatchObject({ target_agent_id: 'codex' });
  });

  it('shows an empty handoff inbox when there are no handoffs', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.handoffs.mockResolvedValue({ handoffs: [] });

    cleanup = mount(() => <HUDTab />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Handoff inbox');
    });
    expect(pageText()).toContain('No handoffs in flight');
  });

  const sessionFixture = (overrides: Partial<HUDSession> = {}): HUDSession => ({
    id: 'sess-1',
    agentId: 'claude-1',
    agentType: 'claude',
    status: 'active',
    namespace: 'flexdeck/hud',
    project: 'flexdeck',
    description: 'Build the sessions panel',
    startedAt: '2026-06-07T12:00:00Z',
    contextCount: 12,
    totalTokens: 3400,
    taskCount: 0,
    ...overrides,
  });

  function fleetWithSessions(sessions: HUDSession[]) {
    return { agents: [], claims: [], tasks: [], sessions, kpis: {} };
  }

  it('renders the sessions panel from fleet sessions with a Sessions metric', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.fleet.mockResolvedValue(fleetWithSessions([sessionFixture()]));

    cleanup = mount(() => <HUDTab />);

    await vi.waitFor(() => {
      expect(pageText()).toContain('Agent sessions');
    });

    const text = pageText();
    expect(text).toContain('claude-1');
    expect(text).toContain('Build the sessions panel');
    expect(text).toContain('12 entries');
    expect(text).toContain('1/1 active');
    expect(text).toContain('Sessions');
    // Enriched fields that the normalizer used to drop must render.
    expect(text).toContain('flexdeck/hud · flexdeck');
    expect(text).toContain('3,400 tok');
  });

  it('counts an ended session as inactive in the sessions header', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.fleet.mockResolvedValue(fleetWithSessions([
      sessionFixture({ id: 'sess-1', status: 'active' }),
      sessionFixture({ id: 'sess-2', agentId: 'codex-2', status: 'ended' }),
    ]));

    cleanup = mount(() => <HUDTab />);
    await vi.waitFor(() => expect(pageText()).toContain('Agent sessions'));

    expect(pageText()).toContain('1/2 active');
    expect(pageText()).toContain('ended');
  });

  it('renders the empty sessions state when the fleet carries no sessions', async () => {
    hudMocks.degradedFeed = false;
    // Default fleet mock already has sessions: [].
    cleanup = mount(() => <HUDTab />);
    await vi.waitFor(() => expect(pageText()).toContain('Agent sessions'));
    expect(pageText()).toContain('No sessions recorded');
    expect(pageText()).toContain('0/0 active');
  });

  it('collapses the session detail when the expanded card is clicked again', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.fleet.mockResolvedValue(fleetWithSessions([sessionFixture({ contextCount: 1 })]));
    hudMocks.sessionDetail.mockResolvedValue({
      entries: [{ id: 'e1', entryType: 'decision', title: 'Expanded once', timestamp: '2026-06-07T12:01:00Z' }],
    });

    cleanup = mount(() => <HUDTab />);
    await vi.waitFor(() => expect(pageText()).toContain('claude-1'));

    const card = () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('claude-1'))!;
    card().click();
    await vi.waitFor(() => expect(pageText()).toContain('Expanded once'));
    expect(card().getAttribute('aria-expanded')).toBe('true');

    card().click();
    await vi.waitFor(() => expect(pageText()).not.toContain('Expanded once'));
    expect(card().getAttribute('aria-expanded')).toBe('false');
    // Re-expanding uses the memoized detail — no second fetch.
    expect(hudMocks.sessionDetail).toHaveBeenCalledTimes(1);
  });

  it('truncates session entries to 15 and shows the remaining count', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.fleet.mockResolvedValue(fleetWithSessions([sessionFixture({ contextCount: 25 })]));
    hudMocks.sessionDetail.mockResolvedValue({
      entries: Array.from({ length: 25 }, (_, i) => ({
        id: `e${i}`,
        entryType: 'finding',
        title: `entry ${i}`,
        timestamp: '2026-06-07T12:00:00Z',
      })),
    });

    cleanup = mount(() => <HUDTab />);
    await vi.waitFor(() => expect(pageText()).toContain('claude-1'));
    Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('claude-1'))!.click();

    await vi.waitFor(() => expect(pageText()).toContain('entry 0'));
    expect(pageText()).toContain('entry 14');
    expect(pageText()).not.toContain('entry 15');
    expect(pageText()).toContain('+10 more entries');
  });

  it('lazy-loads session entries only when a session card is expanded', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.fleet.mockResolvedValue(fleetWithSessions([sessionFixture({ contextCount: 2 })]));
    hudMocks.sessionDetail.mockResolvedValue({
      entries: [
        { id: 'e1', entryType: 'decision', title: 'Chose inline drill-in', timestamp: '2026-06-07T12:01:00Z' },
        { id: 'e2', entryType: 'finding', content: 'fleet already carries sessions', timestamp: '2026-06-07T12:02:00Z' },
      ],
    });

    cleanup = mount(() => <HUDTab />);
    await vi.waitFor(() => expect(pageText()).toContain('claude-1'));

    // Detail must NOT be fetched until the operator expands the card.
    expect(hudMocks.sessionDetail).not.toHaveBeenCalled();

    const card = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('claude-1'));
    expect(card).toBeTruthy();
    card!.click();

    await vi.waitFor(() => expect(hudMocks.sessionDetail).toHaveBeenCalledWith('sess-1'));
    await vi.waitFor(() => expect(pageText()).toContain('Chose inline drill-in'));
    expect(pageText()).toContain('decision');
  });

  it('shows an inline error when session detail fails without blanking the list', async () => {
    hudMocks.degradedFeed = false;
    hudMocks.fleet.mockResolvedValue(fleetWithSessions([sessionFixture({ contextCount: 0 })]));
    hudMocks.sessionDetail.mockRejectedValue(new Error('detail upstream offline'));

    cleanup = mount(() => <HUDTab />);
    await vi.waitFor(() => expect(pageText()).toContain('claude-1'));

    const card = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('claude-1'));
    card!.click();

    await vi.waitFor(() => expect(pageText()).toContain('detail upstream offline'));
    // The list must survive a detail failure (supplementary-failure philosophy).
    expect(pageText()).toContain('claude-1');
    expect(pageText()).toContain('Agent sessions');
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
