import { createPersistedSignal } from '../hooks/createPersistedSignal';

// Pinned resources for the dashboard home: user-chosen quick links to repos,
// workloads, models, or pages, persisted per browser. Shape matches the
// palette's entity commands so the add-pin picker can reuse that search.
export interface PinnedItem {
  id: string;
  name: string;
  description: string;
  href: string;
  /** Palette section, drives the icon: Repos | Workloads | Models | ... */
  section: string;
}

export const MAX_PINS = 12;

function isPinnedItem(value: unknown): value is PinnedItem {
  if (typeof value !== 'object' || value == null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.description === 'string' &&
    typeof v.href === 'string' &&
    typeof v.section === 'string'
  );
}

function isPinnedList(value: unknown): value is PinnedItem[] {
  return Array.isArray(value) && value.every(isPinnedItem);
}

const [pins, setPins] = createPersistedSignal<PinnedItem[]>('dashboard.pins', [], isPinnedList);

export { pins };

export function isPinned(id: string): boolean {
  return pins().some((p) => p.id === id);
}

/** Add a pin (dedupes by id, capped at MAX_PINS). Returns false when full. */
export function addPin(item: PinnedItem): boolean {
  if (isPinned(item.id)) return true;
  if (pins().length >= MAX_PINS) return false;
  setPins((prev) => [...prev, item]);
  return true;
}

export function removePin(id: string): void {
  setPins((prev) => prev.filter((p) => p.id !== id));
}

/** Swap a pin with its neighbor (no-op at the ends or for unknown ids). */
export function movePin(id: string, delta: -1 | 1): void {
  setPins((prev) => {
    const index = prev.findIndex((p) => p.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= prev.length) return prev;
    const next = [...prev];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
}
