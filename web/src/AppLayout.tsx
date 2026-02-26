import { Component, ParentProps, Show, createMemo, onMount, Suspense, For, createSignal, createEffect, onCleanup } from 'solid-js';
import { useLocation, A } from '@solidjs/router';
import { uiApi } from './lib/api';
import { healthStore, fetchHealth } from './stores/health';
import CommandPalette from './components/QuickLaunch/CommandPalette';
import ShortcutsOverlay from './components/QuickLaunch/ShortcutsOverlay';
import SystemCore from './components/Navigation/SystemCore';
import ClusterSelector from './components/Navigation/ClusterSelector';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { buildNavItems } from './lib/featureFlags';

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

  onMount(async () => {
    await Promise.all([fetchHealth(), fetchUIConfig()]);
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
    <div class="flex h-screen w-full flex-col bg-bg-deep text-text-main font-sans selection:bg-neon-cyan/30 overflow-hidden relative">
      {/* Scanline Overlay */}
      <div class="pointer-events-none absolute inset-0 z-50 overflow-hidden opacity-[0.03]">
        <div class="h-full w-full bg-[repeating-linear-gradient(0deg,transparent,transparent_1px,#000_1px,#000_2px)]" />
      </div>
      
      {/* Header — Sentient HUD */}
      <Show when={!isPublicView()}>
        <header class="border-b border-white/5 bg-[rgba(11,16,32,0.74)] backdrop-blur-md relative z-40">
        <div class="flex h-16 items-center justify-between px-4 md:px-6">
          {/* Left: Logo & Mobile Toggle */}
          <div class="flex items-center gap-3">
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
              class="flex md:hidden h-8 w-8 items-center justify-center rounded-md bg-white/5 border border-white/10 text-text-dim hover:text-white transition-colors"
            >
              <Show when={!mobileMenuOpen()} fallback={
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              }>
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </Show>
            </button>

            <div class="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-neon-cyan to-neon-purple shadow-lg shadow-neon-cyan/20">
              <span class="font-mono text-xl font-bold text-white">F</span>
              {/* Breathing border */}
              <div class="absolute inset-0 rounded-lg border border-neon-cyan/40 animate-breathe" />
            </div>
            <h1 class="text-xl font-bold tracking-tight text-white hidden sm:block">
              Flex<span class="text-neon-cyan">Deck</span>
            </h1>
          </div>

          {/* Center: Desktop Navigation */}
          <nav class="hidden md:flex items-center gap-1 bg-white/5 rounded-full p-1 border border-white/5">
            <For each={navItems()}>{(item) => (
              <A
                href={item.path}
                class="rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 hover:text-white min-h-[36px] flex items-center"
                classList={{
                  'bg-white/10 text-white shadow-sm': location.pathname === item.path,
                  'text-text-muted hover:bg-white/5': location.pathname !== item.path,
                }}
              >
                {item.label}
              </A>
            )}</For>
          </nav>

          {/* Right: Status & Settings */}
          <div class="flex items-center gap-2 md:gap-4">
             {/* Key Hint for Command Palette */}
             <div class="hidden lg:flex items-center gap-2 text-xs text-text-dim px-3 py-2 rounded-md border border-white/10 bg-white/5 min-h-[36px]">
                <span class="text-xs">⌘K</span>
                <span class="opacity-50 font-mono">CMD</span>
             </div>

            <ClusterSelector />
            <SystemCore />
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        <Show when={mobileMenuOpen()}>
          <div
            id={mobileNavId}
            class="md:hidden fixed inset-x-0 top-16 z-[70] bg-[rgba(8,14,28,0.94)] backdrop-blur-xl border-b border-white/10 animate-dropdown-in origin-top shadow-2xl max-h-[calc(100dvh-4rem)] overflow-y-auto"
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
                    'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/20 shadow-[0_0_15px_rgba(0,240,255,0.1)]': location.pathname === item.path,
                    'text-text-muted border-transparent hover:bg-white/5': location.pathname !== item.path,
                  }}
                >
                  <span class="tracking-wide">{item.label}</span>
                  <Show when={location.pathname === item.path}>
                    <div class="w-2 h-2 rounded-full bg-neon-cyan animate-pulse shadow-[0_0_10px_rgba(0,240,255,0.5)]" />
                  </Show>
                </A>
              )}</For>
            </nav>
          </div>
          {/* Backdrop */}
          <div
            class="fixed inset-x-0 top-16 bottom-0 z-[60] bg-black/40 backdrop-blur-sm md:hidden"
            onClick={(event) => closeMobileMenuFromBackdrop(event)}
          />
        </Show>

        {/* Sentient Health Glow Bar */}
        <div class="absolute bottom-0 left-0 right-0 h-[2px] overflow-hidden">
          {/* Base glow that breathes */}
          <div
            class="absolute inset-0 animate-breathe"
            style={{
              background: healthStore.error
                ? 'linear-gradient(90deg, transparent, #ef4444, transparent)'
                : healthStore.ok
                ? 'linear-gradient(90deg, transparent, var(--neon-cyan), transparent)'
                : 'linear-gradient(90deg, transparent, #eab308, transparent)',
            }}
          />
          {/* Scan line sweep */}
          <div
            class="absolute inset-y-0 w-24 animate-scan-line"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(0,217,255,0.6), transparent)',
            }}
          />
        </div>
      </header>
      </Show>

      {/* Main Content */}
      <main class="flex-1 min-h-0 overflow-hidden px-2 py-2 sm:px-3 sm:py-3 md:p-4 relative z-0">
        <Suspense fallback={
            <div class="flex h-full w-full items-center justify-center">
                <div class="flex flex-col items-center gap-4">
                    <div class="h-12 w-12 border-4 border-neon-cyan/30 border-t-neon-cyan rounded-full animate-spin" />
                    <div class="text-neon-cyan/50 font-mono text-sm tracking-widest animate-pulse">INITIALIZING...</div>
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
