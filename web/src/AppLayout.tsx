import { Component, ParentProps, Show, createSignal, onMount, createEffect, Suspense } from 'solid-js';
import { useLocation, A } from '@solidjs/router';
import { healthApi, uiApi } from './lib/api';
import { fetchHealth } from './stores/health';
import CommandPalette from './components/QuickLaunch/CommandPalette';
import SystemCore from './components/Navigation/SystemCore';

const AppLayout: Component<ParentProps> = (props) => {
  const location = useLocation();
  const [loading, setLoading] = createSignal(true);

  // Check if we are in public read-only view
  const isPublicView = () => {
    if (typeof window === 'undefined') return false;
    return window.location.hostname === 'www.flexinfer.ai';
  };
  
  const [uiConfig, setUiConfig] = createSignal<any>(null);

  const fetchUIConfig = async () => {
    try {
      const config = await uiApi.getConfig();
      setUiConfig(config);
    } catch (e) {
      console.error('Failed to load UI config', e);
    }
  };

  onMount(async () => {
    await Promise.all([fetchHealth(), fetchUIConfig()]);
    setLoading(false);
  });
  
  const navItems = [
    { label: 'Dashboard', path: '/' },
    { label: 'Services', path: '/services' },
    { label: 'Pipeline', path: '/pipeline' },
    { label: 'Logs', path: '/logs' },
    { label: 'Models', path: '/models' },
    { label: 'Agents', path: '/agents' }, 
  ];

  return (
    <div class="flex h-screen w-full flex-col bg-bg-deep text-text-main font-sans selection:bg-neon-cyan/30 overflow-hidden relative">
      {/* Scanline Overlay */}
      <div class="pointer-events-none absolute inset-0 z-50 overflow-hidden opacity-[0.03]">
        <div class="h-full w-full bg-[repeating-linear-gradient(0deg,transparent,transparent_1px,#000_1px,#000_2px)]"></div>
      </div>
      
      {/* Header */}
      <Show when={!isPublicView()}>
        <header class="border-b border-white/5 bg-bg-panel/50 backdrop-blur-md relative z-40">
        <div class="flex h-16 items-center justify-between px-6">
          {/* Logo */}
          <div class="flex items-center gap-3">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-neon-cyan to-neon-purple shadow-lg shadow-neon-cyan/20">
              <span class="font-mono text-xl font-bold text-white">F</span>
            </div>
            <h1 class="text-xl font-bold tracking-tight text-white">
              Flex<span class="text-neon-cyan">Deck</span>
            </h1>
          </div>

          {/* Navigation */}
          <nav class="hidden md:flex items-center gap-1 bg-white/5 rounded-full p-1 border border-white/5">
            {navItems.map((item) => (
              <A
                href={item.path}
                class="rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 hover:text-white"
                classList={{
                  'bg-white/10 text-white shadow-sm': location.pathname === item.path,
                  'text-text-muted hover:bg-white/5': location.pathname !== item.path,
                }}
              >
                {item.label}
              </A>
            ))}
          </nav>

          {/* Status & Settings */}
          <div class="flex items-center gap-4">
             {/* Key Hint for Command Palette */}
             <div class="hidden lg:flex items-center gap-2 text-xs text-text-dim px-3 py-1.5 rounded-md border border-white/10 bg-white/5">
                <span class="text-xs">⌘K</span>
                <span class="opacity-50">Command</span>
             </div>

            <SystemCore />
          </div>
        </div>
      </header>
      </Show>

      {/* Main Content */}
      <main class="flex-1 overflow-hidden p-4 relative z-0">
        <Suspense fallback={
            <div class="flex h-full w-full items-center justify-center">
                <div class="flex flex-col items-center gap-4">
                    <div class="h-12 w-12 border-4 border-neon-cyan/30 border-t-neon-cyan rounded-full animate-spin"></div>
                    <div class="text-neon-cyan/50 font-mono text-sm tracking-widest animate-pulse">INITIALIZING...</div>
                </div>
            </div>
        }>
          {props.children}
        </Suspense>
      </main>

      <Show when={!isPublicView()}>
        <CommandPalette />
      </Show>
    </div>
  );
};

export default AppLayout;
