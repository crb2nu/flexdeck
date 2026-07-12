import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_SECTIONS,
  DEFAULT_LAYOUT,
  isLayout,
  moveEntry,
  normalizeLayout,
  toggleEntry,
  type LayoutEntry,
} from './layout';

describe('dashboard layout', () => {
  it('default layout lists every section, visible', () => {
    expect(DEFAULT_LAYOUT.map((e) => e.id)).toEqual(DASHBOARD_SECTIONS.map((s) => s.id));
    expect(DEFAULT_LAYOUT.every((e) => e.visible)).toBe(true);
  });

  it('validates stored shapes', () => {
    expect(isLayout(DEFAULT_LAYOUT)).toBe(true);
    expect(isLayout([{ id: 'cluster' }])).toBe(false);
    expect(isLayout('nope')).toBe(false);
  });

  it('normalize keeps user order, drops unknown ids, appends new sections visible', () => {
    const stored = [
      { id: 'main', visible: true },
      { id: 'retired-section', visible: false },
      { id: 'cluster', visible: false },
    ] as unknown as LayoutEntry[];
    const normalized = normalizeLayout(stored);
    expect(normalized.map((e) => e.id)).toEqual(['main', 'cluster', 'pinned', 'ai-ops']);
    expect(normalized.find((e) => e.id === 'cluster')?.visible).toBe(false);
    expect(normalized.find((e) => e.id === 'pinned')?.visible).toBe(true);
  });

  it('moveEntry swaps neighbours and clamps at the edges', () => {
    const moved = moveEntry(DEFAULT_LAYOUT, 'cluster', -1);
    expect(moved.map((e) => e.id)).toEqual(['cluster', 'pinned', 'ai-ops', 'main']);
    expect(moveEntry(DEFAULT_LAYOUT, 'pinned', -1)).toBe(DEFAULT_LAYOUT);
    expect(moveEntry(DEFAULT_LAYOUT, 'main', 1)).toBe(DEFAULT_LAYOUT);
  });

  it('toggleEntry flips only the targeted section', () => {
    const toggled = toggleEntry(DEFAULT_LAYOUT, 'ai-ops');
    expect(toggled.find((e) => e.id === 'ai-ops')?.visible).toBe(false);
    expect(toggled.filter((e) => e.visible)).toHaveLength(3);
  });
});
