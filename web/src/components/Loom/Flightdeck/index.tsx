import { Component, createSignal, For, Match, Show, Switch } from 'solid-js';
import Badge, { type BadgeTone } from '../../shared/Badge';
import TabBar, { type TabDef } from '../../shared/TabBar';
import { createPolling } from '../../../hooks/createPolling';
import {
  loomFlightdeckApi,
  type FlightdeckCatalogEntry,
  type FlightdeckContextSummary,
  type FlightdeckRule,
  type FlightdeckStalls,
  type FlightdeckSummary,
} from '../../../lib/api/loomFlightdeck';

type FlightdeckTab = 'stalls' | 'ledger';

const FD_TABS: TabDef<FlightdeckTab>[] = [
  { id: 'stalls', label: 'Stall Board' },
  { id: 'ledger', label: 'Context Ledger' },
];

function pollResource<T>(id: string, fetcher: () => Promise<T>, intervalMs = 15000) {
  const [data, setData] = createSignal<T | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const run = async () => {
    try {
      const v = await fetcher();
      setData(() => v);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load');
    } finally {
      setLoaded(true);
    }
  };
  createPolling(id, run, intervalMs);
  return { data, error, loaded };
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

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

const PanelState: Component<{ error: string | null; loaded: boolean; empty: string }> = (props) => (
  <div class="surface px-4 py-6 text-center text-sm">
    <Show
      when={props.error}
      fallback={<span class="text-text-dim">{props.loaded ? props.empty : 'Loading…'}</span>}
    >
      <span class="text-status-error">{props.error?.includes('disabled') ? 'Flightdeck unavailable.' : props.error}</span>
    </Show>
  </div>
);

const Metric: Component<{ label: string; value: string; tone?: BadgeTone }> = (props) => (
  <div class="surface px-3 py-2">
    <div class="heading-label">{props.label}</div>
    <div
      class={`mt-1 text-lg font-semibold tabular-nums ${
        props.tone === 'ok' ? 'text-status-ok' : props.tone === 'warn' ? 'text-status-warn' : props.tone === 'error' ? 'text-status-error' : 'text-white'
      }`}
    >
      {props.value}
    </div>
  </div>
);

const StallBoard: Component = () => {
  const summary = pollResource<FlightdeckSummary>('fd-summary', loomFlightdeckApi.summary, 10000);
  const stalls = pollResource<FlightdeckStalls>('fd-stalls', loomFlightdeckApi.stalls, 15000);
  const s = () => stalls.data();

  return (
    <div class="space-y-3">
      <div class="grid gap-2 sm:grid-cols-3">
        <Metric label="Human-wait today" value={summary.data() ? `${Math.round(summary.data()!.wait_minutes_today)}m` : '—'} tone="warn" />
        <Metric
          label="Blocked now"
          value={String(summary.data()?.blocked_now_count ?? 0)}
          tone={(summary.data()?.blocked_now_count ?? 0) > 0 ? 'error' : 'ok'}
        />
        <Metric label="Edge drops" value={fmtNum(s()?.edge_drops?.drops_total ?? 0)} />
      </div>

      <Show when={s()} fallback={<PanelState error={stalls.error()} loaded={stalls.loaded()} empty="No stall data." />}>
        <div>
          <div class="heading-label mb-1">Blocked now ({s()!.blocked_now.length})</div>
          <Show when={s()!.blocked_now.length > 0} fallback={<div class="surface px-3 py-3 text-sm text-text-muted">Nothing blocked.</div>}>
            <div class="space-y-1">
              <For each={s()!.blocked_now}>
                {(b) => (
                  <div class="surface flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div class="min-w-0">
                      <span class="text-text-main">{b.reason}</span>
                      <Show when={b.tool_short}><span class="text-text-muted"> · {b.tool_short}</span></Show>
                      <Show when={b.repo}><span class="text-[11px] text-text-muted"> · {b.repo}</span></Show>
                    </div>
                    <Badge tone="warn" size="sm">{fmtWait(b.waiting_seconds)}</Badge>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>

        <div>
          <div class="heading-label mb-1">Stall pareto</div>
          <Show when={s()!.pareto.length > 0} fallback={<div class="surface px-3 py-3 text-sm text-text-muted">No closed stalls in window.</div>}>
            <div class="surface overflow-hidden">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-white/8 text-left text-[11px] uppercase tracking-wide text-text-muted">
                    <th class="px-3 py-2 font-medium">Reason / tool</th>
                    <th class="px-3 py-2 font-medium text-right">Count</th>
                    <th class="px-3 py-2 font-medium text-right">p50</th>
                    <th class="px-3 py-2 font-medium text-right">p95</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={s()!.pareto}>
                    {(p) => (
                      <tr class="border-b border-white/5 last:border-0">
                        <td class="px-3 py-1.5 text-text-dim">{p.reason}<Show when={p.tool_short}> · {p.tool_short}</Show></td>
                        <td class="px-3 py-1.5 text-right tabular-nums text-text-main">{p.count}</td>
                        <td class="px-3 py-1.5 text-right tabular-nums text-text-muted">{fmtMs(p.p50_ms)}</td>
                        <td class="px-3 py-1.5 text-right tabular-nums text-text-muted">{fmtMs(p.p95_ms)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
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
  const ctx = pollResource<{ summary: FlightdeckContextSummary }>('fd-ctx', loomFlightdeckApi.contextSummary, 30000);
  const cat = pollResource<{ catalog: FlightdeckCatalogEntry[] }>('fd-catalog', loomFlightdeckApi.catalog, 60000);
  const rules = pollResource<{ rules: FlightdeckRule[] }>('fd-rules', loomFlightdeckApi.rules, 60000);
  const catalog = () => cat.data()?.catalog ?? [];
  const deadWeight = () => catalog().filter((c) => (c.verdict || '').toLowerCase() === 'dead_weight').length;

  return (
    <div class="space-y-3">
      <div class="grid gap-2 sm:grid-cols-3">
        <Metric label="Wasted tokens / week" value={fmtNum(ctx.data()?.summary?.wasted_tokens_week ?? 0)} tone="warn" />
        <Metric label="Catalog tools" value={String(catalog().length)} />
        <Metric label="Dead weight" value={String(deadWeight())} tone={deadWeight() > 0 ? 'error' : 'ok'} />
      </div>

      <div>
        <div class="heading-label mb-1">Tool catalog</div>
        <Show when={catalog().length > 0} fallback={<PanelState error={cat.error()} loaded={cat.loaded()} empty="No tool catalog." />}>
          <div class="surface overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-white/8 text-left text-[11px] uppercase tracking-wide text-text-muted">
                  <th class="px-3 py-2 font-medium">Tool</th>
                  <th class="px-3 py-2 font-medium text-right">Calls</th>
                  <th class="px-3 py-2 font-medium text-right">Cost/use</th>
                  <th class="px-3 py-2 font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                <For each={catalog()}>
                  {(c) => (
                    <tr class="border-b border-white/5 last:border-0">
                      <td class="px-3 py-1.5 text-text-dim"><span class="text-text-muted">{c.server}·</span>{c.tool}</td>
                      <td class="px-3 py-1.5 text-right tabular-nums text-text-main">{c.calls}</td>
                      <td class="px-3 py-1.5 text-right tabular-nums text-text-muted">{fmtNum(c.cost_per_use_est)}</td>
                      <td class="px-3 py-1.5"><Badge tone={verdictTone(c.verdict)} size="sm">{(c.verdict || '').replace('_', ' ')}</Badge></td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>

      <div>
        <div class="heading-label mb-1">Rules ledger</div>
        <Show when={(rules.data()?.rules?.length ?? 0) > 0} fallback={<PanelState error={rules.error()} loaded={rules.loaded()} empty="No rules." />}>
          <div class="space-y-1">
            <For each={rules.data()!.rules}>
              {(r) => (
                <div class="surface flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                  <span class="min-w-0 truncate text-text-dim"><span class="text-text-muted">{r.repo}/</span>{r.path}</span>
                  <div class="flex flex-shrink-0 items-center gap-2 text-[11px] text-text-muted">
                    <span class="tabular-nums">{fmtNum(r.token_estimate)} tok</span>
                    <Badge tone={r.evidence === 'measured_use' ? 'ok' : 'default'} size="sm">{(r.evidence || '').replace(/_/g, ' ')}</Badge>
                  </div>
                </div>
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
