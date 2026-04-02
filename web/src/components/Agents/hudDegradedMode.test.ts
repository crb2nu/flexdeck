import { describe, expect, it } from 'vitest';

import {
  computeReconnectDelayMs,
  feedConnectionDetail,
  feedConnectionLabel,
  feedConnectionState,
  hasDegradedHUDFeed,
  HUD_FEED_RECONNECT_BASE_DELAY_MS,
  HUD_FEED_RECONNECT_MAX_DELAY_MS,
  HUD_PULL_STALE_THRESHOLD_MS,
  isWorkflowDataStale,
} from './hudDegradedMode';

describe('hudDegradedMode', () => {
  it('computes reconnect delay with exponential backoff and cap', () => {
    expect(computeReconnectDelayMs(0, 0)).toBe(HUD_FEED_RECONNECT_BASE_DELAY_MS);
    expect(computeReconnectDelayMs(1, 0)).toBe(HUD_FEED_RECONNECT_BASE_DELAY_MS * 2);
    expect(computeReconnectDelayMs(6, 0)).toBe(HUD_FEED_RECONNECT_MAX_DELAY_MS);
  });

  it('returns explicit feed labels for connection states', () => {
    expect(feedConnectionState('disabled')).toBe('disabled');
    expect(feedConnectionState('connecting')).toBe('connecting');
    expect(feedConnectionState('live')).toBe('ready');
    expect(feedConnectionState('stale')).toBe('fallback');

    expect(feedConnectionDetail('disabled')).toBe('push mode');
    expect(feedConnectionDetail('connecting')).toBe('waiting for events');
    expect(feedConnectionDetail('live')).toBe('live feed');
    expect(feedConnectionDetail('stale')).toBe('poll fallback');

    expect(feedConnectionLabel('disabled')).toBe('DISABLED · push mode');
    expect(feedConnectionLabel('connecting')).toBe('CONNECTING · waiting for events');
    expect(feedConnectionLabel('live')).toBe('READY · live feed');
    expect(feedConnectionLabel('stale')).toBe('FALLBACK · poll fallback');
  });

  it('marks workflow data stale only when pull mode is enabled and threshold exceeded', () => {
    const nowMs = 100_000;
    const freshPullMs = nowMs - HUD_PULL_STALE_THRESHOLD_MS + 1;
    const stalePullMs = nowMs - HUD_PULL_STALE_THRESHOLD_MS - 1;

    expect(isWorkflowDataStale(false, stalePullMs, nowMs)).toBe(false);
    expect(isWorkflowDataStale(true, 0, nowMs)).toBe(false);
    expect(isWorkflowDataStale(true, freshPullMs, nowMs)).toBe(false);
    expect(isWorkflowDataStale(true, stalePullMs, nowMs)).toBe(true);
  });

  it('only shows degraded warnings when pull mode is enabled', () => {
    const nowMs = 100_000;
    const stalePullMs = nowMs - HUD_PULL_STALE_THRESHOLD_MS - 1;

    expect(hasDegradedHUDFeed(false, 'disabled', stalePullMs, nowMs)).toBe(false);
    expect(hasDegradedHUDFeed(false, 'stale', stalePullMs, nowMs)).toBe(false);
    expect(hasDegradedHUDFeed(true, 'live', stalePullMs, nowMs)).toBe(true);
    expect(hasDegradedHUDFeed(true, 'stale', nowMs, nowMs)).toBe(true);
    expect(hasDegradedHUDFeed(true, 'live', nowMs, nowMs)).toBe(false);
  });
});
