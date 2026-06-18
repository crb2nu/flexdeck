/* @vitest-environment jsdom */

import { MemoryRouter, Route, createMemoryHistory } from '@solidjs/router';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const layoutMocks = vi.hoisted(() => ({
  fetchHealth: vi.fn(async () => {}),
  getConfig: vi.fn(async () => ({})),
  useKeyboardShortcuts: vi.fn(),
}));

vi.mock('./lib/api', () => ({
  uiApi: {
    getConfig: layoutMocks.getConfig,
  },
}));

vi.mock('./stores/health', () => ({
  fetchHealth: layoutMocks.fetchHealth,
  healthStore: {
    ok: true,
    error: '',
    loading: false,
    features: {
      flexinfer_proxy: { enabled: true },
      loom_hud: { enabled: true },
    },
  },
}));

vi.mock('./hooks/useKeyboardShortcuts', () => ({
  useKeyboardShortcuts: layoutMocks.useKeyboardShortcuts,
}));

vi.mock('./components/QuickLaunch/CommandPalette', () => ({
  default: () => <div data-testid="command-palette">palette</div>,
}));

vi.mock('./components/QuickLaunch/ShortcutsOverlay', () => ({
  default: () => <div data-testid="shortcuts-overlay">shortcuts</div>,
}));

vi.mock('./components/Navigation/SystemCore', () => ({
  default: () => <div data-testid="system-core">system core</div>,
}));

vi.mock('./components/Navigation/ClusterSelector', () => ({
  default: () => <div data-testid="cluster-selector">cluster selector</div>,
}));

// The RBAC login gate is covered by stores/auth.test.ts; here it is a passthrough
// so AppLayout's own behavior (nav, drawer, routing) is tested in isolation.
vi.mock('./components/Auth/LoginGate', () => ({
  default: (props: { children?: unknown }) => props.children,
}));

vi.mock('./components/Auth/AuthBadge', () => ({
  default: () => null,
}));

import AppLayout from './AppLayout';

function mount(path = '/') {
  const history = createMemoryHistory();
  history.set({ value: path, replace: true, scroll: false });

  const container = document.createElement('div');
  document.body.appendChild(container);

  const dispose = render(
    () => (
      <MemoryRouter history={history} root={AppLayout}>
        <Route path="/" component={() => <div>Dashboard page</div>} />
        <Route path="/services" component={() => <div>Services page</div>} />
      </MemoryRouter>
    ),
    container,
  );

  return {
    history,
    cleanup: () => {
      dispose();
      container.remove();
    },
  };
}

function pageText(): string {
  return document.body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function click(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function mobileMenuButton() {
  return document.querySelector('button[aria-controls="mobile-primary-navigation"]') as HTMLButtonElement | null;
}

function mobileDrawer() {
  return document.getElementById('mobile-primary-navigation');
}

function mobileBackdrop() {
  return Array.from(document.querySelectorAll('div')).find((element) =>
    typeof element.className === 'string' && element.className.includes('bg-black/40'),
  ) as HTMLDivElement | undefined;
}

describe('AppLayout', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    layoutMocks.fetchHealth.mockClear();
    layoutMocks.getConfig.mockClear();
    layoutMocks.useKeyboardShortcuts.mockClear();
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('loads health and UI config on mount', async () => {
    ({ cleanup } = mount('/'));

    await vi.waitFor(() => {
      expect(layoutMocks.fetchHealth).toHaveBeenCalledTimes(1);
      expect(layoutMocks.getConfig).toHaveBeenCalledTimes(1);
    });

    expect(layoutMocks.useKeyboardShortcuts).toHaveBeenCalledTimes(1);
    expect(pageText()).toContain('Dashboard page');
  });

  it('closes the mobile drawer when the backdrop is pressed after the guard window', async () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(100);
    ({ cleanup } = mount('/'));

    const toggle = mobileMenuButton();
    expect(toggle).toBeTruthy();
    click(toggle!);

    await vi.waitFor(() => {
      expect(mobileDrawer()).toBeTruthy();
      expect(mobileMenuButton()?.getAttribute('aria-label')).toBe('Close navigation menu');
    });

    const backdrop = mobileBackdrop();
    expect(backdrop).toBeTruthy();
    const backdropEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    Object.defineProperty(backdropEvent, 'timeStamp', { value: 1000 });
    backdrop!.dispatchEvent(backdropEvent);
    nowSpy.mockRestore();

    await vi.waitFor(() => {
      expect(mobileDrawer()).toBeNull();
      expect(mobileMenuButton()?.getAttribute('aria-label')).toBe('Open navigation menu');
    });
  });

  it('closes the mobile drawer after navigation changes', async () => {
    const mounted = mount('/');
    cleanup = mounted.cleanup;

    const toggle = mobileMenuButton();
    expect(toggle).toBeTruthy();
    click(toggle!);

    await vi.waitFor(() => {
      expect(mobileDrawer()).toBeTruthy();
    });

    mounted.history.set({ value: '/services', replace: false, scroll: false });

    await vi.waitFor(() => {
      expect(pageText()).toContain('Services page');
      expect(mobileDrawer()).toBeNull();
      expect(mobileMenuButton()?.getAttribute('aria-label')).toBe('Open navigation menu');
    });
  });
});
