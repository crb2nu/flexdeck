import {
  operatorStateLabel,
  type OperatorState,
} from '../../lib/freshness';

export type FeedConnectionState = 'disabled' | 'connecting' | 'live' | 'stale';

export const HUD_FEED_RECONNECT_BASE_DELAY_MS = 2000;
export const HUD_FEED_RECONNECT_MAX_DELAY_MS = 30000;
export const HUD_PULL_STALE_THRESHOLD_MS = 45000;

export function computeReconnectDelayMs(reconnectAttempts: number, jitterMs = Math.random() * 1000): number {
  const exponentialDelay = HUD_FEED_RECONNECT_BASE_DELAY_MS * Math.pow(2, reconnectAttempts);
  return Math.min(exponentialDelay + jitterMs, HUD_FEED_RECONNECT_MAX_DELAY_MS);
}

export function feedConnectionState(state: FeedConnectionState): OperatorState {
  switch (state) {
    case 'disabled':
      return 'disabled';
    case 'live':
      return 'ready';
    case 'stale':
      return 'fallback';
    default:
      return 'connecting';
  }
}

export function feedConnectionDetail(state: FeedConnectionState): string {
  switch (state) {
    case 'disabled':
      return 'push mode';
    case 'live':
      return 'live feed';
    case 'stale':
      return 'poll fallback';
    default:
      return 'waiting for events';
  }
}

export function feedConnectionLabel(state: FeedConnectionState): string {
  return operatorStateLabel(feedConnectionState(state), feedConnectionDetail(state));
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
