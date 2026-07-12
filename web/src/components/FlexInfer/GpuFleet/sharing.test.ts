import { describe, expect, it } from 'vitest';
import { buildSharingGroups, sharingStateTone } from './sharing';
import type { FlexInferModel } from '../../../lib/types';

function model(overrides: {
  name: string;
  namespace?: string;
  shared?: string;
  sharedGroup?: { groupName?: string; state?: string; queuePosition?: number; preemptedBy?: string };
}): FlexInferModel {
  return {
    name: overrides.name,
    namespace: overrides.namespace ?? 'ai',
    creationTimestamp: '2026-01-01T00:00:00Z',
    spec: {
      backend: 'vllm',
      source: 'hf://x',
      gpu: overrides.shared ? { shared: overrides.shared } : undefined,
    },
    status: overrides.sharedGroup ? { sharedGroup: overrides.sharedGroup } : {},
  } as FlexInferModel;
}

describe('buildSharingGroups', () => {
  it('excludes models without a shared group', () => {
    expect(buildSharingGroups([model({ name: 'solo' })])).toEqual([]);
  });

  it('groups members by (namespace, group) and reads live state', () => {
    const groups = buildSharingGroups([
      model({ name: 'qwen', sharedGroup: { groupName: 'gfx1100', state: 'Active' } }),
      model({ name: 'llama', sharedGroup: { groupName: 'gfx1100', state: 'Queued', queuePosition: 1 } }),
      model({ name: 'other-ns', namespace: 'ml', sharedGroup: { groupName: 'gfx1100', state: 'Active' } }),
    ]);

    expect(groups).toHaveLength(2);
    const ai = groups.find((g) => g.namespace === 'ai')!;
    expect(ai.group).toBe('gfx1100');
    expect(ai.members.map((m) => m.name)).toEqual(['qwen', 'llama']);
    expect(ai.members[1]).toMatchObject({ state: 'Queued', queuePosition: 1 });
  });

  it('falls back to spec.gpu.shared when status has no group yet', () => {
    const groups = buildSharingGroups([model({ name: 'pending', shared: 'pool-a' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBe('pool-a');
    expect(groups[0].members[0].state).toBe('Unknown');
  });

  it('orders members Active, Queued (by position), Preempted, Unknown', () => {
    const groups = buildSharingGroups([
      model({ name: 'u', sharedGroup: { groupName: 'g' } }),
      model({ name: 'p', sharedGroup: { groupName: 'g', state: 'Preempted', preemptedBy: 'a' } }),
      model({ name: 'q2', sharedGroup: { groupName: 'g', state: 'Queued', queuePosition: 2 } }),
      model({ name: 'q1', sharedGroup: { groupName: 'g', state: 'Queued', queuePosition: 1 } }),
      model({ name: 'a', sharedGroup: { groupName: 'g', state: 'Active' } }),
    ]);
    expect(groups[0].members.map((m) => m.name)).toEqual(['a', 'q1', 'q2', 'p', 'u']);
    expect(groups[0].members[3].preemptedBy).toBe('a');
  });

  it('normalizes unrecognized states to Unknown', () => {
    const groups = buildSharingGroups([
      model({ name: 'weird', sharedGroup: { groupName: 'g', state: 'Rebalancing' } }),
    ]);
    expect(groups[0].members[0].state).toBe('Unknown');
  });
});

describe('sharingStateTone', () => {
  it('maps states to badge tones', () => {
    expect(sharingStateTone('Active')).toBe('ok');
    expect(sharingStateTone('Queued')).toBe('warn');
    expect(sharingStateTone('Preempted')).toBe('default');
    expect(sharingStateTone('Unknown')).toBe('default');
  });
});
