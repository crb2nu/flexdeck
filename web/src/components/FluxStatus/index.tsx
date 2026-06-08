import { Component, createSignal, For, Show, createMemo } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { stableListByKey } from '../../lib/stableList';
import { fluxApi, type FluxResource, type FluxSource } from '../../lib/api';
import { formatRelativeTime } from '../../lib/format';
import { computeFluxSyncState, type FluxSyncState } from './syncState';
import { PageHeader, LoadingState, EmptyState, ErrorState } from '../shared';

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
  const [hrValues, setHrValues] = createSignal<Record<string, any>>({});
  const [hrHistory, setHrHistory] = createSignal<Record<string, any[]>>({});
  const [hrExpanded, setHrExpanded] = createSignal<Record<string, string | null>>({});

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

  createPolling('dash-flux', fetchAll, POLL_INTERVAL);

  // Each 15s poll replaces these signals with freshly-fetched objects, so the
  // <For> rows below would otherwise remount every refresh (the fastest poll on
  // the dashboard, so the most visible flicker). Reuse the prior ref per
  // resource (keyed by namespace/name) when its signature is unchanged.
  const stableSources = stableListByKey(sources, (s) => `${s.namespace}/${s.name}`);
  const stableKustomizations = stableListByKey(kustomizations, (r) => `${r.namespace}/${r.name}`);
  const stableHelmReleases = stableListByKey(helmReleases, (r) => `${r.namespace}/${r.name}`);

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

  const allResources = createMemo(() => [...kustomizations(), ...helmReleases()]);
  const totalCount = createMemo(() => allResources().length);
  const readyCount = createMemo(
    () =>
      allResources().filter((resource) => computeFluxSyncState(resource) === 'in-sync').length
  );
  const syncSummary = createMemo(() => {
    const summary: Record<FluxSyncState, number> = {
      'in-sync': 0,
      drifting: 0,
      error: 0,
      suspended: 0,
    };
    for (const resource of allResources()) {
      summary[computeFluxSyncState(resource)] += 1;
    }
    return summary;
  });

  return (
    <div class="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <PageHeader
        title="Flux GitOps"
        onRefresh={fetchAll}
        refreshDisabled={loading()}
      >
        <Show when={!loading()}>
          <span class="text-sm text-text-dim">{readyCount()}/{totalCount()} in sync</span>
        </Show>
      </PageHeader>

      <Show when={error()}>
        <ErrorState message={error()!} variant="banner" />
      </Show>

      <Show
        when={!loading()}
        fallback={
          <LoadingState message="Loading Flux resources..." />
        }
      >
        <Show
          when={totalCount() > 0 || sources().length > 0}
          fallback={
            <EmptyState
              icon="&#9032;"
              title="No Flux Resources"
              subtitle="No Kustomizations or HelmReleases found in the cluster."
            />
          }
        >
          <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            <Show when={totalCount() > 0}>
              <div class="surface px-4 py-3">
                <div class="flex flex-wrap items-center gap-2">
                  <SyncSummaryChip label="In Sync" state="in-sync" value={syncSummary()['in-sync']} />
                  <SyncSummaryChip label="Drifting" state="drifting" value={syncSummary().drifting} />
                  <SyncSummaryChip label="Error" state="error" value={syncSummary().error} />
                  <SyncSummaryChip label="Suspended" state="suspended" value={syncSummary().suspended} />
                </div>
              </div>
            </Show>

            {/* Sources */}
            <Show when={sources().length > 0}>
              <div class="surface overflow-hidden">
                <div class="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                  <span class="text-xs text-status-ok">&#9679;</span>
                  <span class="text-xs font-mono text-text-main uppercase tracking-wider">
                    Sources
                  </span>
                  <span class="text-[10px] text-text-dim ml-auto">
                    {sources().filter((source) => computeFluxSyncState({ ready: source.ready, conditions: source.conditions }) === 'in-sync').length}/{sources().length} in sync
                  </span>
                </div>
                <div class="divide-y divide-white/5">
                  <For each={stableSources()}>
                    {(src) => <FluxSourceRow source={src} />}
                  </For>
                </div>
              </div>
            </Show>

            {/* Kustomizations */}
            <Show when={kustomizations().length > 0}>
              <div class="surface overflow-hidden">
                <div class="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                  <span class="text-xs text-text-dim">&#9671;</span>
                  <span class="text-xs font-mono text-text-main uppercase tracking-wider">
                    Kustomizations
                  </span>
                  <span class="text-[10px] text-text-dim ml-auto">
                    {kustomizations().filter((resource) => computeFluxSyncState(resource) === 'in-sync').length}/{kustomizations().length} in sync
                  </span>
                </div>
                <div class="divide-y divide-white/5">
                  <For each={stableKustomizations()}>
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
              <div class="surface overflow-hidden">
                <div class="flex items-center gap-2 px-4 py-2 border-b border-white/5">
                  <span class="text-xs text-text-dim">&#9032;</span>
                  <span class="text-xs font-mono text-text-main uppercase tracking-wider">
                    Helm Releases
                  </span>
                  <span class="text-[10px] text-text-dim ml-auto">
                    {helmReleases().filter((resource) => computeFluxSyncState(resource) === 'in-sync').length}/{helmReleases().length} in sync
                  </span>
                </div>
                <div class="divide-y divide-white/5">
                  <For each={stableHelmReleases()}>
                    {(hr) => {
                      const hrKey = `${hr.namespace}/${hr.name}`;
                      return (
                        <FluxResourceRow
                          resource={hr}
                          reconciling={reconciling() === `helmrelease/${hr.namespace}/${hr.name}`}
                          suspending={suspending() === `helmrelease/${hr.namespace}/${hr.name}`}
                          onReconcile={() => handleReconcile('helmrelease', hr.namespace, hr.name)}
                          onSuspend={(suspend) => handleSuspend('helmrelease', hr.namespace, hr.name, suspend)}
                          isHelmRelease={true}
                          hrExpandedSection={hrExpanded()[hrKey] || null}
                          hrValuesData={hrValues()[hrKey]}
                          hrHistoryData={hrHistory()[hrKey]}
                          onHrToggle={async (section: string) => {
                            const currentSection = hrExpanded()[hrKey];
                            if (currentSection === section) {
                              setHrExpanded(prev => ({ ...prev, [hrKey]: null }));
                              return;
                            }
                            setHrExpanded(prev => ({ ...prev, [hrKey]: section }));
                            if (section === 'values' && !hrValues()[hrKey]) {
                              try {
                                const data = await fluxApi.helmReleaseValues(hr.namespace, hr.name);
                                setHrValues(prev => ({ ...prev, [hrKey]: data }));
                              } catch { setHrValues(prev => ({ ...prev, [hrKey]: { error: 'Failed to load values' } })); }
                            }
                            if (section === 'history' && !hrHistory()[hrKey]) {
                              try {
                                const data = await fluxApi.helmReleaseHistory(hr.namespace, hr.name);
                                setHrHistory(prev => ({ ...prev, [hrKey]: Array.isArray(data) ? data : (data?.history || []) }));
                              } catch { setHrHistory(prev => ({ ...prev, [hrKey]: [] })); }
                            }
                          }}
                        />
                      );
                    }}
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
          <div class="surface px-4 py-2 text-sm text-white border border-white/20">
            {toast()}
          </div>
        </div>
      </Show>
    </div>
  );
};

// ─── Source Row ───

const FluxSourceRow: Component<{ source: FluxSource }> = (props) => {
  const syncState = createMemo(() =>
    computeFluxSyncState({
      ready: props.source.ready,
      conditions: props.source.conditions,
    }),
  );

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
      <span class={`w-2 h-2 rounded-full flex-shrink-0 ${syncStateDotClass(syncState())}`} />
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
              <span class="text-text-muted"> @{props.source.branch}</span>
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
      <SyncStatePill state={syncState()} />
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
  isHelmRelease?: boolean;
  hrExpandedSection?: string | null;
  hrValuesData?: any;
  hrHistoryData?: any[];
  onHrToggle?: (section: string) => void;
}> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const syncState = createMemo(() => computeFluxSyncState(props.resource));

  const statusDot = () => {
    return syncStateDotClass(syncState());
  };

  const statusLabel = () => {
    return syncStateLabel(syncState());
  };

  const statusClasses = () => {
    return syncStatePillClass(syncState());
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
              <span class="text-[10px] text-text-muted font-mono px-1.5 py-0.5 rounded bg-white/5 hidden sm:inline">
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
          {props.suspending ? '...' : props.resource.suspended ? '\u25B6' : '\u25AE\u25AE'}
        </button>

        {/* Reconcile button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            props.onReconcile();
          }}
          disabled={props.reconciling || props.resource.suspended}
          class="text-[10px] font-mono px-2 py-1 rounded bg-white/5 border border-white/10 text-text-dim hover:text-white hover:border-white/20 transition-colors disabled:opacity-50 opacity-0 group-hover:opacity-100"
        >
          {props.reconciling ? '\u27F3...' : '\u27F3 Sync'}
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

          {/* HelmRelease Values + History buttons */}
          <Show when={props.isHelmRelease && props.onHrToggle}>
            <div class="flex gap-2 mt-2">
              <button
                class={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                  props.hrExpandedSection === 'values'
                    ? 'bg-white/10 border-white/15 text-white'
                    : 'bg-white/5 border-white/10 text-text-dim hover:text-white hover:border-white/20'
                }`}
                onClick={(e) => { e.stopPropagation(); props.onHrToggle!('values'); }}
              >
                Values
              </button>
              <button
                class={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                  props.hrExpandedSection === 'history'
                    ? 'bg-white/10 border-white/15 text-white'
                    : 'bg-white/5 border-white/10 text-text-dim hover:text-white hover:border-white/20'
                }`}
                onClick={(e) => { e.stopPropagation(); props.onHrToggle!('history'); }}
              >
                History
              </button>
            </div>

            {/* Values section */}
            <Show when={props.hrExpandedSection === 'values'}>
              <div class="mt-2 rounded-md bg-white/[0.02] overflow-hidden">
                <Show when={props.hrValuesData} fallback={
                  <div class="px-3 py-2 text-[11px] text-text-dim animate-pulse">Loading values...</div>
                }>
                  <Show when={props.hrValuesData?.error}>
                    <div class="px-3 py-2 text-[11px] text-status-error">{props.hrValuesData.error}</div>
                  </Show>
                  <Show when={!props.hrValuesData?.error}>
                    <pre class="px-3 py-2 text-[11px] text-text-muted font-mono whitespace-pre-wrap break-all max-h-64 overflow-auto">
                      {JSON.stringify(props.hrValuesData, null, 2)}
                    </pre>
                  </Show>
                </Show>
              </div>
            </Show>

            {/* History section */}
            <Show when={props.hrExpandedSection === 'history'}>
              <div class="mt-2 rounded-md bg-white/[0.02] overflow-hidden">
                <Show when={props.hrHistoryData} fallback={
                  <div class="px-3 py-2 text-[11px] text-text-dim animate-pulse">Loading history...</div>
                }>
                  <Show when={props.hrHistoryData!.length === 0}>
                    <div class="px-3 py-2 text-[11px] text-text-dim">No history available</div>
                  </Show>
                  <Show when={props.hrHistoryData!.length > 0}>
                    <table class="w-full text-[11px]">
                      <thead>
                        <tr class="border-b border-white/5">
                          <th class="text-left px-2 py-1.5 text-text-dim font-medium">Revision</th>
                          <th class="text-left px-2 py-1.5 text-text-dim font-medium">Status</th>
                          <th class="text-left px-2 py-1.5 text-text-dim font-medium">Chart</th>
                          <th class="text-left px-2 py-1.5 text-text-dim font-medium">App Version</th>
                          <th class="text-right px-2 py-1.5 text-text-dim font-medium">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={props.hrHistoryData!}>
                          {(entry: any) => (
                            <tr class="border-b border-white/[0.03]">
                              <td class="px-2 py-1.5 font-mono text-text-main">{entry.revision || entry.version || '-'}</td>
                              <td class="px-2 py-1.5">
                                <span class={`font-mono ${
                                  entry.status === 'deployed' ? 'text-status-ok' :
                                  entry.status === 'failed' ? 'text-status-error' :
                                  entry.status === 'superseded' ? 'text-text-dim' :
                                  'text-text-muted'
                                }`}>
                                  {entry.status || '-'}
                                </span>
                              </td>
                              <td class="px-2 py-1.5 font-mono text-text-muted">{entry.chart || '-'}</td>
                              <td class="px-2 py-1.5 font-mono text-text-muted">{entry.appVersion || entry.app_version || '-'}</td>
                              <td class="px-2 py-1.5 text-text-dim text-right">
                                {entry.updated || entry.last_deployed ? formatRelativeTime(entry.updated || entry.last_deployed) : '-'}
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </Show>
                </Show>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
};

const SyncSummaryChip: Component<{ label: string; state: FluxSyncState; value: number }> = (props) => (
  <span class={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-mono uppercase tracking-wider ${syncStatePillClass(props.state)}`}>
    <span>{props.label}</span>
    <span>{props.value}</span>
  </span>
);

const SyncStatePill: Component<{ state: FluxSyncState }> = (props) => (
  <span class={`text-[10px] font-mono px-2 py-0.5 rounded ${syncStatePillClass(props.state)}`}>
    {syncStateLabel(props.state)}
  </span>
);

function syncStateLabel(state: FluxSyncState): string {
  switch (state) {
    case 'in-sync':
      return 'In Sync';
    case 'drifting':
      return 'Drifting';
    case 'error':
      return 'Error';
    case 'suspended':
      return 'Suspended';
  }
}

function syncStateDotClass(state: FluxSyncState): string {
  switch (state) {
    case 'in-sync':
      return 'bg-status-ok';
    case 'drifting':
      return 'bg-white/40';
    case 'error':
      return 'bg-red-500';
    case 'suspended':
      return 'bg-status-warn';
  }
}

function syncStatePillClass(state: FluxSyncState): string {
  switch (state) {
    case 'in-sync':
      return 'bg-status-ok/10 text-status-ok border border-status-ok/20';
    case 'drifting':
      return 'bg-white/5 text-text-muted border border-white/10';
    case 'error':
      return 'bg-red-500/10 text-red-400 border border-red-500/20';
    case 'suspended':
      return 'bg-status-warn/10 text-status-warn border border-status-warn/20';
  }
}

export default FluxStatus;
