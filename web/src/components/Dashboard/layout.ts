// Dashboard section layout: which sections show and in what order, persisted
// per browser. Stored as an ordered list of {id, visible} entries.

export type DashboardSectionId = 'pinned' | 'cluster' | 'ai-ops' | 'main';

export interface SectionDef {
  id: DashboardSectionId;
  label: string;
}

export interface LayoutEntry {
  id: DashboardSectionId;
  visible: boolean;
}

export const DASHBOARD_SECTIONS: SectionDef[] = [
  { id: 'pinned', label: 'Pinned' },
  { id: 'cluster', label: 'Cluster cards' },
  { id: 'ai-ops', label: 'AI operations' },
  { id: 'main', label: 'Cluster view' },
];

export const DEFAULT_LAYOUT: LayoutEntry[] = DASHBOARD_SECTIONS.map((s) => ({ id: s.id, visible: true }));

export function isLayout(value: unknown): value is LayoutEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (v) =>
        typeof v === 'object' &&
        v != null &&
        typeof (v as LayoutEntry).id === 'string' &&
        typeof (v as LayoutEntry).visible === 'boolean',
    )
  );
}

/**
 * Reconcile a stored layout with the app's current section list: drop ids the
 * app no longer knows, keep the stored order for the rest, and append any new
 * sections (visible) at their default position relative to nothing — i.e. at
 * the end, so an app update never hides or reshuffles what the user arranged.
 */
export function normalizeLayout(stored: LayoutEntry[]): LayoutEntry[] {
  const known = new Set(DASHBOARD_SECTIONS.map((s) => s.id));
  const kept = stored.filter((e) => known.has(e.id));
  const seen = new Set(kept.map((e) => e.id));
  const appended = DASHBOARD_SECTIONS.filter((s) => !seen.has(s.id)).map((s) => ({
    id: s.id,
    visible: true,
  }));
  return [...kept, ...appended];
}

export function moveEntry(layout: LayoutEntry[], id: DashboardSectionId, delta: -1 | 1): LayoutEntry[] {
  const index = layout.findIndex((e) => e.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= layout.length) return layout;
  const next = [...layout];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function toggleEntry(layout: LayoutEntry[], id: DashboardSectionId): LayoutEntry[] {
  return layout.map((e) => (e.id === id ? { ...e, visible: !e.visible } : e));
}

export function sectionLabel(id: DashboardSectionId): string {
  return DASHBOARD_SECTIONS.find((s) => s.id === id)?.label ?? id;
}
