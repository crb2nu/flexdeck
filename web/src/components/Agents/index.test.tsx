/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const agentsMocks = vi.hoisted(() => ({
  builderInfo: vi.fn(),
  createPolling: vi.fn(),
  graph: vi.fn(),
  health: vi.fn(),
  list: vi.fn(),
}));

vi.mock('../../hooks/createPolling', () => ({
  createPolling: agentsMocks.createPolling,
}));

vi.mock('../../lib/api', () => ({
  agentsApi: {
    builderInfo: agentsMocks.builderInfo,
    create: vi.fn(),
    delete: vi.fn(),
    graph: agentsMocks.graph,
    health: agentsMocks.health,
    list: agentsMocks.list,
    update: vi.fn(),
  },
}));

vi.mock('../../stores/health', () => ({
  healthStore: {
    features: {
      loom_hud: { enabled: true, directUrl: '' },
      loom_hud_push: { enabled: true },
    },
  },
}));

vi.mock('../../lib/featureFlags', () => ({
  getHudEntryState: () => ({
    directEntryEnabled: false,
    directUrl: '',
  }),
}));

vi.mock('./HUDTab', () => ({
  default: () => <div data-testid="hud-tab">HUD overview</div>,
}));

vi.mock('./AgentFlowGraph', () => ({
  default: () => <div data-testid="agent-flow">flow</div>,
}));

import Agents from './index';

const scrollToMock = vi.fn();

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(factory, container);
  return () => {
    dispose();
    container.remove();
  };
}

function navItem(id: string): HTMLButtonElement {
  const item = document.querySelector(`[data-operations-nav-id="${id}"]`) as HTMLButtonElement | null;
  expect(item).toBeTruthy();
  return item!;
}

describe('Agents page polling', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollTo', {
      configurable: true,
      value: scrollToMock,
    });
    scrollToMock.mockClear();

    agentsMocks.builderInfo.mockReset();
    agentsMocks.createPolling.mockReset();
    agentsMocks.graph.mockReset();
    agentsMocks.health.mockReset();
    agentsMocks.list.mockReset();

    agentsMocks.builderInfo.mockRejectedValue(new Error('builder unavailable'));
    agentsMocks.graph.mockResolvedValue({ nodes: [], edges: [] });
    agentsMocks.health.mockResolvedValue({ health: {} });
    agentsMocks.list.mockResolvedValue({ agents: [] });
    agentsMocks.createPolling.mockReturnValue({ trigger: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  it('keeps registry polling off while HUD sections are active', async () => {
    cleanup = mount(() => <Agents />);

    await vi.waitFor(() => {
      expect(agentsMocks.createPolling).toHaveBeenCalledWith(
        'agents-main',
        expect.any(Function),
        10000,
        expect.any(Function),
        false,
      );
    });

    const enabled = agentsMocks.createPolling.mock.calls[0][3] as () => boolean;
    expect(enabled()).toBe(false);

    navItem('registry').click();

    await vi.waitFor(() => {
      expect(enabled()).toBe(true);
    });
  });
});
