/* @vitest-environment jsdom */

import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { HashRouter, Route } from '@solidjs/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaletteCommand } from '../QuickLaunch/commands';
import { pins, removePin } from '../../stores/pins';

const entityMocks = vi.hoisted(() => ({
  fetchEntityCommands: vi.fn<() => Promise<PaletteCommand[]>>(),
}));

vi.mock('../QuickLaunch/entities', () => ({
  fetchEntityCommands: entityMocks.fetchEntityCommands,
}));

vi.mock('../../stores/health', () => ({
  healthStore: { features: {} },
}));

import PinnedStrip from './PinnedStrip';

function entity(id: string, name: string): PaletteCommand {
  return {
    id,
    name,
    description: `entity ${name}`,
    keywords: [],
    href: `/stack?q=${name}`,
    section: 'Repos',
  };
}

const flush = () => new Promise((r) => setTimeout(r, 40));

function mount(factory: () => JSX.Element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => (
    <HashRouter>
      <Route path="/" component={() => factory()} />
    </HashRouter>
  ), container);
  return () => {
    dispose();
    container.remove();
  };
}

function pressKey(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function typeQuery(text: string) {
  const input = document.querySelector<HTMLInputElement>('input[type="search"]');
  expect(input).toBeTruthy();
  input!.value = text;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
}

function openPicker() {
  const trigger = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === '+ Pin');
  expect(trigger).toBeTruthy();
  trigger!.click();
}

function optionNames(): string[] {
  return Array.from(document.querySelectorAll('[role="option"]')).map(
    (o) => o.querySelector('span + span > span')?.textContent ?? '',
  );
}

describe('PinnedStrip add-pin picker', () => {
  let cleanup: () => void = () => undefined;

  beforeEach(() => {
    // jsdom has no scrollIntoView; the picker calls it when the highlight moves.
    Element.prototype.scrollIntoView = vi.fn();
    for (const p of [...pins()]) removePin(p.id);
    entityMocks.fetchEntityCommands.mockResolvedValue([
      entity('repo:zeta-one', 'zeta-one'),
      entity('repo:zeta-two', 'zeta-two'),
    ]);
  });

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    document.body.innerHTML = '';
  });

  it('pins the highlighted result with Enter and closes the picker', async () => {
    cleanup = mount(() => <PinnedStrip />);

    openPicker();
    await flush();
    typeQuery('zeta');
    await flush();

    const names = optionNames();
    expect(names.length).toBeGreaterThanOrEqual(2);

    pressKey('Enter');
    expect(pins().map((p) => p.name)).toEqual([names[0]]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('moves the highlight with ArrowDown/ArrowUp and reflects it in aria-activedescendant', async () => {
    cleanup = mount(() => <PinnedStrip />);

    openPicker();
    await flush();
    typeQuery('zeta');
    await flush();

    const names = optionNames();
    const input = document.querySelector<HTMLInputElement>('input[type="search"]');
    const listboxId = input!.getAttribute('aria-controls');
    expect(listboxId).toBeTruthy();
    expect(input!.getAttribute('aria-activedescendant')).toBe(`${listboxId}-opt-0`);

    pressKey('ArrowDown');
    expect(input!.getAttribute('aria-activedescendant')).toBe(`${listboxId}-opt-1`);
    expect(document.querySelector(`#${listboxId}-opt-1`)?.getAttribute('aria-selected')).toBe('true');

    pressKey('Enter');
    expect(pins().map((p) => p.name)).toEqual([names[1]]);
  });

  it('closes on Escape without pinning', async () => {
    cleanup = mount(() => <PinnedStrip />);

    openPicker();
    await flush();
    typeQuery('zeta');
    await flush();

    pressKey('Escape');
    expect(pins()).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
