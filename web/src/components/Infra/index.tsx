import { Component, For, Show, createSignal, createMemo } from 'solid-js';
import { useInfraController } from './useInfraController';
import ComputeView from './ComputeView';
import StorageView from './StorageView';
import NetworkingView from './NetworkingView';
import GitOpsView from './GitOpsView';
import CapacityView from './CapacityView';

type Tab = 'compute' | 'storage' | 'networking' | 'gitops' | 'capacity';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'compute', label: 'Compute', icon: '⚙' },
  { id: 'storage', label: 'Storage', icon: '💽' },
  { id: 'networking', label: 'Networking', icon: '🌐' },
  { id: 'gitops', label: 'GitOps', icon: '🔧' },
  { id: 'capacity', label: 'Capacity', icon: '📊' },
];

function fmtRelativeTime(ms: number): string {
  if (ms === 0) return 'never';
  const diff = Date.now() - ms;
  if (diff < 5000) return 'just now';
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  return `${Math.round(diff / 60000)}m ago`;
}

const Infra: Component = () => {
  const [activeTab, setActiveTab] = createSignal<Tab>('compute');
  const { snapshot, loading, error, lastUpdated, trigger } = useInfraController();

  const snap = createMemo(() => snapshot());

  return (
    <div class="flex flex-col gap-4 p-4 sm:p-6">
      {/* Header */}
      <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 class="text-lg font-bold text-text-main">Infrastructure</h1>
          <p class="text-xs text-text-dim">
            Cluster-wide compute, storage, networking, and GitOps state
          </p>
        </div>
        <div class="flex items-center gap-3">
          <Show when={lastUpdated() > 0}>
            <span class="font-mono text-[10px] text-text-dim">
              Updated {fmtRelativeTime(lastUpdated())}
            </span>
          </Show>
          <button
            class="rounded border border-white/10 bg-white/5 px-3 py-1 text-xs text-text-muted transition-colors hover:bg-white/10 hover:text-text-main"
            onClick={() => trigger()}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div class="flex gap-1 border-b border-white/5 pb-px">
        <For each={TABS}>
          {(tab) => (
            <button
              class={`flex items-center gap-1.5 rounded-t px-3 py-2 text-xs font-medium transition-colors ${
                activeTab() === tab.id
                  ? 'border-b-2 border-neon-cyan text-neon-cyan'
                  : 'text-text-dim hover:text-text-muted'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span class="opacity-70">{tab.icon}</span>
              {tab.label}
            </button>
          )}
        </For>
      </div>

      {/* Loading state */}
      <Show when={loading() && !snap()}>
        <div class="flex items-center justify-center py-16">
          <div class="flex flex-col items-center gap-3">
            <div class="h-6 w-6 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
            <span class="text-xs text-text-dim">Loading infrastructure snapshot...</span>
          </div>
        </div>
      </Show>

      {/* Error state (no snapshot yet) */}
      <Show when={!!error() && !snap()}>
        <div class="flex items-center justify-center py-16">
          <div class="glass-panel flex flex-col items-center gap-3 p-6 text-center max-w-sm">
            <span class="text-2xl">⚠</span>
            <p class="text-sm text-status-error">{error()}</p>
            <button
              class="mt-2 rounded border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-text-muted hover:bg-white/10 hover:text-text-main transition-colors"
              onClick={() => trigger()}
            >
              Retry
            </button>
          </div>
        </div>
      </Show>

      {/* Content */}
      <Show when={snap()}>
        {(s) => (
          <>
            <Show when={activeTab() === 'compute'}>
              <ComputeView snapshot={s().compute} />
            </Show>
            <Show when={activeTab() === 'storage'}>
              <StorageView snapshot={s().storage} />
            </Show>
            <Show when={activeTab() === 'networking'}>
              <NetworkingView snapshot={s().networking} />
            </Show>
            <Show when={activeTab() === 'gitops'}>
              <GitOpsView snapshot={s().gitops} />
            </Show>
            <Show when={activeTab() === 'capacity'}>
              <CapacityView snapshot={s().capacity} />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

export default Infra;
