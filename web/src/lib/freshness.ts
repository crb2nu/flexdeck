export type FreshnessState = 'live' | 'stale' | 'offline';

/**
 * Determine how fresh a piece of data is relative to its expected refresh interval.
 *
 * @param lastUpdatedMs Timestamp (ms since epoch) of the last successful fetch.
 * @param intervalMs    Expected polling interval in milliseconds.
 * @param multiplier    How many intervals before data is considered stale (default 2.5).
 */
export function resolveFreshness(
  lastUpdatedMs: number,
  intervalMs: number,
  multiplier = 2.5,
): FreshnessState {
  if (!lastUpdatedMs) return 'offline';
  const age = Date.now() - lastUpdatedMs;
  if (age > intervalMs * multiplier) return 'stale';
  return 'live';
}
