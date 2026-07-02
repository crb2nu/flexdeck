import { Component, createSignal, For, Match, Show, Switch } from 'solid-js';
import Badge, { type BadgeTone } from '../../shared/Badge';
import ListRow from '../../shared/ListRow';
import MetricTile from '../../shared/MetricTile';
import MiniTable, { type MiniColumn } from '../../shared/MiniTable';
import PanelState from '../../shared/PanelState';
import TabBar, { type TabDef } from '../../shared/TabBar';
import { createPolledResource } from '../../../hooks/createPolledResource';
import { formatCompact, formatMs, formatSeconds } from '../../../lib/format';
import {
  loomFlightdeckApi,
  type FlightdeckCatalogEntry,
  type FlightdeckContextSummary,
  type FlightdeckPareto,
  type FlightdeckRule,
  type FlightdeckStalls,
  type FlightdeckSummary,
} from '../../../lib/api/loomFlightdeck';

type FlightdeckTab = 'stalls' | 'ledger';

const FD_TABS: TabDef<FlightdeckTab>[] = [
  { id: 'stalls', label: 'Stall Board' },
  { id: 'ledger', label: 'Context Ledger' },
];

const FD_OFFLINE = 'Flightdeck unavailable.';

function verdictTone(verdict: string): BadgeTone {
  switch ((verdict || '').toLowerCase()) {
    case 'earning':
      return 'ok';
    case 'dead_weight':
      return 'error';
    case 'new':
      return 'warn';
    default:
      return 'default';
  }
}

const PARETO_COLUMNS: MiniColumn<FlightdeckPareto>[] = [
  {
    header: 'Reason / tool',
    class: 'text-text-dim',
    cell: (p) => <>{p.reason}<Show when={p.tool_short}> · {p.tool_short}</Show></>,
  },
  { header: 'Count', align: 'right', class: 'tabular-nums text-text-main', cell: (p) => p.count },
  { header: 'p50', align: 'right', class: 'tabular-nums text-text-muted', cell: (p) => formatMs(p.p50_ms) },
  { header: 'p95', align: 'right', class: 'tabular-nums text-text-muted', cell: (p) => formatMs(p.p95_ms) },
];

const CATALOG_COLUMNS: MiniColumn<FlightdeckCatalogEntry>[] = [
  {
    header: 'Tool',
    class: 'text-text-dim',
    cell: (c) => <><span class="text-text-muted">{c.server}·</span>{c.tool}</>,
  },
  { header: 'Calls', align: 'right', class: 'tabular-nums text-text-main', cell: (c) => c.calls },
  { header: 'Cost/use', align: 'right', class: 'tabular-nums text-text-muted', cell: (c) => formatCompact(c.cost_per_use_est) },
  {
    header: 'Verdict',
    cell: (c) => <Badge tone={verdictTone(c.verdict)} size="sm">{(c.verdict || '').replace('_', ' ')}</Badge>,
  },
];

const StallBoard: Component = () => {
  const summary = createPolledResource<FlightdeckSummary>('fd-summary', loomFlightdeckApi.summary, { interval: 10000 });
  const stalls = createPolledResource<FlightdeckStalls>('fd-stalls', loomFlightdeckApi.stalls, { key: 'stall_id' });
  const s = () => stalls.data();

  return (
    <div class="space-y-3">
      <div class="grid gap-2 sm:grid-cols-3">
        <MetricTile label="Human-wait today" value={summary.data() ? `${Math.round(summary.data()!.wait_minutes_today)}m` : '—'} tone="warn" />
        <MetricTile
          label="Blocked now"
          value={String(summary.data()?.blocked_now_count ?? 0)}
          tone={(summary.data()?.blocked_now_count ?? 0) > 0 ? 'error' : 'ok'}
        />
        <MetricTile label="Edge drops" value={formatCompact(s()?.edge_drops?.drops_total ?? 0)} />
      </div>

      <Show when={s()} fallback={<PanelState error={stalls.error()} loaded={stalls.loaded()} empty="No stall data." offlineLabel={FD_OFFLINE} />}>
        <div>
          <div class="heading-label mb-1">Blocked now ({s()!.blocked_now.length})</div>
          <Show when={s()!.blocked_now.length > 0} fallback={<div class="surface px-3 py-3 text-sm text-text-muted">Nothing blocked.</div>}>
            <div class="space-y-1">
              <For each={s()!.blocked_now}>
                {(b) => (
                  <ListRow class="text-sm" trailing={<Badge tone="warn" size="sm">{formatSeconds(b.waiting_seconds)}</Badge>}>
                    <span class="text-text-main">{b.reason}</span>
                    <Show when={b.tool_short}><span class="text-text-muted"> · {b.tool_short}</span></Show>
                    <Show when={b.repo}><span class="text-[11px] text-text-muted"> · {b.repo}</span></Show>
                  </ListRow>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div>
          <div class="heading-label mb-1">Stall pareto</div>
          <Show when={s()!.pareto.length > 0} fallback={<div class="surface px-3 py-3 text-sm text-text-muted">No closed stalls in window.</div>}>
            <MiniTable columns={PARETO_COLUMNS} each={s()!.pareto} dense />
          </Show>
        </div>

        <div class="grid gap-2 sm:grid-cols-2">
          <div class="surface px-3 py-2">
            <div class="heading-label">Abandoned</div>
            <div class="mt-1 text-sm text-text-dim">{s()!.abandoned_and_interrupted.abandoned_sessions.length} sessions</div>
          </div>
          <div class="surface px-3 py-2">
            <div class="heading-label">User interrupts</div>
            <div class="mt-1 text-sm text-text-dim">{s()!.abandoned_and_interrupted.interrupts.length}</div>
          </div>
        </div>
      </Show>
    </div>
  );
};

const ContextLedger: Component = () => {
  const ctx = createPolledResource<{ summary: FlightdeckContextSummary }>('fd-ctx', loomFlightdeckApi.contextSummary, { interval: 30000 });
  const cat = createPolledResource<{ catalog: FlightdeckCatalogEntry[] }>('fd-catalog', loomFlightdeckApi.catalog, { interval: 60000, key: 'tool' });
  const rules = createPolledResource<{ rules: FlightdeckRule[] }>('fd-rules', loomFlightdeckApi.rules, { interval: 60000, key: 'path' });
  const catalog = () => cat.data()?.catalog ?? [];
  const deadWeight = () => catalog().filter((c) => (c.verdict || '').toLowerCase() === 'dead_weight').length;

  return (
    <div class="space-y-3">
      <div class="grid gap-2 sm:grid-cols-3">
        <MetricTile label="Wasted tokens / week" value={formatCompact(ctx.data()?.summary?.wasted_tokens_week ?? 0)} tone="warn" />
        <MetricTile label="Catalog tools" value={String(catalog().length)} />
        <MetricTile label="Dead weight" value={String(deadWeight())} tone={deadWeight() > 0 ? 'error' : 'ok'} />
      </div>

      <div>
        <div class="heading-label mb-1">Tool catalog</div>
        <Show when={catalog().length > 0} fallback={<PanelState error={cat.error()} loaded={cat.loaded()} empty="No tool catalog." offlineLabel={FD_OFFLINE} />}>
          <MiniTable columns={CATALOG_COLUMNS} each={catalog()} dense />
        </Show>
      </div>

      <div>
        <div class="heading-label mb-1">Rules ledger</div>
        <Show when={(rules.data()?.rules?.length ?? 0) > 0} fallback={<PanelState error={rules.error()} loaded={rules.loaded()} empty="No rules." offlineLabel={FD_OFFLINE} />}>
          <div class="space-y-1">
            <For each={rules.data()!.rules}>
              {(r) => (
                <ListRow
                  dense
                  class="text-sm"
                  trailing={
                    <div class="flex items-center gap-2 text-[11px] text-text-muted">
                      <span class="tabular-nums">{formatCompact(r.token_estimate)} tok</span>
                      <Badge tone={r.evidence === 'measured_use' ? 'ok' : 'default'} size="sm">{(r.evidence || '').replace(/_/g, ' ')}</Badge>
                    </div>
                  }
                >
                  <span class="block min-w-0 truncate text-text-dim"><span class="text-text-muted">{r.repo}/</span>{r.path}</span>
                </ListRow>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};

const Flightdeck: Component = () => {
  const [active, setActive] = createSignal<FlightdeckTab>('stalls');
  return (
    <div class="space-y-3">
      <TabBar tabs={FD_TABS} active={active()} onChange={setActive} variant="underline" />
      <Switch>
        <Match when={active() === 'stalls'}><StallBoard /></Match>
        <Match when={active() === 'ledger'}><ContextLedger /></Match>
      </Switch>
    </div>
  );
};

export default Flightdeck;
