import { describe, expect, it } from 'vitest';
import {
  classifySeverity,
  severityScore,
  severityTier,
  type SeverityInput,
} from './severity';

// RA-1 kill-test: the severity ranking must put the worst thing first,
// unconditionally. These fixtures cover every reason band; the test asserts
// the EXACT descending rank order and tier classification.

const FIXTURES: Array<{ name: string; tier: string; input: SeverityInput }> = [
  { name: 'failed', tier: 'critical', input: { phase: 'Failed' } },
  { name: 'stalled-load', tier: 'critical', input: { phase: 'Loading', stalled: true } },
  { name: 'idle-with-traffic', tier: 'critical', input: { phase: 'Idle', queueDepth: 3 } },
  { name: 'preempted', tier: 'critical', input: { phase: 'Preempted' } },
  { name: 'overloaded-queue', tier: 'critical', input: { phase: 'Ready', queueDepth: 140 } },
  { name: 'high-error', tier: 'critical', input: { phase: 'Ready', errorRate: 0.08 } },
  { name: 'degraded-reliability', tier: 'degraded', input: { phase: 'Ready', reliability: 'degraded' } },
  { name: 'mid-error', tier: 'degraded', input: { phase: 'Ready', errorRate: 0.03 } },
  { name: 'queue-building', tier: 'degraded', input: { phase: 'Ready', queueDepth: 25 } },
  { name: 'loading', tier: 'loading', input: { phase: 'Loading' } },
  { name: 'pending', tier: 'loading', input: { phase: 'Pending' } },
  { name: 'idle-standby', tier: 'standby', input: { phase: 'Idle' } },
  { name: 'unproven-health', tier: 'standby', input: { phase: 'Ready', reliability: 'unknown' } },
  { name: 'healthy', tier: 'healthy', input: { phase: 'Ready', reliability: 'healthy' } },
];

describe('severityScore — reason ordering (RA-1 kill-test)', () => {
  it('ranks the fixtures in the exact expected descending order', () => {
    const scored = FIXTURES.map((f) => ({ ...f, score: severityScore(f.input) }));
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    expect(sorted.map((s) => s.name)).toEqual(FIXTURES.map((f) => f.name));
  });

  it('classifies every fixture into its expected tier', () => {
    for (const f of FIXTURES) {
      expect(severityTier(severityScore(f.input)), f.name).toBe(f.tier);
    }
  });

  it('scores a healthy, quiet, Ready model at ~0 (recedes to the bottom)', () => {
    expect(severityScore({ phase: 'Ready', reliability: 'healthy', queueDepth: 0, errorRate: 0 })).toBe(0);
  });
});

describe('severityScore — intra-band urgency never crosses a reason boundary', () => {
  it('a near-max queue within the building band stays below the next reason up', () => {
    // queue-building (band 4100, queue 10..99) must stay < mid-error (4200),
    // even at queueDepth 99 (100+ would promote to the overloaded critical band).
    const queueBuilding = severityScore({ phase: 'Ready', queueDepth: 99 });
    const midError = severityScore({ phase: 'Ready', errorRate: 0.03 });
    expect(queueBuilding).toBeGreaterThanOrEqual(4100);
    expect(queueBuilding).toBeLessThan(4200);
    expect(queueBuilding).toBeLessThan(midError);
  });

  it('a busy-but-healthy model still outranks a quiet one within HEALTHY', () => {
    const busy = severityScore({ phase: 'Ready', reliability: 'healthy', queueDepth: 5 });
    const quiet = severityScore({ phase: 'Ready', reliability: 'healthy', queueDepth: 0 });
    expect(busy).toBeGreaterThan(quiet);
    expect(severityTier(busy)).toBe('healthy');
  });
});

describe('severityScore — edge cases', () => {
  it('treats missing/empty input as healthy (score 0)', () => {
    expect(severityScore({})).toBe(0);
    expect(severityTier(severityScore({}))).toBe('healthy');
  });

  it('Failed outranks everything regardless of metrics', () => {
    const failedQuiet = severityScore({ phase: 'Failed' });
    const everythingElse = FIXTURES.filter((f) => f.name !== 'failed').map((f) => severityScore(f.input));
    expect(Math.min(failedQuiet, ...everythingElse)).toBe(Math.min(...everythingElse));
    expect(failedQuiet).toBeGreaterThan(Math.max(...everythingElse));
  });

  it('preempted via sharedGroup flag matches phase=Preempted band', () => {
    const flag = severityTier(severityScore({ phase: 'Ready', preempted: true }));
    expect(flag).toBe('critical');
  });

  it('classifySeverity returns matching score and tier', () => {
    const c = classifySeverity({ phase: 'Failed', errorRate: 0.1 });
    expect(c.tier).toBe('critical');
    expect(c.score).toBe(severityScore({ phase: 'Failed', errorRate: 0.1 }));
  });
});
