import { Component, createSignal, createEffect, onCleanup, For, Show, createMemo } from 'solid-js';
import { fluxApi, type FluxResource, type FluxSource, type FluxCondition } from '../../lib/api';
import { formatRelativeTime } from '../../lib/format';

const POLL_INTERVAL = 15_000;

const FluxStatus: Component = () => {
  const [kustomizations, setKustomizations] = createSignal<FluxResource[]>([]);
  const [helmReleases, setHelmReleases] = createSignal<FluxResource[]>([]);
  const [sources, setSources] = createSignal<FluxSource[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [reconciling, setReconciling] = createSignal<string | null>(null);
  const [suspending, setSuspending] = createSignal<string | null>(null);
  const [toast, setToast] = createSignal('');

  const fetchAll = async () => {
    try {
      const [ks, hr, src] = await Promise.all([
        fluxApi.listKustomizations().catch(() => []),
        fluxApi.listHelmReleases().catch(() => []),
        fluxApi.listSources().catch(() => []),
      ]);
      setKustomizations(ks);
      setHelmReleases(hr);
      setSources(src);
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
      setTimeout(fetchAll, 2000);
    } catch (err) {
      setToast(`Failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      setTimeout(() => setToast(''), 4000);
    } finally {
      setReconciling(null);
    }
  };

  const handleSuspend = async (kind: string, namespace: string, name: string, suspend: boolean) => {
    const key = `${kind}/${namespace}/${name}`;
    setSuspending(key);
    try {
      const result = await fluxApi.suspend(kind, namespace, name, suspend);
      setToast(result.message || `${suspend ? 'Suspended' : 'Resumed'} ${name}`);
      setTimeout(() => setToast(''), 4000);
      setTimeout(fetchAll, 1000);
    } catch (err) {
      setToast(`Failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      setTimeout(() => setToast(''), 4000);
    } finally {
      setSuspending(null);
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
              <div class="mb-4 text-4xl animate-pulse-glow text-neon-cyan">&#10227;</div>
              <p class="text-text-dim">Loading Flux resources...</p>
            </div>
          </div>
        }
      >
        <Show
          when={totalCount() > 0 || sources().length > 0}
          fallback={
            <div class="glass-panel flex flex-1 items-center justify-center">
              <div class="text-center">
                <div class="mb-4 text-6xl text-neon-purple/30">&#9032;</div>
                <h3 class="mb-2 text-xl font-medium text-text-main">No Flux Resources</h3>
                <p class="text-text-dim">No Kustomizations or HelmReleases found in the cluster.</p>
              </div>
            </div>
          }
        >
          <div class="flex flex-col gap-4 overflow-y-auto flex-1">
            {/* Sources */}
            <Show when={sources().length > 0}>
              <div class="glass-panel overflow-hidden">
                <div class="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                  <span class="text-xs text-status-ok">&#9679;</span>
                  <span class="text-xs font-mono text-text-main uppercase tracking-wider">
                    Sources
                  </span>
                  <span class="text-[10px] text-text-dim ml-auto">
                    {sources().filter(s => s.ready).length}/{sources().length} ready
                  </span>
                </div>
                <div class="divide-y divide-white/5">
                  <For each={sources()}>
                    {(src) => <FluxSourceRow source={src} />}
                  </For>
                </div>
              </div>
            </Show>

            {/* Kustomizations */}
            <Show when={kustomizations().length > 0}>
              <div class="glass-panel overflow-hidden">
                <div class="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                  <span class="text-xs text-neon-cyan">&#9671;</span>
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
                        suspending={suspending() === `kustomization/${ks.namespace}/${ks.name}`}
                        onReconcile={() => handleReconcile('kustomization', ks.namespace, ks.name)}
                        onSuspend={(suspend) => handleSuspend('kustomization', ks.namespace, ks.name, suspend)}
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
                  <span class="text-xs text-neon-purple">&#9032;</span>
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
                        suspending={suspending() === `helmrelease/${hr.namespace}/${hr.name}`}
                        onReconcile={() => handleReconcile('helmrelease', hr.namespace, hr.name)}
                        onSuspend={(suspend) => handleSuspend('helmrelease', hr.namespace, hr.name, suspend)}
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

// ─── Source Row ───

const FluxSourceRow: Component<{ source: FluxSource }> = (props) => {
  const shortRevision = () => {
    const rev = props.source.revision || '';
    if (rev.includes('/')) {
      const parts = rev.split('/');
      const hash = parts[parts.length - 1];
      return `${parts[0]}/${hash.substring(0, 8)}`;
    }
    return rev.substring(0, 12);
  };

  return (
    <div class="flex items-center gap-3 px-4 py-2.5">
      <span class={`w-2 h-2 rounded-full flex-shrink-0 ${props.source.ready ? 'bg-neon-green' : 'bg-red-500'}`} />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-text-main truncate">{props.source.name}</span>
          <span class="text-[10px] text-text-dim font-mono px-1.5 py-0.5 rounded bg-white/5">
            {props.source.kind}
          </span>
        </div>
        <Show when={props.source.url}>
          <p class="text-[11px] text-text-muted font-mono truncate mt-0.5">
            {props.source.url}
            <Show when={props.source.branch}>
              <span class="text-neon-cyan"> @{props.source.branch}</span>
            </Show>
          </p>
        </Show>
      </div>
      <Show when={props.source.revision}>
        <span class="text-[10px] font-mono text-text-dim hidden md:block" title={props.source.revision}>
          {shortRevision()}
        </span>
      </Show>
      <Show when={props.source.lastFetched}>
        <span class="text-[10px] text-text-dim hidden lg:block">
          {formatRelativeTime(props.source.lastFetched!)}
        </span>
      </Show>
    </div>
  );
};

// ─── Resource Row (expandable) ───

const FluxResourceRow: Component<{
  resource: FluxResource;
  reconciling: boolean;
  suspending: boolean;
  onReconcile: () => void;
  onSuspend: (suspend: boolean) => void;
}> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  const statusDot = () => {
    if (props.resource.suspended) return 'bg-status-warn';
    return props.resource.ready ? 'bg-neon-green' : 'bg-red-500';
  };

  const statusLabel = () => {
    if (props.resource.suspended) return 'Suspended';
    return props.resource.ready ? 'Ready' : 'Not Ready';
  };

  const statusClasses = () => {
    if (props.resource.suspended) return 'bg-status-warn/10 text-status-warn border border-status-warn/20';
    return props.resource.ready
      ? 'bg-neon-green/10 text-neon-green border border-neon-green/20'
      : 'bg-red-500/10 text-red-400 border border-red-500/20';
  };

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
    <div>
      <div
        class="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors group cursor-pointer"
        onClick={() => setExpanded(!expanded())}
      >
        {/* Expand chevron */}
        <span class={`text-[10px] text-text-dim transition-transform ${expanded() ? 'rotate-90' : ''}`}>
          &#9656;
        </span>

        {/* Status dot */}
        <span class={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot()}`} />

        {/* Name + namespace */}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-text-main truncate">{props.resource.name}</span>
            <span class="text-[10px] text-text-dim font-mono px-1.5 py-0.5 rounded bg-white/5">
              {props.resource.namespace}
            </span>
            {/* Source ref chip */}
            <Show when={props.resource.sourceRef}>
              <span class="text-[10px] text-neon-cyan font-mono px-1.5 py-0.5 rounded bg-neon-cyan/10 hidden sm:inline">
                from: {props.resource.sourceRef!.name}
              </span>
            </Show>
          </div>
          <Show when={props.resource.message && !expanded()}>
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
        <span class={`text-[10px] font-mono px-2 py-0.5 rounded ${statusClasses()}`}>
          {statusLabel()}
        </span>

        {/* Suspend/Resume toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            props.onSuspend(!props.resource.suspended);
          }}
          disabled={props.suspending}
          class={`text-[10px] font-mono px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
            props.resource.suspended
              ? 'bg-status-ok/10 border-status-ok/20 text-status-ok hover:bg-status-ok/20'
              : 'bg-status-warn/10 border-status-warn/20 text-status-warn hover:bg-status-warn/20'
          } opacity-0 group-hover:opacity-100`}
          title={props.resource.suspended ? 'Resume' : 'Suspend'}
        >
          {props.suspending ? '...' : props.resource.suspended ? '&#9654;' : '&#9646;&#9646;'}
        </button>

        {/* Reconcile button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            props.onReconcile();
          }}
          disabled={props.reconciling || props.resource.suspended}
          class="text-[10px] font-mono px-2 py-1 rounded bg-white/5 border border-white/10 text-text-dim hover:text-neon-cyan hover:border-neon-cyan/30 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
        >
          {props.reconciling ? '&#10227;...' : '&#10227; Sync'}
        </button>
      </div>

      {/* Expanded detail */}
      <Show when={expanded()}>
        <div class="px-4 pb-3 ml-8 space-y-2">
          {/* DependsOn chips */}
          <Show when={props.resource.dependsOn && props.resource.dependsOn.length > 0}>
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[10px] text-text-dim">Depends on:</span>
              <For each={props.resource.dependsOn!}>
                {(dep) => (
                  <span class="text-[10px] font-mono bg-white/10 text-text-muted px-1.5 py-0.5 rounded">
                    {dep}
                  </span>
                )}
              </For>
            </div>
          </Show>

          {/* Conditions table */}
          <Show when={props.resource.conditions && props.resource.conditions.length > 0}>
            <div class="rounded-md bg-white/[0.02] overflow-hidden">
              <table class="w-full text-[11px]">
                <thead>
                  <tr class="border-b border-white/5">
                    <th class="text-left px-2 py-1.5 text-text-dim font-medium">Type</th>
                    <th class="text-left px-2 py-1.5 text-text-dim font-medium">Status</th>
                    <th class="text-left px-2 py-1.5 text-text-dim font-medium hidden sm:table-cell">Reason</th>
                    <th class="text-left px-2 py-1.5 text-text-dim font-medium hidden md:table-cell">Message</th>
                    <th class="text-right px-2 py-1.5 text-text-dim font-medium hidden lg:table-cell">Time</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={props.resource.conditions!}>
                    {(cond) => (
                      <tr class="border-b border-white/[0.03]">
                        <td class="px-2 py-1.5 font-mono text-text-main">{cond.type}</td>
                        <td class="px-2 py-1.5">
                          <span class={`font-mono ${
                            cond.status === 'True' ? 'text-status-ok' :
                            cond.status === 'False' ? 'text-status-error' :
                            'text-text-dim'
                          }`}>
                            {cond.status}
                          </span>
                        </td>
                        <td class="px-2 py-1.5 font-mono text-text-muted hidden sm:table-cell">{cond.reason || '-'}</td>
                        <td class="px-2 py-1.5 text-text-muted truncate max-w-[300px] hidden md:table-cell" title={cond.message}>
                          {cond.message || '-'}
                        </td>
                        <td class="px-2 py-1.5 text-text-dim text-right hidden lg:table-cell">
                          {cond.lastTransitionTime ? formatRelativeTime(cond.lastTransitionTime) : '-'}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default FluxStatus;
