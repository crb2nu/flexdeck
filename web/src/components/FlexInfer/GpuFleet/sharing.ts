import type { FlexInferModel } from '../../../lib/types';

// GPU sharing groups: models that time-share a GPU via the operator's
// shared-group scheduler. A model advertises its group through
// status.sharedGroup.groupName (live) or spec.gpu.shared (desired).
export type SharingState = 'Active' | 'Queued' | 'Preempted' | 'Unknown';

export interface SharingMember {
  name: string;
  namespace: string;
  state: SharingState;
  queuePosition: number | null;
  preemptedBy: string;
}

export interface SharingGroup {
  group: string;
  namespace: string;
  members: SharingMember[];
}

function normalizeState(raw: string | undefined): SharingState {
  switch ((raw || '').toLowerCase()) {
    case 'active':
      return 'Active';
    case 'queued':
      return 'Queued';
    case 'preempted':
      return 'Preempted';
    default:
      return 'Unknown';
  }
}

const STATE_RANK: Record<SharingState, number> = { Active: 0, Queued: 1, Preempted: 2, Unknown: 3 };

/**
 * Derive the GPU sharing groups from the live model list. Groups are keyed by
 * (namespace, group); members are ordered Active → Queued (by queue position)
 * → Preempted → Unknown. Models without a group are excluded.
 */
export function buildSharingGroups(models: FlexInferModel[]): SharingGroup[] {
  const byKey = new Map<string, SharingGroup>();

  for (const model of models) {
    const group = model.status?.sharedGroup?.groupName || model.spec?.gpu?.shared;
    if (!group) continue;

    const key = `${model.namespace}/${group}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { group, namespace: model.namespace, members: [] };
      byKey.set(key, entry);
    }

    const sg = model.status?.sharedGroup;
    entry.members.push({
      name: model.name,
      namespace: model.namespace,
      state: normalizeState(sg?.state),
      queuePosition: sg?.queuePosition ?? null,
      preemptedBy: sg?.preemptedBy || '',
    });
  }

  const groups = [...byKey.values()];
  for (const g of groups) {
    g.members.sort((a, b) => {
      if (a.state !== b.state) return STATE_RANK[a.state] - STATE_RANK[b.state];
      const qa = a.queuePosition ?? Number.MAX_SAFE_INTEGER;
      const qb = b.queuePosition ?? Number.MAX_SAFE_INTEGER;
      if (qa !== qb) return qa - qb;
      return a.name.localeCompare(b.name);
    });
  }
  groups.sort((a, b) => a.group.localeCompare(b.group) || a.namespace.localeCompare(b.namespace));
  return groups;
}

export function sharingStateTone(state: SharingState): 'ok' | 'warn' | 'default' {
  switch (state) {
    case 'Active':
      return 'ok';
    case 'Queued':
      return 'warn';
    default:
      return 'default';
  }
}
