import { describe, expect, it } from 'vitest';

import type { HUDClaim, HUDWorkflow } from '../../lib/types';
import {
  applyWorkflowCancel,
  countClaimConflicts,
  groupClaimsByAgent,
  normalizePresenceFromPush,
} from './hudUtils';

describe('hudUtils', () => {
  it('groups claims by agent id', () => {
    const claims: HUDClaim[] = [
      { agentId: 'alpha', filePath: 'a.ts' },
      { agentId: 'alpha', filePath: 'b.ts' },
      { agentId: 'beta', filePath: 'c.ts' },
    ];

    const grouped = groupClaimsByAgent(claims);
    expect(Object.keys(grouped).sort()).toEqual(['alpha', 'beta']);
    expect(grouped.alpha).toHaveLength(2);
    expect(grouped.beta).toHaveLength(1);
  });

  it('counts file conflicts when the same file is claimed by multiple agents', () => {
    const claims: HUDClaim[] = [
      { agentId: 'alpha', filePath: 'same.ts' },
      { agentId: 'beta', filePath: 'same.ts' },
      { agentId: 'gamma', filePath: 'other.ts' },
    ];

    expect(countClaimConflicts(claims)).toBe(1);
    expect(countClaimConflicts([])).toBe(0);
  });

  it('normalizes push agent snapshots to HUD presence rows', () => {
    const normalized = normalizePresenceFromPush([
      {
        id: 'codex-1',
        type: 'cli-agent',
        status: 'healthy',
        metadata: {
          source: 'hud',
          active_files: ['x.ts'],
          conflicts: ['y.ts'],
          last_heartbeat: '2026-02-17T15:00:00Z',
        },
      },
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].agentId).toBe('codex-1');
    expect(normalized[0].status).toBe('active');
    expect(normalized[0].activeFiles).toEqual(['x.ts']);
    expect(normalized[0].conflicts).toEqual(['y.ts']);
  });

  it('marks a workflow as canceled after cancel action', () => {
    const workflows: HUDWorkflow[] = [
      {
        id: 'wf-1',
        definitionId: 'build',
        status: 'running',
        currentStep: 1,
        startedAt: '2026-02-17T15:00:00Z',
        steps: [{ name: 'one', status: 'running', requiresApproval: false }],
      },
      {
        id: 'wf-2',
        definitionId: 'deploy',
        status: 'running',
        currentStep: 0,
        startedAt: '2026-02-17T15:01:00Z',
        steps: [{ name: 'one', status: 'running', requiresApproval: false }],
      },
    ];

    const updated = applyWorkflowCancel(workflows, 'wf-1');
    expect(updated.find((wf) => wf.id === 'wf-1')?.status).toBe('canceled');
    expect(updated.find((wf) => wf.id === 'wf-2')?.status).toBe('running');
  });
});
