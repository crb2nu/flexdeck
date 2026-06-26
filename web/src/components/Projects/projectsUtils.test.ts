import { describe, expect, it } from 'vitest';

import { killTestSummary } from './projectsUtils';

// Regression: kill_test_status is free-form prose in the live Plan store, not a
// short enum. The earlier badge rendered the whole string; killTestSummary must
// collapse it to a one-word verdict + tone (full text stays a tooltip).
describe('killTestSummary', () => {
  it('returns an empty label for no status (badge hidden)', () => {
    expect(killTestSummary('')).toEqual({ label: '', tone: 'default' });
    expect(killTestSummary('   ')).toEqual({ label: '', tone: 'default' });
  });

  it('reads a leading "passed" verdict with trailing detail', () => {
    const real = 'passed 2026-06-21 (live proxy + cross-process integration test)';
    expect(killTestSummary(real)).toEqual({ label: 'passed', tone: 'ok' });
  });

  it('reads an "ALL PASS" summary buried in prose', () => {
    const real =
      'legs 0+a+b+c ALL PASS (c proven 2026-06-25 from operator-spawned Mills ' +
      'codex pod). Follow-ups: version-pin SPAWN_LOOM_IMAGE; fix operator ' +
      '30m poll-timeout treated as permanent-pending.';
    expect(killTestSummary(real)).toEqual({ label: 'passed', tone: 'ok' });
  });

  it('flags a failed verdict', () => {
    expect(killTestSummary('FAILED 2026-06-20 (see evidence)')).toEqual({
      label: 'failed',
      tone: 'error',
    });
  });

  it('flags mixed when both pass and fail appear', () => {
    expect(killTestSummary('leg a passed, leg b failed')).toEqual({
      label: 'mixed',
      tone: 'warn',
    });
  });

  it('recognizes not-run / pending', () => {
    expect(killTestSummary('not run')).toEqual({ label: 'not run', tone: 'default' });
    expect(killTestSummary('pending kill-test')).toEqual({ label: 'not run', tone: 'default' });
  });

  it('falls back to "recorded" for prose with no verdict', () => {
    expect(killTestSummary('see the design doc for details')).toEqual({
      label: 'recorded',
      tone: 'default',
    });
  });
});
