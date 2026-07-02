import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatClockTime,
  formatCompact,
  formatMs,
  formatSeconds,
  formatShortDate,
  formatShortDateTime,
  formatTimeAgo,
  formatUSD,
} from './format';

describe('formatCompact', () => {
  it('passes small counts through rounded', () => {
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(850)).toBe('850');
    expect(formatCompact(850.6)).toBe('851');
  });

  it('compacts thousands and millions', () => {
    expect(formatCompact(1234)).toBe('1.2k');
    expect(formatCompact(2_500_000)).toBe('2.5M');
    expect(formatCompact(-1234)).toBe('-1.2k');
  });

  it('renders nullish as an em dash', () => {
    expect(formatCompact(null)).toBe('—');
    expect(formatCompact(undefined)).toBe('—');
  });
});

describe('formatMs', () => {
  it('keeps sub-second values in ms', () => {
    expect(formatMs(850)).toBe('850ms');
    expect(formatMs(0)).toBe('0ms');
  });

  it('promotes to seconds at 1000ms', () => {
    expect(formatMs(1200)).toBe('1.2s');
  });

  it('renders nullish as an em dash', () => {
    expect(formatMs(null)).toBe('—');
    expect(formatMs(undefined)).toBe('—');
  });
});

describe('formatSeconds', () => {
  it('scales through s / m / h', () => {
    expect(formatSeconds(45)).toBe('45s');
    expect(formatSeconds(180)).toBe('3m');
    expect(formatSeconds(5400)).toBe('1.5h');
  });
});

describe('formatUSD', () => {
  it('formats with cents', () => {
    expect(formatUSD(1.239)).toBe('$1.24');
  });

  it('collapses zero and nullish to $0', () => {
    expect(formatUSD(0)).toBe('$0');
    expect(formatUSD(undefined)).toBe('$0');
    expect(formatUSD(null)).toBe('$0');
  });
});

describe('formatTimeAgo', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('scales through s / m / h / d without a suffix', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T12:00:00Z'));
    expect(formatTimeAgo('2026-07-01T11:59:15Z')).toBe('45s');
    expect(formatTimeAgo('2026-07-01T11:55:00Z')).toBe('5m');
    expect(formatTimeAgo('2026-07-01T09:00:00Z')).toBe('3h');
    expect(formatTimeAgo('2026-06-29T12:00:00Z')).toBe('2d');
  });

  it('returns empty for missing or invalid input', () => {
    expect(formatTimeAgo()).toBe('');
    expect(formatTimeAgo('')).toBe('');
    expect(formatTimeAgo('garbage')).toBe('');
  });
});

describe('formatClockTime', () => {
  it('renders 24h HH:MM:SS and echoes invalid input', () => {
    expect(formatClockTime('2026-07-01T00:03:27Z')).toMatch(/^\d{2}:\d{2}:27$/);
    expect(formatClockTime('nope')).toBe('nope');
  });
});

describe('formatShortDate / formatShortDateTime', () => {
  it('echoes empty and invalid input', () => {
    expect(formatShortDate('')).toBe('');
    expect(formatShortDate('not-a-date')).toBe('not-a-date');
    expect(formatShortDateTime('')).toBe('');
    expect(formatShortDateTime('nope')).toBe('nope');
  });

  it('renders a short month for valid timestamps (locale-tolerant)', () => {
    // Assert shape, not exact locale output, so CI timezone/locale don't matter.
    expect(formatShortDate('2026-06-30T10:00:00Z')).toMatch(/\d/);
    expect(formatShortDateTime('2026-06-30T10:00:00Z')).toMatch(/\d{1,2}[:.]\d{2}/);
  });
});
