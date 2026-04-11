import { Component, ParentProps, Show, createMemo, onMount, Suspense, For, createSignal, createEffect, onCleanup } from 'solid-js';
import { useLocation, A } from '@solidjs/router';
import { uiApi } from './lib/api';
import { healthStore, fetchHealth } from './stores/health';
import CommandPalette from './components/QuickLaunch/CommandPalette';
import ShortcutsOverlay from './components/QuickLaunch/ShortcutsOverlay';
import SystemCore from './components/Navigation/SystemCore';
import ClusterSelector from './components/Navigation/ClusterSelector';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { buildNavItems, isNavItemActive } from './lib/featureFlags';

const AppLayout: Component<ParentProps> = (props) => {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = createSignal(false);
  useKeyboardShortcuts();
  let lastMenuToggleAt = 0;

  const mobileNavId = 'mobile-primary-navigation';
  const mobileDismissGuardMs = 350;

  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const closeMobileMenu = () => setMobileMenuOpen(false);
  const toggleMobileMenu = () => {
    lastMenuToggleAt = nowMs();
    setMobileMenuOpen((open) => !open);
  };
  const closeMobileMenuFromBackdrop = (event: MouseEvent | PointerEvent) => {
    // Guard against the opening tap also being interpreted as a backdrop dismiss tap on touch browsers.
    if (event.timeStamp - lastMenuToggleAt < mobileDismissGuardMs) {
      event.stopPropagation();
      return;
    }
    closeMobileMenu();
  };

  // Check if we are in public read-only view
  const isPublicView = () => {
    if (typeof window === 'undefined') return false;
    const publicDomains = ['www.flexinfer.ai', 'codyblevins.com', 'www.codyblevins.com'];
    return publicDomains.includes(window.location.hostname);
  };
  
  const fetchUIConfig = async () => {
    try {
      await uiApi.getConfig();
    } catch (e) {
      console.error('Failed to load UI config', e);
    }
  };

  onMount(() => {
    void Promise.all([fetchHealth(), fetchUIConfig()]);
  });

  createEffect(() => {
    location.pathname;
    closeMobileMenu();
  });

  createEffect(() => {
    if (typeof document === 'undefined' || !mobileMenuOpen()) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    onCleanup(() => {
      document.body.style.overflow = previousOverflow;
    });
  });
  
  const navItems = createMemo(() => {
    return buildNavItems(healthStore.features || {});
  });

  return (
    <div class="flex h-screen w-full flex-col bg-bg-deep text-text-main font-sans selection:bg-white/20 overflow-hidden relative">
      {/* Header — Sentient HUD */}
      <Show when={!isPublicView()}>
        <header class="border-b border-white/[0.08] bg-bg-dark relative z-40">
        <div class="flex h-12 items-center justify-between px-4 md:px-6">
          {/* Left: Logo & Mobile Toggle */}
          <div class="flex items-center gap-2.5">
            <button
              type="button"
              aria-label={mobileMenuOpen() ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={mobileMenuOpen()}
              aria-controls={mobileNavId}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleMobileMenu();
              }}
              onPointerDown={(event) => event.stopPropagation()}
              class="flex md:hidden h-7 w-7 items-center justify-center rounded-md bg-white/5 border border-white/10 text-text-dim hover:text-white transition-colors"
            >
              <Show when={!mobileMenuOpen()} fallback={
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              }>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </Show>
            </button>

            <span class="text-sm font-semibold tracking-tight text-white">FlexDeck</span>
          </div>

          {/* Center: Desktop Navigation */}
          <nav class="hidden md:flex items-center gap-0.5 bg-white/5 rounded-md p-0.5 border border-white/5">
            <For each={navItems()}>{(item) => (
              <A
                href={item.path}
                class="rounded-md px-3 py-1.5 text-sm font-medium transition-all duration-150 hover:text-white flex items-center"
                classList={{
                  'bg-white/10 text-white shadow-sm': isNavItemActive(location.pathname, item),
                  'text-text-muted hover:bg-white/5': !isNavItemActive(location.pathname, item),
                }}
              >
                {item.label}
              </A>
            )}</For>
          </nav>

          {/* Right: Status & Settings */}
          <div class="flex items-center gap-2 md:gap-3">
             <div class="hidden lg:flex items-center text-xs text-text-dim px-2 py-1 rounded-md border border-white/10 bg-white/5">
                <span>⌘K</span>
             </div>

            <ClusterSelector />
            <SystemCore />
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        <Show when={mobileMenuOpen()}>
          <div
            id={mobileNavId}
            class="md:hidden fixed inset-x-0 top-12 z-[70] bg-bg-dark border-b border-white/[0.08] animate-dropdown-in origin-top shadow-2xl max-h-[calc(100dvh-3rem)] overflow-y-auto"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            style={{ 'padding-bottom': 'max(0.75rem, env(safe-area-inset-bottom))' }}
          >
            <nav class="flex flex-col p-3 gap-1">
              <For each={navItems()}>{(item) => (
                <A
                  href={item.path}
                  onClick={() => closeMobileMenu()}
                  class="flex items-center justify-between rounded-xl px-4 py-3 text-base font-medium transition-all duration-200 border active:scale-[0.98] min-h-[52px]"
                  classList={{
                    'bg-white/10 text-white border-white/[0.08]': isNavItemActive(location.pathname, item),
                    'text-text-muted border-transparent hover:bg-white/5': !isNavItemActive(location.pathname, item),
                  }}
                >
                  <span class="tracking-wide">{item.label}</span>
                  <Show when={isNavItemActive(location.pathname, item)}>
                    <div class="w-1.5 h-1.5 rounded-full bg-white/60" />
                  </Show>
                </A>
              )}</For>
            </nav>
          </div>
          {/* Backdrop */}
          <div
            class="fixed inset-x-0 top-12 bottom-0 z-[60] bg-black/50 md:hidden"
            onClick={(event) => closeMobileMenuFromBackdrop(event)}
          />
        </Show>

        {/* Health status indicator — thin solid line */}
        <div
          class="absolute bottom-0 left-0 right-0 h-px"
          style={{
            background: healthStore.error
              ? '#ef4444'
              : healthStore.ok
              ? '#94a3b8'
              : '#eab308',
            opacity: 0.4,
          }}
        />
      </header>
      </Show>

      {/* Main Content */}
      <main class="relative z-0 flex flex-1 min-h-0 flex-col overflow-hidden px-2 py-2 sm:px-3 sm:py-3 md:p-4">
        <Suspense fallback={
            <div class="flex h-full w-full items-center justify-center">
                <div class="flex flex-col items-center gap-4">
                    <div class="h-10 w-10 border-2 border-white/10 border-t-white/50 rounded-full animate-spin" />
                    <div class="text-text-muted text-sm">Loading...</div>
                </div>
            </div>
        }>
          {props.children}
        </Suspense>
      </main>

      <Show when={!isPublicView()}>
        <CommandPalette />
        <ShortcutsOverlay />
      </Show>
    </div>
  );
};

export default AppLayout;
