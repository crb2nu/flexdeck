import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { createPersistedSignal } from '../../hooks/createPersistedSignal';
import { healthStore } from '../../stores/health';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
import {
  flexinferProxyError,
  flexinferProxyHealth,
  flexinferProxyMetrics,
  flexinferProxyUpdatedAt,
} from '../../stores/flexinferOperational';
import { errorRateForModel } from '../Models/inferenceMetrics';
import Input from '../shared/Input';
import type { FlexInferProxyModelMetrics } from '../../lib/types';

type SortKey = 'heat' | 'model' | 'requests' | 'rps' | 'p95' | 'queue' | 'conn' | 'err';

interface TelemetryRow {
  name: string;
  metrics: FlexInferProxyModelMetrics;
  rps: number;
  errorRate: number;
  p95Ms: number | null;
}

const COLUMNS: Array<{ key: SortKey; label: string; align: 'left' | 'right'; title?: string }> = [
  { key: 'model', label: 'Model', align: 'left' },
  { key: 'requests', label: 'Requests', align: 'right' },
  { key: 'rps', label: 'req/s', align: 'right', title: 'Requests per second (sampled between polls)' },
  { key: 'p95', label: 'p95', align: 'right', title: 'p95 request latency (from proxy histogram)' },
  { key: 'queue', label: 'Queue', align: 'right' },
  { key: 'conn', label: 'Conns', align: 'right' },
  { key: 'err', label: 'Error %', align: 'right' },
];

function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}

function formatRps(rps: number): string {
  if (rps <= 0) return '—';
  if (rps < 10) return rps.toFixed(1);
  return Math.round(rps).toLocaleString();
}

// Pre-attentive latency tone. Bounds are generous: only flag the genuinely slow.
function latencyTone(ms: number | null): string {
  if (ms == null) return 'text-text-dim';
  if (ms >= 5000) return 'text-sem-crit';
  if (ms >= 2000) return 'text-sem-warn';
  return 'text-text-muted';
}

function queueTone(queue: number): string {
  if (queue >= 100) return 'text-sem-crit';
  if (queue >= 10) return 'text-sem-warn';
  if (queue > 0) return 'text-util-near';
  return 'text-text-dim';
}

// Composite triage score: queue dominates, then error rate, then live throughput.
function heatScore(row: TelemetryRow): number {
  return (row.metrics.queueDepth || 0) * 1e6 + row.errorRate * 1e3 + Math.min(row.rps, 999);
}

function isActiveRow(row: TelemetryRow): boolean {
  return (
    (row.metrics.queueDepth || 0) > 0 ||
    (row.metrics.activeConnections || 0) > 0 ||
    row.rps > 0 ||
    row.errorRate > 0
  );
}

const RibbonTile: Component<{ label: string; value: string; tone?: string; note?: string }> = (props) => (
  <div class="surface min-w-[7.5rem] flex-1 px-3 py-2.5">
    <div class="heading-label">{props.label}</div>
    <div class={`mt-1 font-mono text-lg leading-none ${props.tone ?? 'text-text-main'}`}>{props.value}</div>
    <Show when={props.note}>
      <div class="mt-1 text-[10px] text-text-dim">{props.note}</div>
    </Show>
  </div>
);

export interface ModelTelemetryPanelProps {
  /** Optional drill-in handler; when provided, rows become clickable. */
  onSelectModel?: (model: string) => void;
}

/**
 * Live per-model proxy telemetry as a triage console: a health ribbon plus a
 * sortable/searchable table that floats hot models (queueing, erroring, busy)
 * to the top. Cells read live signals so the DOM rows persist across polls and
 * only reorder when a model's heat genuinely changes.
 */
const ModelTelemetryPanel: Component<ModelTelemetryPanelProps> = (props) => {
  const enabled = () => healthStore.features?.flexinfer_proxy?.enabled ?? false;
  const totals = () => flexinferProxyMetrics()?.totals ?? null;
  const health = flexinferProxyHealth;

  // Deep-link support (/flexinfer?section=telemetry&q=model): the palette and
  // model links can land here with the model filter pre-applied. URL → state
  // only; the panel stays mounted across section switches, so re-apply on
  // every param change rather than reading once.
  const [searchParams] = useSearchParams<{ q?: string }>();
  const [query, setQuery] = createSignal(searchParams.q ?? '');
  createEffect(() => setQuery(searchParams.q ?? ''));
  // Hide-idle is a standing triage preference — it survives reloads.
  const [hideIdle, setHideIdle] = createPersistedSignal('telemetry.hideIdle', false, isBoolean);
  const [sortKey, setSortKey] = createSignal<SortKey>('heat');
  const [sortDir, setSortDir] = createSignal<'asc' | 'desc'>('desc');

  // Client-sampled requests/sec: diff cumulative request counters between polls.
  const [rpsByModel, setRpsByModel] = createSignal<Record<string, number>>({});
  let prevSample: { ts: number; requests: Record<string, number> } | null = null;
  createEffect(() => {
    const metrics = flexinferProxyMetrics();
    const ts = flexinferProxyUpdatedAt();
    if (!metrics?.byModel) return;

    const requests: Record<string, number> = {};
    for (const [name, bucket] of Object.entries(metrics.byModel)) {
      if (name === '_total') continue;
      requests[name] = bucket.requestsTotal || 0;
    }

    if (prevSample && ts > prevSample.ts) {
      const dt = (ts - prevSample.ts) / 1000;
      if (dt > 0) {
        const next: Record<string, number> = {};
        for (const name of Object.keys(requests)) {
          const delta = requests[name] - (prevSample.requests[name] ?? requests[name]);
          next[name] = delta > 0 ? delta / dt : 0; // counter resets clamp to 0
        }
        setRpsByModel(next);
      }
    }
    prevSample = { ts, requests };
  });

  const rows = createMemo<TelemetryRow[]>(() => {
    const metrics = flexinferProxyMetrics();
    if (!metrics?.byModel) return [];
    const rps = rpsByModel();
    return Object.entries(metrics.byModel)
      .filter(([name]) => name !== '_total')
      .map(([name, bucket]) => ({
        name,
        metrics: bucket,
        rps: rps[name] ?? 0,
        errorRate: errorRateForModel(metrics, name),
        p95Ms: typeof bucket.latencyP95Ms === 'number' ? bucket.latencyP95Ms : null,
      }));
  });

  const hotCount = createMemo(() => rows().filter((r) => (r.metrics.queueDepth || 0) > 0 || r.errorRate > 0).length);
  const activeCount = createMemo(() => rows().filter(isActiveRow).length);

  const visibleRows = createMemo<TelemetryRow[]>(() => {
    const term = query().trim().toLowerCase();
    let list = rows();
    if (term) list = list.filter((r) => r.name.toLowerCase().includes(term));
    if (hideIdle()) list = list.filter(isActiveRow);

    const dir = sortDir() === 'asc' ? 1 : -1;
    const key = sortKey();
    return list.slice().sort((a, b) => {
      let delta: number;
      if (key === 'model') delta = a.name.localeCompare(b.name);
      else if (key === 'heat') delta = heatScore(a) - heatScore(b);
      else if (key === 'requests') delta = (a.metrics.requestsTotal || 0) - (b.metrics.requestsTotal || 0);
      else if (key === 'rps') delta = a.rps - b.rps;
      else if (key === 'p95') delta = (a.p95Ms ?? -1) - (b.p95Ms ?? -1);
      else if (key === 'queue') delta = (a.metrics.queueDepth || 0) - (b.metrics.queueDepth || 0);
      else if (key === 'conn') delta = (a.metrics.activeConnections || 0) - (b.metrics.activeConnections || 0);
      else delta = a.errorRate - b.errorRate;
      if (delta === 0) return a.name.localeCompare(b.name); // stable, deterministic tiebreak
      return delta * dir;
    });
  });

  // Stable string order for <For>: identical model-name strings reconcile as
  // moves (not rebuilds), so reordering never tears down a row.
  const orderedNames = createMemo(() => visibleRows().map((r) => r.name));

  function toggleSort(key: SortKey) {
    if (sortKey() === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'model' ? 'asc' : 'desc');
    }
  }

  const sortIndicator = (key: SortKey) => (sortKey() === key ? (sortDir() === 'asc' ? '↑' : '↓') : '');

  const liveRow = (name: string): TelemetryRow | undefined => visibleRows().find((r) => r.name === name);

  return (
    <div class="space-y-4">
      {/* Health ribbon */}
      <div class="flex flex-wrap gap-3">
        <RibbonTile
          label="Proxy"
          value={enabled() ? (health()?.status || 'ok') : 'off'}
          tone={
            !enabled() || health()?.healthy === false
              ? 'text-sem-warn'
              : 'text-status-ok'
          }
          note={health()?.message || (enabled() ? 'FlexInfer proxy' : 'disabled')}
        />
        <RibbonTile label="Models" value={`${totals()?.modelCount ?? 0}`} note={`${activeCount()} active`} />
        <RibbonTile label="Requests" value={(totals()?.requestsTotal ?? 0).toLocaleString()} />
        <RibbonTile
          label="p95 latency"
          value={formatLatency(totals()?.latencyP95Ms)}
          tone={latencyTone(totals()?.latencyP95Ms ?? null)}
          note={totals()?.latencyP50Ms != null ? `p50 ${formatLatency(totals()?.latencyP50Ms)}` : undefined}
        />
        <RibbonTile
          label="Error rate"
          value={`${((totals()?.errorRate ?? 0) * 100).toFixed(2)}%`}
          tone={(totals()?.errorRate ?? 0) > 0 ? 'text-sem-warn' : 'text-text-main'}
        />
        <RibbonTile
          label="Queue depth"
          value={(totals()?.queueDepth ?? 0).toLocaleString()}
          tone={queueTone(totals()?.queueDepth ?? 0)}
        />
        <RibbonTile label="Active conns" value={(totals()?.activeConnections ?? 0).toLocaleString()} />
        <RibbonTile
          label="Hot models"
          value={`${hotCount()}`}
          tone={hotCount() > 0 ? 'text-sem-warn' : 'text-text-dim'}
          note="queueing or erroring"
        />
      </div>

      <Show when={flexinferProxyMetrics()?.partial}>
        <div class="rounded-md border border-status-warn/20 bg-status-warn/10 px-3 py-2 text-[11px] text-status-warn">
          Proxy metrics are partial — one or more upstream lines could not be parsed.
        </div>
      </Show>
      <Show when={flexinferProxyError()}>
        <div class="rounded-md border border-status-error/20 bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
          {flexinferProxyError()}
        </div>
      </Show>

      {/* Triage table */}
      <div class="surface overflow-hidden">
        <div class="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
          <div class="heading-label">Per-model telemetry</div>
          <div class="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              size="sm"
              class="w-44"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              onClear={() => setQuery('')}
              placeholder="Filter models…"
              aria-label="Filter models by name"
            />
            <button
              type="button"
              onClick={() => setHideIdle((v) => !v)}
              aria-pressed={hideIdle()}
              class="rounded-md border px-2.5 py-1 text-xs transition-colors"
              classList={{
                'border-white/20 bg-white/10 text-text-main': hideIdle(),
                'border-white/10 bg-white/[0.03] text-text-muted hover:text-text-main': !hideIdle(),
              }}
            >
              Hide idle
            </button>
          </div>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b border-white/5 text-left text-text-dim">
                <For each={COLUMNS}>
                  {(col) => (
                    <th
                      class="px-4 py-3 font-medium select-none"
                      classList={{ 'text-right': col.align === 'right' }}
                      aria-sort={
                        sortKey() === col.key ? (sortDir() === 'asc' ? 'ascending' : 'descending') : 'none'
                      }
                      title={col.title}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        class="inline-flex items-center gap-1 transition-colors hover:text-text-main"
                        classList={{ 'text-text-muted': sortKey() === col.key }}
                      >
                        <span>{col.label}</span>
                        <span class="w-2 text-text-muted">{sortIndicator(col.key)}</span>
                      </button>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For
                each={orderedNames()}
                fallback={
                  <tr>
                    <td class="px-4 py-6 text-center text-text-dim" colSpan={COLUMNS.length}>
                      {!enabled()
                        ? 'FlexInfer proxy is disabled.'
                        : query() || hideIdle()
                          ? 'No models match the current filter.'
                          : 'No proxy metrics available yet.'}
                    </td>
                  </tr>
                }
              >
                {(name) => {
                  const row = () => liveRow(name);
                  const m = () => row()?.metrics;
                  const queue = () => m()?.queueDepth || 0;
                  const clickable = () => Boolean(props.onSelectModel);
                  return (
                    <tr
                      class="border-b border-white/5 transition-colors hover:bg-white/5"
                      classList={{
                        'bg-status-warn/[0.06]': queue() > 0 || (m()?.errorsTotal || 0) > 0,
                        'cursor-pointer': clickable(),
                      }}
                      onClick={() => props.onSelectModel?.(name)}
                      tabindex={clickable() ? 0 : undefined}
                      role={clickable() ? 'button' : undefined}
                      onKeyDown={(e) => {
                        if (clickable() && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          props.onSelectModel?.(name);
                        }
                      }}
                    >
                      <td class="px-4 py-3 font-mono text-text-main">{name}</td>
                      <td class="px-4 py-3 text-right font-mono text-text-muted">
                        {(m()?.requestsTotal || 0).toLocaleString()}
                      </td>
                      <td class="px-4 py-3 text-right font-mono text-text-muted">{formatRps(row()?.rps || 0)}</td>
                      <td class={`px-4 py-3 text-right font-mono ${latencyTone(row()?.p95Ms ?? null)}`}>
                        {formatLatency(row()?.p95Ms)}
                      </td>
                      <td class="px-4 py-3 text-right">
                        <div class="flex items-center justify-end gap-2">
                          <span class={`font-mono ${queueTone(queue())}`}>{queue().toLocaleString()}</span>
                          <span class="hidden h-1.5 w-12 overflow-hidden rounded-full bg-white/5 sm:block" aria-hidden="true">
                            <span
                              class="block h-full rounded-full transition-all"
                              classList={{
                                'bg-sem-crit': queue() >= 100,
                                'bg-sem-warn': queue() >= 10 && queue() < 100,
                                'bg-util-safe': queue() > 0 && queue() < 10,
                              }}
                              style={{ width: `${Math.min((queue() / 100) * 100, 100)}%` }}
                            />
                          </span>
                        </div>
                      </td>
                      <td class="px-4 py-3 text-right font-mono text-text-muted">
                        {(m()?.activeConnections || 0).toLocaleString()}
                      </td>
                      <td class="px-4 py-3 text-right">
                        <Show
                          when={(row()?.errorRate || 0) > 0}
                          fallback={<span class="font-mono text-text-dim">0.00%</span>}
                        >
                          <span class="num rounded-full bg-sem-crit/15 px-2 py-0.5 font-mono text-sem-crit">
                            {((row()?.errorRate || 0) * 100).toFixed(2)}%
                          </span>
                        </Show>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ModelTelemetryPanel;
