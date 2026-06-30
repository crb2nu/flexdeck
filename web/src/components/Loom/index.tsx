import { Component, createSignal, For, Show } from 'solid-js';
import HUDConsoleScaffold, { type HUDConsoleMetric } from '../LoomHUD/HUDConsoleScaffold';
import TabBar, { type TabDef } from '../shared/TabBar';
import { createPolling } from '../../hooks/createPolling';
import { loomApi, type LoomHealth, type LoomSourceHealth } from '../../lib/api/loom';
import Plans from './Plans';

// The unified Loom control plane. Slice 1 lands the section shell + the
// /api/loom/health source-availability header; each sub-surface is filled by a
// later slice (Plans=2, Mills=3, Fleet/Projects re-home=4, Flightdeck=5).
type LoomTab = 'fleet' | 'projects' | 'plans' | 'mills' | 'flightdeck';

const TABS: TabDef<LoomTab>[] = [
  { id: 'fleet', label: 'Fleet' },
  { id: 'projects', label: 'Projects' },
  { id: 'plans', label: 'Plans' },
  { id: 'mills', label: 'Mills' },
  { id: 'flightdeck', label: 'Flightdeck' },
];

const TAB_NOTE: Record<LoomTab, string> = {
  fleet: 'Sessions, presence, handoffs, workflows, and timeline — re-homed from Loom HUD in slice 4.',
  projects: 'Per-project tasks, issues, milestones, risks, and plans — re-homed from Projects in slice 4.',
  plans: 'Plan list with slice DAG, riskiest assumption, and kill-test status — slice 2.',
  mills: 'Backlog, pipelines, council, eval, squads, audit, and policy — slice 3.',
  flightdeck: 'Stall Board and Context Ledger — slice 5.',
};

// Which federated source backs each surface (keys match /api/loom/health).
const TAB_SOURCE: Record<LoomTab, string> = {
  fleet: 'hud',
  projects: 'plans',
  plans: 'plans',
  mills: 'mills',
  flightdeck: 'flightdeck',
};

function toneFor(s: LoomSourceHealth | undefined): HUDConsoleMetric['tone'] {
  if (!s || !s.enabled) return 'purple';
  return s.available ? 'ok' : 'warn';
}

function valueFor(s: LoomSourceHealth | undefined): string {
  if (!s || !s.enabled) return 'off';
  return s.available ? 'live' : 'down';
}

const LoomPlaceholder: Component<{ source?: LoomSourceHealth; note: string }> = (props) => (
  <div class="surface px-4 py-6 text-sm">
    <div class="font-medium text-text-main">{props.note}</div>
    <Show when={props.source} fallback={<div class="mt-2 text-xs text-text-dim">data source: not reported</div>}>
      {(s) => (
        <div class="mt-2 text-xs text-text-dim">
          data source: {s().enabled ? (s().available ? 'live ✓' : 'configured, unreachable') : 'disabled'}
          <Show when={s().detail}>
            {' '}&mdash; <span class="font-mono text-text-muted">{s().detail}</span>
          </Show>
        </div>
      )}
    </Show>
  </div>
);

const Loom: Component = () => {
  const [active, setActive] = createSignal<LoomTab>('fleet');
  const [health, setHealth] = createSignal<LoomHealth | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  const fetchHealth = async () => {
    try {
      setHealth(await loomApi.health());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load loom health');
    }
  };

  createPolling('loom-health', fetchHealth, 15000);

  const source = (name: string): LoomSourceHealth | undefined => health()?.sources?.[name];

  const metrics = (): HUDConsoleMetric[] => [
    { label: 'Fleet / HUD', value: valueFor(source('hud')), tone: toneFor(source('hud')) },
    { label: 'Plans', value: valueFor(source('plans')), tone: toneFor(source('plans')) },
    { label: 'Mills', value: valueFor(source('mills')), tone: toneFor(source('mills')) },
    { label: 'Flightdeck', value: valueFor(source('flightdeck')), tone: toneFor(source('flightdeck')) },
  ];

  return (
    <div class="space-y-4">
      <HUDConsoleScaffold
        title="Loom Control Plane"
        subtitle="Unified surface for fleet, projects, plans, mills, and flightdeck — federated from loom-core."
        badge="preview"
        metrics={metrics()}
        alert={error() ? { title: 'Loom health unavailable', message: error()!, tone: 'error' } : undefined}
      >
        <TabBar tabs={TABS} active={active()} onChange={setActive} variant="underline" />
        <div class="mt-4">
          <For each={TABS}>
            {(tab) => (
              <Show when={active() === tab.id}>
                <Show
                  when={tab.id === 'plans'}
                  fallback={<LoomPlaceholder source={source(TAB_SOURCE[tab.id])} note={TAB_NOTE[tab.id]} />}
                >
                  <Plans />
                </Show>
              </Show>
            )}
          </For>
        </div>
      </HUDConsoleScaffold>
    </div>
  );
};

export default Loom;
