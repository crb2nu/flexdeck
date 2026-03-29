export type FeedConnectionState = 'disabled' | 'connecting' | 'live' | 'stale';

export const HUD_FEED_RECONNECT_BASE_DELAY_MS = 2000;
export const HUD_FEED_RECONNECT_MAX_DELAY_MS = 30000;
export const HUD_PULL_STALE_THRESHOLD_MS = 45000;

export function computeReconnectDelayMs(reconnectAttempts: number, jitterMs = Math.random() * 1000): number {
  const exponentialDelay = HUD_FEED_RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts);
  return Math.min(exponentialDelay + jitterMs, HUD_FEED_RECONNECT_MAX_DELAY_MS);
}

export function feedConnectionLabel(state: FeedConnectionState): string {
  switch (state) {
    case 'disabled':
      return 'Push mode (no live feed)';
    case 'live':
      return 'Live';
    case 'stale':
      return 'Poll fallback (retry 2-30s)';
    default:
      return 'Connecting...';
  }
}

export function isWorkflowDataStale(
  pullEnabled: boolean,
  lastSuccessfulPullMs: number,
  nowMs: number,
  thresholdMs = HUD_PULL_STALE_THRESHOLD_MS
): boolean {
  return pullEnabled && lastSuccessfulPullMs > 0 && nowMs-lastSuccessfulPullMs > thresholdMs;
}

export function hasDegradedHUDFeed(
  pullEnabled: boolean,
  state: FeedConnectionState,
  lastSuccessfulPullMs: number,
  nowMs: number,
  thresholdMs = HUD_PULL_STALE_THRESHOLD_MS
): boolean {
  if (!pullEnabled) return false;
  return state === 'stale' || isWorkflowDataStale(true, lastSuccessfulPullMs, nowMs, thresholdMs);
}
