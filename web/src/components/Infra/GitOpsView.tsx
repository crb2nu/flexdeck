import { Component, For, Show, createMemo } from 'solid-js';
import PulseCard from '../shared/PulseCard';
import type { GitOpsSnapshot, FluxResourceInfo } from './types';

interface Props {
  snapshot: GitOpsSnapshot;
}

function lagColor(secs: number): string {
  if (secs > 300) return 'text-status-error';
  if (secs > 60) return 'text-status-warn';
  return 'text-text-dim';
}

function fmtLag(secs: number): string {
  if (secs === 0) return '—';
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.round(secs / 60)}m`;
  return `${(secs / 3600).toFixed(1)}h`;
}

function fmtAge(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

const ResourceRow: Component<{ resource: FluxResourceInfo }> = (props) => {
  const r = () => props.resource;
  return (
    <tr class="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
      <td class="px-4 py-2 pr-3">
        <div class="flex items-center gap-2">
          <span
            class={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
              r().suspended
                ? 'bg-text-dim'
                : r().ready
                  ? 'bg-status-ok'
                  : 'bg-status-error'
            }`}
          />
          <span class="font-mono text-xs text-text-main truncate max-w-[160px]" title={r().name}>
            {r().name}
          </span>
        </div>
      </td>
      <td class="py-2 pr-3">
        <span class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
          {r().namespace}
        </span>
      </td>
      <td class="py-2 pr-3">
        <span class="font-mono text-[10px] text-text-dim">{r().kind}</span>
      </td>
      <td class="py-2 pr-3">
        <Show
          when={r().suspended}
          fallback={
            <span class={`font-mono text-xs ${r().ready ? 'text-status-ok' : 'text-status-error'}`}>
              {r().ready ? 'Ready' : 'Not Ready'}
            </span>
          }
        >
          <span class="font-mono text-xs text-text-dim">Suspended</span>
        </Show>
      </td>
      <td class="py-2 pr-3 text-right">
        <span class="font-mono text-[10px] text-text-dim">{fmtAge(r().lastApplied)}</span>
      </td>
      <td class="py-2 pr-4 text-right">
        <span class={`font-mono text-[10px] ${lagColor(r().reconcileLagSecs)}`}>
          {fmtLag(r().reconcileLagSecs)}
        </span>
      </td>
    </tr>
  );
};

const GitOpsView: Component<Props> = (props) => {
  const snap = () => props.snapshot;

  const ksReady = createMemo(() => snap().kustomizations.filter((k) => k.ready && !k.suspended).length);
  const hrReady = createMemo(() => snap().helmReleases.filter((h) => h.ready && !h.suspended).length);
  const srcReady = createMemo(() => snap().sources.filter((s) => s.ready).length);
  const allResources = createMemo(() => [...snap().kustomizations, ...snap().helmReleases]);

  return (
    <div class="flex flex-col gap-4">
      {/* KPI row */}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <PulseCard
          title="Kustomizations"
          value={`${ksReady()}/${snap().kustomizations.length}`}
          sub={snap().suspendedCount > 0 ? `${snap().suspendedCount} suspended` : undefined}
          icon="🔧"
          color="cyan"
        />
        <PulseCard
          title="Helm Releases"
          value={`${hrReady()}/${snap().helmReleases.length}`}
          icon="⛵"
          color="purple"
        />
        <PulseCard
          title="Sources"
          value={`${srcReady()}/${snap().sources.length}`}
          icon="📦"
          color="green"
        />
        <PulseCard
          title="Max Reconcile Lag"
          value={fmtLag(snap().maxReconcileLagSecs)}
          sub={snap().driftCount > 0 ? `${snap().driftCount} drifted` : undefined}
          icon="⏱"
          color={snap().maxReconcileLagSecs > 300 ? 'orange' : 'cyan'}
        />
      </div>

      {/* Resources table */}
      <div class="surface overflow-hidden">
        <div class="border-b border-white/5 px-4 py-2.5">
          <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">
            Flux Resources
          </span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left">
            <thead>
              <tr class="border-b border-white/5">
                <th class="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Name</th>
                <th class="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Namespace</th>
                <th class="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Kind</th>
                <th class="py-2 pr-3 text-[10px] font-semibold uppercase tracking-wider text-text-dim">Status</th>
                <th class="py-2 pr-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-dim">Applied</th>
                <th class="py-2 pr-4 text-right text-[10px] font-semibold uppercase tracking-wider text-text-dim">Lag</th>
              </tr>
            </thead>
            <tbody>
              <Show
                when={allResources().length > 0}
                fallback={
                  <tr>
                    <td colspan="6" class="px-4 py-6 text-center text-xs text-text-dim">
                      No Flux resources
                    </td>
                  </tr>
                }
              >
                <For each={allResources()}>{(r) => <ResourceRow resource={r} />}</For>
              </Show>
            </tbody>
          </table>
        </div>
      </div>

      {/* Sources */}
      <Show when={snap().sources.length > 0}>
        <div class="surface overflow-hidden">
          <div class="border-b border-white/5 px-4 py-2.5">
            <span class="text-xs font-semibold uppercase tracking-wider text-text-muted">Sources</span>
          </div>
          <div class="divide-y divide-white/5">
            <For each={snap().sources}>
              {(src) => (
                <div class="flex items-center gap-3 px-4 py-2 hover:bg-white/[0.02] transition-colors">
                  <span
                    class={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${src.ready ? 'bg-status-ok' : 'bg-status-error'}`}
                  />
                  <span class="font-mono text-xs text-text-main flex-1 truncate">{src.name}</span>
                  <span class="font-mono text-[10px] text-text-dim">{src.kind}</span>
                  <Show when={src.url}>
                    <span class="font-mono text-[10px] text-text-dim truncate max-w-[200px]">{src.url}</span>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

export default GitOpsView;
