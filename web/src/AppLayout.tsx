import { Component, createSignal, onMount, Show, ParentProps, Suspense } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { healthStore, fetchHealth } from './stores/health';
import { uiConfigStore, fetchUIConfig } from './stores/ui-config';

const tabs = [
  { id: 'dashboard', label: 'Dashboard', path: '/' },
  { id: 'services', label: 'Services', path: '/services' },
  { id: 'logs', label: 'Logs', path: '/logs' },
  { id: 'metrics', label: 'Metrics', path: '/metrics' },
  { id: 'models', label: 'Models', path: '/models' },
  { id: 'agents', label: 'Agents', path: '/agents' },
];

const AppLayout: Component<ParentProps> = (props) => {
  const location = useLocation();
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    await Promise.all([fetchHealth(), fetchUIConfig()]);
    setLoading(false);
  });

  const activeTab = () => {
    const path = location.pathname;
    const tab = tabs.find((t) => t.path === path);
    return tab?.id ?? 'dashboard';
  };

  return (
    <div class="flex h-full flex-col">
      {/* Header */}
      <header class="glass-panel m-4 mb-0 flex items-center justify-between px-6 py-4">
        <div class="flex items-center gap-4">
          <h1 class="text-xl font-bold tracking-wider">
            <span class="text-neon-cyan">FLEX</span>
            <span class="text-text-dim">DECK</span>
          </h1>
          <Show when={uiConfigStore.title && uiConfigStore.title !== 'FLEXDECK'}>
            <span class="text-text-muted">•</span>
            <span class="text-text-dim text-sm">{uiConfigStore.title}</span>
          </Show>
        </div>

        {/* Navigation */}
        <nav class="flex gap-1">
          {tabs.map((tab) => (
            <A
              href={tab.path}
              class={`rounded-m px-4 py-2 text-sm font-medium transition-colors ${
                activeTab() === tab.id
                  ? 'bg-neon-cyan/10 text-neon-cyan'
                  : 'text-text-dim hover:bg-white/5 hover:text-text-main'
              }`}
            >
              {tab.label}
            </A>
          ))}
        </nav>

        {/* Status indicator */}
        <div class="flex items-center gap-3">
          <Show
            when={healthStore.ok}
            fallback={
              <div class="flex items-center gap-2 text-sm text-status-error">
                <span class="status-dot-error" />
                Disconnected
              </div>
            }
          >
            <div class="flex items-center gap-2 text-sm text-status-ok">
              <span class="status-dot-ok" />
              Connected
            </div>
          </Show>
        </div>
      </header>

      {/* Main Content */}
      <main class="flex-1 overflow-auto p-4">
        <Show when={!loading()} fallback={<LoadingScreen />}>
          <Suspense fallback={<LoadingScreen />}>
            {props.children}
          </Suspense>
        </Show>
      </main>
    </div>
  );
};

const LoadingScreen: Component = () => (
  <div class="flex h-full items-center justify-center">
    <div class="text-center">
      <div class="mb-4 text-4xl animate-pulse-glow text-neon-cyan">⬡</div>
      <p class="text-text-dim">Loading FlexDeck...</p>
    </div>
  </div>
);

export default AppLayout;
