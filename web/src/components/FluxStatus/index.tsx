import { Component, createSignal, createEffect, onCleanup, For, Show, createMemo } from 'solid-js';
import { fluxApi, type FluxResource } from '../../lib/api';

const POLL_INTERVAL = 15_000;

const FluxStatus: Component = () => {
  const [kustomizations, setKustomizations] = createSignal<FluxResource[]>([]);
  const [helmReleases, setHelmReleases] = createSignal<FluxResource[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [reconciling, setReconciling] = createSignal<string | null>(null);
  const [toast, setToast] = createSignal('');

  const fetchAll = async () => {
    try {
      const [ks, hr] = await Promise.all([
        fluxApi.listKustomizations().catch(() => []),
        fluxApi.listHelmReleases().catch(() => []),
      ]);
      setKustomizations(ks);
      setHelmReleases(hr);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Flux resources');
    } finally {
      setLoading(false);
    }
  };

  let pollTimer: ReturnType<typeof setInterval>;
  createEffect(() => {
    fetchAll();
    pollTimer = setInterval(fetchAll, POLL_INTERVAL);
  });
  onCleanup(() => clearInterval(pollTimer));

  const handleReconcile = async (kind: string, namespace: string, name: string) => {
    const key = `${kind}/${namespace}/${name}`;
    setReconciling(key);
    try {
      const result = await fluxApi.reconcile(kind, namespace, name, true);
      setToast(result.message || `Reconciled ${name}`);
      setTimeout(() => setToast(''), 4000);
      // Refresh after short delay to pick up new status
      setTimeout(fetchAll, 2000);
    } catch (err) {
      setToast(`Failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      setTimeout(() => setToast(''), 4000);
    } finally {
      setReconciling(null);
    }
  };

  const readyCount = createMemo(() => {
    const all = [...kustomizations(), ...helmReleases()];
    return all.filter(r => r.ready).length;
  });

  const totalCount = createMemo(() => kustomizations().length + helmReleases().length);

  return (
    <div class="flex h-full flex-col gap-4">
      {/* Header */}
      <div class="glass-panel flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-4">
          <h2 class="text-lg font-medium text-text-main">Flux GitOps</h2>
          <Show when={!loading()}>
            <span class="text-sm text-text-dim">
              {readyCount()}/{totalCount()} ready
            </span>
          </Show>
        </div>
        <button
          onClick={fetchAll}
          disabled={loading()}
          class="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-white/20 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <Show when={error()}>
        <div class="glass-panel p-4 text-sm text-status-error">{error()}</div>
      </Show>

      <Show
        when={!loading()}
        fallback={
          <div class="glass-panel flex flex-1 items-center justify-center">
            <div class="text-center">
              <div class="mb-4 text-4xl animate-pulse-glow text-neon-cyan">⟳</div>
              <p class="text-text-dim">Loading Flux resources...</p>
            </div>
          </div>
        }
      >
        <Show
          when={totalCount() > 0}
          fallback={
            <div class="glass-panel flex flex-1 items-center justify-center">
              <div class="text-center">
                <div class="mb-4 text-6xl text-neon-purple/30">⎈</div>
                <h3 class="mb-2 text-xl font-medium text-text-main">No Flux Resources</h3>
                <p class="text-text-dim">No Kustomizations or HelmReleases found in the cluster.</p>
              </div>
            </div>
          }
        >
          <div class="flex flex-col gap-4 overflow-y-auto flex-1">
            {/* Kustomizations */}
            <Show when={kustomizations().length > 0}>
              <div class="glass-panel overflow-hidden">
                <div class="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                  <span class="text-xs text-neon-cyan">◇</span>
                  <span class="text-xs font-mono text-text-main uppercase tracking-wider">
                    Kustomizations
                  </span>
                  <span class="text-[10px] text-text-dim ml-auto">
                    {kustomizations().filter(k => k.ready).length}/{kustomizations().length} ready
                  </span>
                </div>
                <div class="divide-y divide-white/5">
                  <For each={kustomizations()}>
                    {(ks) => (
                      <FluxResourceRow
                        resource={ks}
                        reconciling={reconciling() === `kustomization/${ks.namespace}/${ks.name}`}
                        onReconcile={() => handleReconcile('kustomization', ks.namespace, ks.name)}
                      />
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* HelmReleases */}
            <Show when={helmReleases().length > 0}>
              <div class="glass-panel overflow-hidden">
                <div class="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                  <span class="text-xs text-neon-purple">⎈</span>
                  <span class="text-xs font-mono text-text-main uppercase tracking-wider">
                    Helm Releases
                  </span>
                  <span class="text-[10px] text-text-dim ml-auto">
                    {helmReleases().filter(h => h.ready).length}/{helmReleases().length} ready
                  </span>
                </div>
                <div class="divide-y divide-white/5">
                  <For each={helmReleases()}>
                    {(hr) => (
                      <FluxResourceRow
                        resource={hr}
                        reconciling={reconciling() === `helmrelease/${hr.namespace}/${hr.name}`}
                        onReconcile={() => handleReconcile('helmrelease', hr.namespace, hr.name)}
                      />
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </Show>

      {/* Toast */}
      <Show when={toast()}>
        <div class="fixed bottom-4 right-4 z-50 animate-fade-in-scale">
          <div class="glass-panel px-4 py-2 text-sm text-neon-cyan border border-neon-cyan/30 shadow-[0_0_20px_rgba(0,217,255,0.1)]">
            {toast()}
          </div>
        </div>
      </Show>
    </div>
  );
};

// Sub-component for each Flux resource row
const FluxResourceRow: Component<{
  resource: FluxResource;
  reconciling: boolean;
  onReconcile: () => void;
}> = (props) => {
  const statusDot = () =>
    props.resource.ready ? 'bg-neon-green' : 'bg-red-500';

  const statusLabel = () =>
    props.resource.ready ? 'Ready' : 'Not Ready';

  // Truncate git revision hash for display
  const shortRevision = () => {
    const rev = props.resource.lastApplied || '';
    if (rev.includes('/')) {
      const parts = rev.split('/');
      const hash = parts[parts.length - 1];
      return `${parts[0]}/${hash.substring(0, 8)}`;
    }
    return rev.substring(0, 12);
  };

  return (
    <div class="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group">
      {/* Status dot */}
      <span class={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot()}`} />

      {/* Name + namespace */}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-text-main truncate">{props.resource.name}</span>
          <span class="text-[10px] text-text-dim font-mono px-1.5 py-0.5 rounded bg-white/5">
            {props.resource.namespace}
          </span>
        </div>
        <Show when={props.resource.message}>
          <p class="text-[11px] text-text-muted truncate mt-0.5 group-hover:whitespace-normal">
            {props.resource.message}
          </p>
        </Show>
      </div>

      {/* Revision */}
      <Show when={props.resource.lastApplied}>
        <span class="text-[10px] font-mono text-text-dim hidden md:block" title={props.resource.lastApplied}>
          {shortRevision()}
        </span>
      </Show>

      {/* Status badge */}
      <span
        class={`text-[10px] font-mono px-2 py-0.5 rounded ${
          props.resource.ready
            ? 'bg-neon-green/10 text-neon-green border border-neon-green/20'
            : 'bg-red-500/10 text-red-400 border border-red-500/20'
        }`}
      >
        {statusLabel()}
      </span>

      {/* Reconcile button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          props.onReconcile();
        }}
        disabled={props.reconciling}
        class="text-[10px] font-mono px-2 py-1 rounded bg-white/5 border border-white/10 text-text-dim hover:text-neon-cyan hover:border-neon-cyan/30 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
      >
        {props.reconciling ? '⟳...' : '⟳ Sync'}
      </button>
    </div>
  );
};

export default FluxStatus;
