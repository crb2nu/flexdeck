import { describe, expect, it } from 'vitest';
import {
  buildFleet,
  formatUptime,
  isActiveGaming,
  isGpuNode,
  nodeModeLabel,
  nodeModeTone,
  parseUtilPercent,
  summarizeFleet,
} from './fleet';
import type { FlexInferModel, GamingSession, K8sNode } from '../../../lib/types';

function gpuNode(name: string, opts: Partial<{ vendor: string; arch: string; vram: string; util: string; free: string; ready: boolean }> = {}): K8sNode {
  return {
    metadata: {
      name,
      labels: {
        'flexinfer.ai/gpu-present': 'true',
        'flexinfer.ai/gpu.vendor': opts.vendor ?? 'AMD',
        'flexinfer.ai/gpu.arch': opts.arch ?? 'gfx1100',
        'flexinfer.ai/gpu.vram': opts.vram ?? '23Gi',
        'flexinfer.ai/gpu.count': '1',
      },
      annotations: {
        'flexinfer.ai/gpu.util': opts.util ?? '0.00',
        'flexinfer.ai/gpu-free-memory': opts.free ?? '24534',
      },
    },
    status: {
      conditions: [{ type: 'Ready', status: opts.ready === false ? 'False' : 'True' }],
    },
  } as K8sNode;
}

function model(name: string, node: string, phase: string): FlexInferModel {
  return {
    name,
    namespace: 'flexinfer-system',
    spec: {} as FlexInferModel['spec'],
    status: { phase, gpu: { node, vendor: 'AMD' } },
  } as FlexInferModel;
}

function gamingSession(node: string, phase: string): GamingSession {
  return {
    name: `gaming-${node}`,
    namespace: 'flexinfer-system',
    creationTimestamp: '2026-07-01T13:18:15Z',
    spec: { mode: 'gaming', nodeName: node },
    status: { phase, observedMode: phase === 'Active' ? 'gaming' : '', activatedAt: '2026-07-01T13:18:44Z' },
  };
}

describe('parseUtilPercent', () => {
  it('scales a 0..1 fraction to a percent', () => {
    expect(parseUtilPercent('0.42')).toBeCloseTo(42);
  });
  it('passes through a 0..100 percent', () => {
    expect(parseUtilPercent('87')).toBe(87);
  });
  it('caps at 100 and rejects junk', () => {
    expect(parseUtilPercent('250')).toBe(100);
    expect(parseUtilPercent('')).toBeNull();
    expect(parseUtilPercent('nope')).toBeNull();
    expect(parseUtilPercent(undefined)).toBeNull();
  });
});

describe('isActiveGaming', () => {
  it('is true for Active phase', () => {
    expect(isActiveGaming(gamingSession('n', 'Active'))).toBe(true);
  });
  it('is false for Pending phase', () => {
    expect(isActiveGaming(gamingSession('n', 'Pending'))).toBe(false);
  });
});

describe('isGpuNode', () => {
  it('detects flexinfer GPU labels', () => {
    expect(isGpuNode(gpuNode('n'))).toBe(true);
  });
  it('rejects a plain node', () => {
    expect(isGpuNode({ metadata: { name: 'plain', labels: {} }, status: { conditions: [] } } as K8sNode)).toBe(false);
  });
});

describe('buildFleet', () => {
  it('classifies a gaming node from an Active session', () => {
    const fleet = buildFleet(
      [gpuNode('cblevins-7900xtx')],
      [],
      [gamingSession('cblevins-7900xtx', 'Active')],
    );
    expect(fleet).toHaveLength(1);
    expect(fleet[0].mode).toBe('gaming');
    expect(fleet[0].vendor).toBe('AMD');
    expect(fleet[0].session?.status.phase).toBe('Active');
  });

  it('classifies serving / standby / idle by model readiness', () => {
    const fleet = buildFleet(
      [gpuNode('serving-node'), gpuNode('standby-node'), gpuNode('idle-node')],
      [model('m1', 'serving-node', 'Ready'), model('m2', 'standby-node', 'Idle')],
      [],
    );
    const byName = Object.fromEntries(fleet.map((n) => [n.name, n.mode]));
    expect(byName['serving-node']).toBe('serving');
    expect(byName['standby-node']).toBe('standby');
    expect(byName['idle-node']).toBe('idle');
  });

  it('orders gaming first, then serving, then the rest', () => {
    const fleet = buildFleet(
      [gpuNode('idle-node'), gpuNode('serving-node'), gpuNode('gaming-node')],
      [model('m1', 'serving-node', 'Ready')],
      [gamingSession('gaming-node', 'Active')],
    );
    expect(fleet.map((n) => n.mode)).toEqual(['gaming', 'serving', 'idle']);
  });

  it('surfaces a node referenced only by a model even without labels, using model vendor', () => {
    const fleet = buildFleet([], [model('m1', 'ghost-node', 'Ready')], []);
    expect(fleet).toHaveLength(1);
    expect(fleet[0].name).toBe('ghost-node');
    expect(fleet[0].mode).toBe('serving');
    expect(fleet[0].vendor).toBe('AMD');
  });

  it('marks a not-yet-Active session as switching', () => {
    const fleet = buildFleet([gpuNode('n')], [], [gamingSession('n', 'Pending')]);
    expect(fleet[0].mode).toBe('switching');
  });
});

describe('summarizeFleet', () => {
  it('counts modes', () => {
    const fleet = buildFleet(
      [gpuNode('a'), gpuNode('b'), gpuNode('c')],
      [model('m1', 'a', 'Ready')],
      [gamingSession('b', 'Active')],
    );
    const s = summarizeFleet(fleet);
    expect(s.total).toBe(3);
    expect(s.gaming).toBe(1);
    expect(s.serving).toBe(1);
    expect(s.idle).toBe(1);
  });
});

describe('formatUptime', () => {
  const base = new Date('2026-07-01T13:18:44Z').getTime();
  it('formats seconds, minutes, hours', () => {
    expect(formatUptime('2026-07-01T13:18:44Z', base + 30_000)).toBe('30s');
    expect(formatUptime('2026-07-01T13:18:44Z', base + 5 * 60_000)).toBe('5m');
    expect(formatUptime('2026-07-01T13:18:44Z', base + (2 * 3600 + 14 * 60) * 1000)).toBe('2h 14m');
  });
  it('returns empty for missing/invalid input', () => {
    expect(formatUptime(undefined, base)).toBe('');
    expect(formatUptime('not-a-date', base)).toBe('');
  });
});

describe('mode presentation', () => {
  it('maps tone + label', () => {
    expect(nodeModeTone('gaming')).toBe('info');
    expect(nodeModeTone('serving')).toBe('ok');
    expect(nodeModeTone('standby')).toBe('warn');
    expect(nodeModeTone('idle')).toBe('default');
    expect(nodeModeLabel('gaming')).toBe('Gaming');
    expect(nodeModeLabel('switching')).toBe('Switching');
  });
});
