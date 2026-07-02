import { Component, createSignal, For, Match, Switch } from 'solid-js';
import Badge, { type BadgeTone } from '../shared/Badge';
import PageScrollBody from '../shared/PageScrollBody';
import TabBar, { type TabDef } from '../shared/TabBar';
import { createPolledResource } from '../../hooks/createPolledResource';
import { loomApi, type LoomHealth, type LoomSourceHealth } from '../../lib/api/loom';
import Plans from './Plans';
import Mills from './Mills';
import Fleet from './Fleet';
import Flightdeck from './Flightdeck';
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

const Loom: Component = () => {
  const [active, setActive] = createSignal<LoomTab>('fleet');

  // Best-effort health strip: errors are ignored (each surface reports its
  // own), and reconcile keeps the chips from re-rendering on identical polls.
  const health = createPolledResource<LoomHealth>('loom-health', loomApi.health);

  const source = (name: string): LoomSourceHealth | undefined => health.data()?.sources?.[name];

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

      {/* Definite-height content area. Exactly ONE scroll container per tab:
          embedded page surfaces (Fleet=Agents, Projects) bring their own
          PageScrollBody; native surfaces get one here — no nested scrollers. */}
      <div class="min-h-0 flex-1">
        <Switch>
          <Match when={active() === 'fleet'}>
            <Fleet />
          </Match>
          <Match when={active() === 'projects'}>
            <Projects />
          </Match>
          <Match when={active() === 'plans'}>
            <PageScrollBody><Plans /></PageScrollBody>
          </Match>
          <Match when={active() === 'mills'}>
            <PageScrollBody><Mills /></PageScrollBody>
          </Match>
          <Match when={active() === 'flightdeck'}>
            <PageScrollBody><Flightdeck /></PageScrollBody>
          </Match>
        </Switch>
      </div>
    </div>
  );
};

export default Loom;
