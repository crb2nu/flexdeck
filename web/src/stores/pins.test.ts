import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PINS, addPin, isPinned, pins, removePin, type PinnedItem } from './pins';

function pin(id: string): PinnedItem {
  return { id, name: id, description: `desc ${id}`, href: `/stack?q=${id}`, section: 'Repos' };
}

describe('pins store', () => {
  beforeEach(() => {
    // The store is module-level; drain it between tests.
    for (const p of [...pins()]) removePin(p.id);
  });

  it('adds, dedupes, and removes pins', () => {
    expect(addPin(pin('a'))).toBe(true);
    expect(addPin(pin('a'))).toBe(true); // dedupe, still "success"
    expect(pins()).toHaveLength(1);
    expect(isPinned('a')).toBe(true);

    removePin('a');
    expect(pins()).toHaveLength(0);
    expect(isPinned('a')).toBe(false);
  });

  it('caps at MAX_PINS and reports failure past the cap', () => {
    for (let i = 0; i < MAX_PINS; i++) {
      expect(addPin(pin(`p${i}`))).toBe(true);
    }
    expect(addPin(pin('overflow'))).toBe(false);
    expect(pins()).toHaveLength(MAX_PINS);
    expect(isPinned('overflow')).toBe(false);
  });

  it('persists to localStorage under the pref key', () => {
    addPin(pin('persisted'));
    const raw = localStorage.getItem('flexdeck.pref.dashboard.pins');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual([pin('persisted')]);
  });
});
