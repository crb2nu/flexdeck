import { Component, createSignal, For, Match, Switch } from 'solid-js';
import Badge, { type BadgeTone } from '../shared/Badge';
import TabBar, { type TabDef } from '../shared/TabBar';
import { createPolling } from '../../hooks/createPolling';
import { loomApi, type LoomHealth, type LoomSourceHealth } from '../../lib/api/loom';
import Plans from './Plans';
import Mills from './Mills';
import Fleet from './Fleet';
import Projects from '../Projects';

// The unified Loom control plane: one section over fleet, projects, plans, mills,
// and flightdeck. Fleet re-homes the existing HUD (Agents) and Projects re-homes
// the Projects page (slice 4); Plans (2) and Mills (3) are native surfaces;
// Flightdeck lands in slice 5.
type LoomTab = 'fleet' | 'projects' | 'plans' | 'mills' | 'flightdeck';

const TABS: TabDef<LoomTab>[] = [
  { id: 'fleet', label: 'Fleet' },
  { id: 'projects', label: 'Projects' },
  { id: 'plans', label: 'Plans' },
  { id: 'mills', label: 'Mills' },
  { id: 'flightdeck', label: 'Flightdeck' },
];

// Source-availability chips (keys match /api/loom/health).
const HEALTH_CHIPS: { key: string; label: string }[] = [
  { key: 'hud', label: 'Fleet' },
  { key: 'plans', label: 'Plans' },
  { key: 'mills', label: 'Mills' },
  { key: 'flightdeck', label: 'Flightdeck' },
];

function chipTone(s: LoomSourceHealth | undefined): BadgeTone {
  if (!s || !s.enabled) return 'default';
  return s.available ? 'ok' : 'warn';
}

function chipValue(s: LoomSourceHealth | undefined): string {
  if (!s || !s.enabled) return 'off';
  return s.available ? 'live' : 'down';
}

const FlightdeckPlaceholder: Component = () => (
  <div class="surface px-4 py-8 text-center text-sm text-text-dim">
    Stall Board and Context Ledger — arriving in slice 5.
  </div>
);

const Loom: Component = () => {
  const [active, setActive] = createSignal<LoomTab>('fleet');
  const [health, setHealth] = createSignal<LoomHealth | null>(null);

  const fetchHealth = async () => {
    try {
      setHealth(await loomApi.health());
    } catch {
      /* the health strip is best-effort; the surfaces report their own errors */
    }
  };
  createPolling('loom-health', fetchHealth, 15000);

  const source = (name: string): LoomSourceHealth | undefined => health()?.sources?.[name];

  return (
    <div class="flex h-full min-h-0 flex-col gap-2">
      <div class="flex-shrink-0 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="heading-label">Loom Control Plane</span>
          <div class="flex flex-wrap items-center gap-1.5">
            <For each={HEALTH_CHIPS}>
              {(c) => (
                <Badge tone={chipTone(source(c.key))} size="sm">
                  {c.label} · {chipValue(source(c.key))}
                </Badge>
              )}
            </For>
          </div>
        </div>
        <TabBar tabs={TABS} active={active()} onChange={setActive} variant="underline" />
      </div>

      {/* Definite-height, scrollable content area: embedded page surfaces
          (Fleet=Agents, Projects) fill it with their own PageScrollBody; the
          native Plans/Mills surfaces scroll within it. */}
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Switch>
          <Match when={active() === 'fleet'}>
            <Fleet />
          </Match>
          <Match when={active() === 'projects'}>
            <Projects />
          </Match>
          <Match when={active() === 'plans'}>
            <Plans />
          </Match>
          <Match when={active() === 'mills'}>
            <Mills />
          </Match>
          <Match when={active() === 'flightdeck'}>
            <FlightdeckPlaceholder />
          </Match>
        </Switch>
      </div>
    </div>
  );
};

export default Loom;
