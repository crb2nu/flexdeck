import { describe, expect, it, vi } from 'vitest';

import {
  operatorStateBadgeClass,
  operatorStateLabel,
  resolveFreshness,
  resolveOperatorState,
} from './freshness';

describe('resolveFreshness', () => {
  it('returns offline when there is no successful update yet', () => {
    expect(resolveFreshness(0, 15_000)).toBe('offline');
  });

  it('returns ready while data is still fresh', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(120_000);
    expect(resolveFreshness(110_000, 15_000)).toBe('ready');
    nowSpy.mockRestore();
  });

  it('returns stale when the refresh window is exceeded', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(120_000);
    expect(resolveFreshness(70_000, 15_000)).toBe('stale');
    nowSpy.mockRestore();
  });
});

describe('resolveOperatorState', () => {
  it('uses connecting for an initial load when there is no cached data', () => {
    expect(
      resolveOperatorState({
        loading: true,
        lastUpdateMs: 0,
        staleAfterMs: 30_000,
      }),
    ).toBe('connecting');
  });

  it('uses partial while refreshing cached data', () => {
    expect(
      resolveOperatorState({
        loading: true,
        lastUpdateMs: 110_000,
        nowMs: 120_000,
        staleAfterMs: 30_000,
      }),
    ).toBe('partial');
  });

  it('marks explicit partial and disabled states distinctly', () => {
    expect(
      resolveOperatorState({
        lastUpdateMs: 110_000,
        nowMs: 120_000,
        staleAfterMs: 30_000,
        partial: true,
      }),
    ).toBe('partial');

    expect(
      resolveOperatorState({
        staleAfterMs: 30_000,
        disabled: true,
      }),
    ).toBe('offline');
  });
});

describe('operatorState helpers', () => {
  it('formats uppercase labels with optional detail', () => {
    expect(operatorStateLabel('ready')).toBe('READY');
    expect(operatorStateLabel('partial', 'push mode')).toBe('PARTIAL · push mode');
  });

  it('returns shared badge classes', () => {
    expect(operatorStateBadgeClass('ready')).toContain('text-status-ok');
    expect(operatorStateBadgeClass('stale')).toContain('text-status-warn');
  });
});
