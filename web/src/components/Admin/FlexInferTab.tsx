import { Component, createSignal, For, Show, createMemo } from 'solid-js';
import { modelsApi } from '../../lib/api';
import { healthStore } from '../../stores/health';
import { getFlexInferManagementMode } from '../../lib/featureFlags';
import { createPolling } from '../../hooks/createPolling';
import { resolveFreshness } from '../../lib/freshness';
import GPUGroupTimeline from './GPUGroupTimeline';
import type { FlexInferModel, FlexInferModelListResponse } from '../../lib/types';

type Section = 'serverless' | 'gpu' | 'cache' | 'kvcache';

const FlexInferTab: Component = () => {
  const [models, setModels] = createSignal<FlexInferModel[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [patchLoading, setPatchLoading] = createSignal<string | null>(null);
  const [activeSection, setActiveSection] = createSignal<Section>('serverless');
  const [lastUpdated, setLastUpdated] = createSignal(0);
  const freshness = () => resolveFreshness(lastUpdated(), 15_000);

  const isAdmin = () => getFlexInferManagementMode(healthStore.features || {}) === 'admin';

  const fetchModels = async () => {
    try {
      const data: FlexInferModelListResponse = await modelsApi.crd();
      setModels(data.models || []);
      setError('');
      setLastUpdated(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setLoading(false);
    }
  };

  createPolling('admin-flexinfer-models', fetchModels, 15_000);

  const patchModel = async (ns: string, name: string, patch: Record<string, unknown>) => {
    const key = `${ns}/${name}`;
    setPatchLoading(key);
    try {
      await modelsApi.crdPatchSpec(ns, name, patch);
      await fetchModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Patch failed');
    } finally {
      setPatchLoading(null);
    }
  };

  // Filtered model lists
  const serverlessModels = createMemo(() =>
    models().filter((m) => m.spec.serverless),
  );
  const gpuGroupedModels = createMemo(() => {
    const groups: Record<string, FlexInferModel[]> = {};
    const ungrouped: FlexInferModel[] = [];
    for (const m of models()) {
      const group = m.spec.gpu?.shared;
      if (group) {
        (groups[group] ??= []).push(m);
      } else {
        ungrouped.push(m);
      }
    }
    return { groups, ungrouped };
  });
  const cachedModels = createMemo(() =>
    models().filter((m) => m.spec.cache || m.status.cache),
  );
  const kvCacheModels = createMemo(() =>
    models().filter((m) => m.spec.kvCache || m.status.kvCache),
  );

  return (
    <div class="space-y-4">
      {/* Management mode banner */}
      <div class={`rounded-lg px-4 py-2 text-xs font-mono flex items-center gap-2 ${
        isAdmin()
          ? 'bg-status-warn/10 border border-status-warn/20 text-status-warn'
          : 'bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan'
      }`}>
        <span class="font-bold uppercase">{isAdmin() ? 'Admin' : 'GitOps'}</span>
        <span class="text-text-dim">
          {isAdmin()
            ? 'Read-write mode. CRD spec fields can be edited from this panel.'
            : 'Read-only mode. CRDs are managed by Flux/GitOps. Set FLEXINFER_MANAGEMENT_MODE=admin to enable edits.'}
        </span>
      </div>

      <Show when={error()}>
        <div class="glass-panel p-3 text-sm text-status-error">{error()}</div>
      </Show>

      {/* Section tabs */}
      <div class="flex items-center gap-1 bg-white/5 rounded-lg p-1 border border-white/5 w-fit">
        <SectionBtn active={activeSection() === 'serverless'} onClick={() => setActiveSection('serverless')} label="Serverless" count={serverlessModels().length} />
        <SectionBtn active={activeSection() === 'gpu'} onClick={() => setActiveSection('gpu')} label="GPU Groups" count={Object.keys(gpuGroupedModels().groups).length} />
        <SectionBtn active={activeSection() === 'cache'} onClick={() => setActiveSection('cache')} label="Cache" count={cachedModels().length} />
        <SectionBtn active={activeSection() === 'kvcache'} onClick={() => setActiveSection('kvcache')} label="KV-Cache" count={kvCacheModels().length} />
      </div>

      <Show when={loading()}>
        <div class="glass-panel p-6 text-center text-text-dim animate-pulse">Loading FlexInfer models...</div>
      </Show>

      <Show when={!loading()}>
        {/* Serverless */}
        <Show when={activeSection() === 'serverless'}>
          <ServerlessSection models={serverlessModels()} isAdmin={isAdmin()} onPatch={patchModel} patchLoading={patchLoading()} />
        </Show>

        {/* GPU Groups */}
        <Show when={activeSection() === 'gpu'}>
          <GPUGroupsSection groups={gpuGroupedModels().groups} ungrouped={gpuGroupedModels().ungrouped} isAdmin={isAdmin()} onPatch={patchModel} patchLoading={patchLoading()} />
        </Show>

        {/* Cache */}
        <Show when={activeSection() === 'cache'}>
          <CacheSection models={cachedModels()} isAdmin={isAdmin()} onPatch={patchModel} patchLoading={patchLoading()} />
        </Show>

        {/* KV-Cache */}
        <Show when={activeSection() === 'kvcache'}>
          <KVCacheSection models={kvCacheModels()} isAdmin={isAdmin()} onPatch={patchModel} patchLoading={patchLoading()} />
        </Show>
      </Show>
    </div>
  );
};

// ─── Sub-section Components ───

const SectionBtn: Component<{ active: boolean; onClick: () => void; label: string; count: number }> = (props) => (
  <button
    class="rounded-md px-3 py-1.5 text-xs font-mono transition-all duration-200"
    classList={{
      'bg-white/10 text-white shadow-sm': props.active,
      'text-text-muted hover:text-white hover:bg-white/5': !props.active,
    }}
    onClick={() => props.onClick()}
  >
    {props.label}
    <Show when={props.count > 0}>
      <span class="ml-1.5 text-[10px] opacity-60">{props.count}</span>
    </Show>
  </button>
);

// ─── Serverless Section ───

const ServerlessSection: Component<{
  models: FlexInferModel[];
  isAdmin: boolean;
  onPatch: (ns: string, name: string, patch: Record<string, unknown>) => Promise<void>;
  patchLoading: string | null;
}> = (props) => (
  <div class="glass-panel overflow-hidden">
    <div class="px-4 py-3 border-b border-white/5">
      <h3 class="text-sm font-medium text-text-main">Serverless Configuration</h3>
    </div>
    <Show
      when={props.models.length > 0}
      fallback={<div class="p-6 text-center text-sm text-text-dim">No models with serverless configuration</div>}
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-white/5 text-left text-text-dim">
              <th class="px-4 py-2 font-medium">Model</th>
              <th class="px-4 py-2 font-medium">Enabled</th>
              <th class="px-4 py-2 font-medium">Idle Timeout</th>
              <th class="px-4 py-2 font-medium">Cold Start</th>
              <th class="px-4 py-2 font-medium">Min Replicas</th>
              <th class="px-4 py-2 font-medium">Phase</th>
              <th class="px-4 py-2 font-medium">Last Active</th>
              <th class="px-4 py-2 font-medium">Idle For</th>
              <Show when={props.isAdmin}><th class="px-4 py-2 font-medium">Actions</th></Show>
            </tr>
          </thead>
          <tbody>
            <For each={props.models}>
              {(model) => {
                const sl = () => model.spec.serverless!;
                const key = () => `${model.namespace}/${model.name}`;
                const busy = () => props.patchLoading === key();

                return (
                  <tr class="border-b border-white/5 hover:bg-white/5">
                    <td class="px-4 py-2">
                      <div class="font-mono text-text-main">{model.name}</div>
                      <div class="text-[10px] text-text-dim">{model.namespace}</div>
                    </td>
                    <td class="px-4 py-2">
                      <span class={sl().enabled !== false ? 'text-status-ok' : 'text-text-dim'}>
                        {sl().enabled !== false ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td class="px-4 py-2 font-mono text-text-muted">{sl().idleTimeout || '-'}</td>
                    <td class="px-4 py-2 font-mono text-text-muted">{sl().coldStartTimeout || '-'}</td>
                    <td class="px-4 py-2 font-mono text-text-muted">{sl().minReplicas ?? '-'}</td>
                    <td class="px-4 py-2">
                      <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${phaseClasses(model.status?.phase)}`}>
                        {model.status?.phase || 'Unknown'}
                      </span>
                    </td>
                    <td class="px-4 py-2 text-[10px] text-text-dim font-mono">{model.status?.lastActiveTime || '-'}</td>
                    <td class="px-4 py-2 text-[10px] font-mono">
                      <Show
                        when={model.status?.phase === 'Idle' && model.status?.lastActiveTime}
                        fallback={<span class="text-text-dim">-</span>}
                      >
                        <span class="text-status-warn">{idleFor(model.status?.lastActiveTime)}</span>
                      </Show>
                    </td>
                    <Show when={props.isAdmin}>
                      <td class="px-4 py-2">
                        <div class="flex gap-1">
                          <button
                            disabled={busy()}
                            class="rounded bg-white/10 px-2 py-1 text-[10px] text-text-muted hover:bg-white/20 disabled:opacity-50"
                            onClick={() => props.onPatch(model.namespace, model.name, {
                              serverless: { enabled: sl().enabled === false },
                            })}
                          >
                            {busy() ? '...' : sl().enabled !== false ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      </td>
                    </Show>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  </div>
);

// ─── GPU Groups Section ───

const GPUGroupsSection: Component<{
  groups: Record<string, FlexInferModel[]>;
  ungrouped: FlexInferModel[];
  isAdmin: boolean;
  onPatch: (ns: string, name: string, patch: Record<string, unknown>) => Promise<void>;
  patchLoading: string | null;
}> = (props) => {
  const [showTimeline, setShowTimeline] = createSignal<string | null>(null);
  const toggleTimeline = (group: string) => setShowTimeline((prev) => (prev === group ? null : group));

  return (
    <div class="space-y-4">
      <For each={Object.entries(props.groups)}>
        {([groupName, models]) => (
          <div class="glass-panel overflow-hidden">
            <div class="px-4 py-3 border-b border-white/5 flex items-center gap-2">
              <span class="rounded-full bg-neon-purple/20 px-2.5 py-0.5 text-xs font-medium text-neon-purple">{groupName}</span>
              <span class="text-xs text-text-dim">{models.length} model{models.length > 1 ? 's' : ''}</span>
              <div class="ml-auto">
                <button
                  class="rounded bg-white/10 px-2 py-1 text-[10px] text-text-muted hover:bg-white/20 transition-colors"
                  onClick={() => toggleTimeline(groupName)}
                >
                  {showTimeline() === groupName ? 'Hide Timeline' : 'Swap History'}
                </button>
              </div>
            </div>
            <div class="overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr class="border-b border-white/5 text-left text-text-dim">
                    <th class="px-4 py-2 font-medium">Model</th>
                    <th class="px-4 py-2 font-medium">Priority</th>
                    <th class="px-4 py-2 font-medium">Phase</th>
                    <th class="px-4 py-2 font-medium">State</th>
                    <th class="px-4 py-2 font-medium">Queue Pos</th>
                    <th class="px-4 py-2 font-medium">Preempted By</th>
                    <th class="px-4 py-2 font-medium">Preempted At</th>
                    <Show when={props.isAdmin}><th class="px-4 py-2 font-medium">Actions</th></Show>
                  </tr>
                </thead>
                <tbody>
                  <For each={models}>
                    {(model) => {
                      const sg = () => model.status?.sharedGroup;
                      const busy = () => props.patchLoading === `${model.namespace}/${model.name}`;

                      return (
                        <tr class="border-b border-white/5 hover:bg-white/5">
                          <td class="px-4 py-2 font-mono text-text-main">{model.name}</td>
                          <td class="px-4 py-2 font-mono text-text-muted">{model.spec.gpu?.priority ?? '-'}</td>
                          <td class="px-4 py-2">
                            <span class={`rounded-full px-2 py-0.5 text-[10px] font-medium ${phaseClasses(model.status?.phase)}`}>
                              {model.status?.phase || 'Unknown'}
                            </span>
                          </td>
                          <td class="px-4 py-2">
                            <span class={`font-medium ${
                              sg()?.state === 'Active' ? 'text-status-ok' :
                              sg()?.state === 'Queued' ? 'text-status-warn' : 'text-neon-purple'
                            }`}>{sg()?.state || '-'}</span>
                          </td>
                          <td class="px-4 py-2 font-mono text-text-muted">{sg()?.queuePosition ?? '-'}</td>
                          <td class="px-4 py-2 font-mono text-status-error">{sg()?.preemptedBy || '-'}</td>
                          <td class="px-4 py-2 text-[10px] font-mono text-text-dim">{sg()?.preemptedAt ? formatTimestamp(sg()!.preemptedAt) : '-'}</td>
                          <Show when={props.isAdmin}>
                            <td class="px-4 py-2">
                              <div class="flex gap-1">
                                <button
                                  disabled={busy()}
                                  class="rounded bg-white/10 px-2 py-1 text-[10px] text-text-muted hover:bg-white/20 disabled:opacity-50"
                                  onClick={() => {
                                    const current = model.spec.gpu?.priority ?? 50;
                                    const input = prompt('Set priority (0=highest):', String(current));
                                    if (input != null) {
                                      const p = parseInt(input, 10);
                                      if (!isNaN(p)) props.onPatch(model.namespace, model.name, { gpu: { ...model.spec.gpu, priority: p } });
                                    }
                                  }}
                                >
                                  {busy() ? '...' : 'Priority'}
                                </button>
                              </div>
                            </td>
                          </Show>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>
            <Show when={showTimeline() === groupName}>
              <GPUGroupTimeline group={groupName} namespace={models[0]?.namespace || 'ai'} />
            </Show>
          </div>
        )}
      </For>

      <Show when={props.ungrouped.length > 0}>
        <div class="glass-panel p-4">
          <h4 class="mb-2 text-xs font-medium text-text-dim uppercase tracking-wider">Ungrouped Models</h4>
          <div class="flex flex-wrap gap-2">
            <For each={props.ungrouped}>
              {(m) => (
                <span class="rounded-full bg-white/10 px-2.5 py-1 text-xs text-text-muted font-mono">{m.name}</span>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={Object.keys(props.groups).length === 0 && props.ungrouped.length === 0}>
        <div class="glass-panel p-6 text-center text-sm text-text-dim">No GPU group configuration found</div>
      </Show>
    </div>
  );
};

// ─── Cache Section ───

const CacheSection: Component<{
  models: FlexInferModel[];
  isAdmin: boolean;
  onPatch: (ns: string, name: string, patch: Record<string, unknown>) => Promise<void>;
  patchLoading: string | null;
}> = (props) => (
  <div class="glass-panel overflow-hidden">
    <div class="px-4 py-3 border-b border-white/5">
      <h3 class="text-sm font-medium text-text-main">Cache Management</h3>
    </div>
    <Show
      when={props.models.length > 0}
      fallback={<div class="p-6 text-center text-sm text-text-dim">No models with cache configuration</div>}
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-white/5 text-left text-text-dim">
              <th class="px-4 py-2 font-medium">Model</th>
              <th class="px-4 py-2 font-medium">Strategy</th>
              <th class="px-4 py-2 font-medium">PVC</th>
              <th class="px-4 py-2 font-medium">Size</th>
              <th class="px-4 py-2 font-medium">Ready</th>
              <th class="px-4 py-2 font-medium">Job Phase</th>
              <th class="px-4 py-2 font-medium">Actual Size</th>
              <Show when={props.isAdmin}><th class="px-4 py-2 font-medium">Actions</th></Show>
            </tr>
          </thead>
          <tbody>
            <For each={props.models}>
              {(model) => {
                const spec = () => model.spec.cache;
                const st = () => model.status?.cache;
                const busy = () => props.patchLoading === `${model.namespace}/${model.name}`;

                return (
                  <tr class="border-b border-white/5 hover:bg-white/5">
                    <td class="px-4 py-2">
                      <div class="font-mono text-text-main">{model.name}</div>
                      <div class="text-[10px] text-text-dim">{model.namespace}</div>
                    </td>
                    <td class="px-4 py-2 font-mono text-text-muted">{spec()?.strategy || st()?.strategy || '-'}</td>
                    <td class="px-4 py-2 font-mono text-text-muted">{spec()?.pvcName || st()?.pvcName || '-'}</td>
                    <td class="px-4 py-2 font-mono text-text-muted">{spec()?.size || '-'}</td>
                    <td class="px-4 py-2">
                      <span class={st()?.ready ? 'text-status-ok' : 'text-status-warn'}>
                        {st()?.ready ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td class="px-4 py-2 font-mono text-text-muted">{st()?.jobPhase || '-'}</td>
                    <td class="px-4 py-2 font-mono text-text-muted">
                      {st()?.sizeBytes ? formatBytes(st()!.sizeBytes!) : '-'}
                    </td>
                    <Show when={props.isAdmin}>
                      <td class="px-4 py-2">
                        <button
                          disabled={busy()}
                          class="rounded bg-white/10 px-2 py-1 text-[10px] text-text-muted hover:bg-white/20 disabled:opacity-50"
                          onClick={() => {
                            const strategies = ['Memory', 'SharedPVC', 'None'];
                            const current = spec()?.strategy || 'None';
                            const next = strategies[(strategies.indexOf(current) + 1) % strategies.length];
                            props.onPatch(model.namespace, model.name, { cache: { ...spec(), strategy: next } });
                          }}
                        >
                          {busy() ? '...' : `Cycle (${spec()?.strategy || 'None'})`}
                        </button>
                      </td>
                    </Show>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  </div>
);

// ─── KV-Cache Section ───

const KVCacheSection: Component<{
  models: FlexInferModel[];
  isAdmin: boolean;
  onPatch: (ns: string, name: string, patch: Record<string, unknown>) => Promise<void>;
  patchLoading: string | null;
}> = (props) => (
  <div class="glass-panel overflow-hidden">
    <div class="px-4 py-3 border-b border-white/5">
      <h3 class="text-sm font-medium text-text-main">KV-Cache Monitor</h3>
    </div>
    <Show
      when={props.models.length > 0}
      fallback={<div class="p-6 text-center text-sm text-text-dim">No models with KV-cache configuration</div>}
    >
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-white/5 text-left text-text-dim">
              <th class="px-4 py-2 font-medium">Model</th>
              <th class="px-4 py-2 font-medium w-40">Utilization</th>
              <th class="px-4 py-2 font-medium">Pressure</th>
              <th class="px-4 py-2 font-medium">Policy</th>
              <th class="px-4 py-2 font-medium">High WM</th>
              <th class="px-4 py-2 font-medium">Low WM</th>
              <th class="px-4 py-2 font-medium">Last Action</th>
              <Show when={props.isAdmin}><th class="px-4 py-2 font-medium">Actions</th></Show>
            </tr>
          </thead>
          <tbody>
            <For each={props.models}>
              {(model) => {
                const spec = () => model.spec.kvCache;
                const st = () => model.status?.kvCache;
                const util = () => st()?.utilization ? parseFloat(st()!.utilization!) : 0;
                const highWM = () => spec()?.highWatermark ? parseFloat(spec()!.highWatermark!) : 0.9;
                const lowWM = () => spec()?.lowWatermark ? parseFloat(spec()!.lowWatermark!) : 0.7;
                const busy = () => props.patchLoading === `${model.namespace}/${model.name}`;

                return (
                  <tr class="border-b border-white/5 hover:bg-white/5">
                    <td class="px-4 py-2 font-mono text-text-main">{model.name}</td>
                    <td class="px-4 py-2">
                      <div class="flex items-center gap-2">
                        <div class="relative flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                          {/* Low watermark marker */}
                          <div
                            class="absolute top-0 h-full w-px bg-status-ok/50"
                            style={{ left: `${lowWM() * 100}%` }}
                          />
                          {/* High watermark marker */}
                          <div
                            class="absolute top-0 h-full w-px bg-status-error/50"
                            style={{ left: `${highWM() * 100}%` }}
                          />
                          {/* Utilization bar */}
                          <div
                            class={`h-full rounded-full transition-all ${
                              st()?.pressure ? 'bg-status-error' :
                              util() > highWM() ? 'bg-status-warn' : 'bg-neon-cyan'
                            }`}
                            style={{ width: `${util() * 100}%` }}
                          />
                        </div>
                        <span class="text-[10px] font-mono text-text-muted w-8 text-right">
                          {(util() * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td class="px-4 py-2">
                      <Show when={st()?.pressure} fallback={<span class="text-text-dim">No</span>}>
                        <span class="rounded-full bg-status-error/20 px-2 py-0.5 text-[10px] text-status-error font-medium animate-pulse">
                          PRESSURE
                        </span>
                      </Show>
                    </td>
                    <td class="px-4 py-2 font-mono text-text-muted">{spec()?.pressurePolicy || '-'}</td>
                    <td class="px-4 py-2 font-mono text-text-muted">{spec()?.highWatermark || '-'}</td>
                    <td class="px-4 py-2 font-mono text-text-muted">{spec()?.lowWatermark || '-'}</td>
                    <td class="px-4 py-2 font-mono text-text-muted">{st()?.lastAction || '-'}</td>
                    <Show when={props.isAdmin}>
                      <td class="px-4 py-2">
                        <button
                          disabled={busy()}
                          class="rounded bg-white/10 px-2 py-1 text-[10px] text-text-muted hover:bg-white/20 disabled:opacity-50"
                          onClick={() => {
                            const policies = ['Evict', 'Reject', 'None'];
                            const current = spec()?.pressurePolicy || 'None';
                            const next = policies[(policies.indexOf(current) + 1) % policies.length];
                            props.onPatch(model.namespace, model.name, { kvCache: { ...spec(), pressurePolicy: next } });
                          }}
                        >
                          {busy() ? '...' : `Policy: ${spec()?.pressurePolicy || 'None'}`}
                        </button>
                      </td>
                    </Show>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  </div>
);

// ─── Helpers ───

function idleFor(lastActiveTime?: string): string {
  if (!lastActiveTime) return '-';
  const last = new Date(lastActiveTime).getTime();
  if (isNaN(last)) return '-';
  const seconds = Math.floor((Date.now() - last) / 1000);
  if (seconds < 0) return '-';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function formatTimestamp(ts?: string): string {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function phaseClasses(phase?: string): string {
  switch (phase) {
    case 'Ready': return 'bg-status-ok/20 text-status-ok';
    case 'Loading': return 'bg-neon-cyan/20 text-neon-cyan';
    case 'Pending': return 'bg-status-warn/20 text-status-warn';
    case 'Idle': return 'bg-white/10 text-text-dim';
    case 'Preempted': return 'bg-neon-purple/20 text-neon-purple';
    case 'Failed': return 'bg-status-error/20 text-status-error';
    default: return 'bg-white/10 text-text-dim';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default FlexInferTab;
