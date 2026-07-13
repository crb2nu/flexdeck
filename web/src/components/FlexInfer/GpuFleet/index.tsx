import { Component, createMemo, For, Show, type Accessor } from 'solid-js';
import { A } from '@solidjs/router';
import Badge from '../../shared/Badge';
import GPUMetricsPanel from '../../Models/GPUMetricsPanel';
import { stableListByKey } from '../../../lib/stableList';
import { sanitizeError } from '../../../lib/sanitizeError';
import type { GamingSession } from '../../../lib/types';
import { formatUptime, nodeModeLabel, nodeModeTone, type FleetNode } from './fleet';
import SharingGroups from './SharingGroups';
import type { GpuFleetState } from './useGpuFleet';

interface GpuFleetProps {
  state: GpuFleetState;
}

function fmtVram(mb: number | null): string {
  if (mb == null) return '';
  const gb = mb / 1024;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${mb} MB`;
}

// A GamingSession's Moonlight/Sunshine ports are fixed by the runtime DaemonSet
// (hostNetwork). Surface them so an operator knows where to point Moonlight.
const MOONLIGHT_PORTS = '47984 / 47989 / 47990 / 48010';

const GamingSessionPanel: Component<{ node: FleetNode; now: Accessor<number> }> = (props) => {
  const session = () => props.node.session as GamingSession;
  const uptime = () => formatUptime(session().status?.activatedAt, props.now());
  return (
    <div class="rounded-md border border-semantic-violet/20 bg-semantic-violet/[0.06] p-2.5 space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="heading-label text-semantic-violet">Gaming session</span>
        <Badge tone={props.node.mode === 'gaming' ? 'info' : 'warn'} size="sm">
          {session().status?.phase || 'Unknown'}
        </Badge>
      </div>
      <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Show when={uptime()}>
          <div class="flex items-center justify-between gap-2">
            <span class="text-text-dim">Streaming for</span>
            <span class="font-mono tabular-nums text-text-main">{uptime()}</span>
          </div>
        </Show>
        <div class="flex items-center justify-between gap-2">
          <span class="text-text-dim">Moonlight</span>
          <span class="font-mono text-text-muted">{MOONLIGHT_PORTS}</span>
        </div>
      </div>
      <Show when={session().status?.runtimePod}>
        {(pod) => (
          <div class="flex items-center gap-2 text-[11px]">
            <span class="flex-shrink-0 text-text-dim">Runtime</span>
            <A
              href={`/logs?q=${encodeURIComponent(`{namespace="${session().namespace}", pod="${pod()}"}`)}`}
              class="truncate font-mono text-text-muted underline decoration-white/20 underline-offset-2 hover:text-text-main hover:decoration-white/40"
              title={`${pod()} — open logs`}
            >
              {pod()}
            </A>
          </div>
        )}
      </Show>
      <Show when={session().status?.message}>
        <div class="text-[11px] text-text-dim">{session().status?.message}</div>
      </Show>
      <div class="border-t border-white/5 pt-1.5 text-[10px] leading-relaxed text-text-muted">
        Declarative — reverts to inference when the GamingSession is removed via GitOps
        (<span class="font-mono">kubectl delete gamingsession {session().name}</span>).
      </div>
    </div>
  );
};

const HostedModels: Component<{ node: FleetNode }> = (props) => (
  <div class="space-y-1">
    <div class="heading-label">Models</div>
    <div class="flex flex-wrap gap-1">
      <For each={props.node.models}>
        {(m) => (
          <A
            href={`/flexinfer?section=telemetry&q=${encodeURIComponent(m.name)}`}
            class="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] hover:border-white/20 hover:bg-white/10"
            title={`${m.namespace}/${m.name} · ${m.phase} — open telemetry`}
          >
            <span class="font-mono text-text-dim">{m.name}</span>
            <Badge tone={m.ready ? 'ok' : 'default'} size="sm">{m.phase}</Badge>
          </A>
        )}
      </For>
    </div>
  </div>
);

const NodeCard: Component<{ node: FleetNode; now: Accessor<number> }> = (props) => {
  const meta = () => {
    const parts = [props.node.arch, props.node.vendor, props.node.vram].filter(Boolean);
    const free = fmtVram(props.node.freeVramMB);
    if (free) parts.push(`${free} free`);
    return parts.join(' · ');
  };
  const isGaming = () => props.node.mode === 'gaming' || props.node.mode === 'switching';
  return (
    <div class="surface flex flex-col gap-2.5 p-3">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="truncate font-mono text-sm text-text-main" title={props.node.name}>
            {props.node.name}
          </div>
          <div class="mt-0.5 truncate text-[11px] text-text-muted">{meta() || 'GPU node'}</div>
        </div>
        <div class="flex flex-shrink-0 items-center gap-1.5">
          <Show when={!props.node.ready}>
            <Badge tone="error" size="sm">NotReady</Badge>
          </Show>
          <Badge tone={nodeModeTone(props.node.mode)} size="sm">{nodeModeLabel(props.node.mode)}</Badge>
        </div>
      </div>

      <Show when={isGaming() && props.node.session}>
        <GamingSessionPanel node={props.node} now={props.now} />
      </Show>

      <Show when={props.node.models.length > 0}>
        <HostedModels node={props.node} />
      </Show>

      {/* Live GPU telemetry (Prometheus). Self-hides when no series are scraped. */}
      <GPUMetricsPanel node={props.node.name} vendor={props.node.vendor} />

      <Show when={props.node.mode === 'idle'}>
        <div class="text-[11px] text-text-dim">No inference models · GPU available</div>
      </Show>
    </div>
  );
};

const GpuFleet: Component<GpuFleetProps> = (props) => {
  const state = props.state;

  // Key by node name; signature covers only structural fields so volatile GPU
  // util/free-mem updates don't remount cards (which would reset the embedded
  // GPUMetricsPanel sparkline history).
  const stableFleet = stableListByKey(
    state.fleet,
    (n) => n.name,
    (n) =>
      [
        n.name,
        n.mode,
        n.ready,
        n.vendor,
        n.session?.status?.phase ?? '',
        n.session?.status?.runtimePod ?? '',
        n.models.map((m) => `${m.name}:${m.phase}`).join(','),
      ].join('|'),
  );

  const chips = createMemo(() => {
    const s = state.summary();
    return [
      { mode: 'gaming' as const, count: s.gaming },
      { mode: 'switching' as const, count: s.switching },
      { mode: 'serving' as const, count: s.serving },
      { mode: 'standby' as const, count: s.standby },
      { mode: 'idle' as const, count: s.idle },
    ].filter((c) => c.count > 0 || c.mode === 'gaming' || c.mode === 'serving');
  });

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="heading-label">GPU Fleet</span>
        <div class="flex flex-wrap items-center gap-1.5">
          <For each={chips()}>
            {(c) => (
              <Badge tone={nodeModeTone(c.mode)} size="sm">
                {nodeModeLabel(c.mode)} · {c.count}
              </Badge>
            )}
          </For>
        </div>
      </div>

      <Show when={state.error()}>
        <div class="rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs text-status-error">
          {sanitizeError(state.error())}
        </div>
      </Show>

      <Show
        when={state.fleet().length > 0}
        fallback={
          <div class="surface px-4 py-8 text-center text-sm text-text-dim">
            {state.loaded() ? 'No GPU nodes detected in the cluster.' : 'Loading GPU fleet…'}
          </div>
        }
      >
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          <For each={stableFleet()}>{(node) => <NodeCard node={node} now={state.now} />}</For>
        </div>
      </Show>

      {/* GPU sharing state: who holds each shared GPU + swap history. */}
      <SharingGroups models={state.models} />
    </div>
  );
};

export default GpuFleet;
