import { describe, expect, it } from 'vitest';

import { buildInferenceHealthSummary } from './inferenceHealth';
import type { FlexInferProxyMetricsResponse } from '../../lib/types';

describe('buildInferenceHealthSummary', () => {
  it('uses totals when provided', () => {
    const input: FlexInferProxyMetricsResponse = {
      requests: {},
      latency: {},
      queue_depth: {},
      active_conn: {},
      scale_ups: {},
      byModel: {},
      requestsByStatus: {},
      partial: false,
      totals: {
        requestsTotal: 123,
        errorsTotal: 4,
        errorRate: 0.0325,
        queueDepth: 8,
        activeConnections: 2,
        scaleUps: 1,
        queueRejectedTotal: 0,
        queuedRequestsTotal: 0,
        modelCount: 3,
        parseErrors: 0,
      },
    };

    const summary = buildInferenceHealthSummary(input);
    expect(summary).toEqual({
      totalTps: 123,
      modelCount: 3,
      queueDepth: 8,
      error: '',
    });
  });

  it('falls back to byModel count when totals.modelCount is absent', () => {
    const input: FlexInferProxyMetricsResponse = {
      requests: {},
      latency: {},
      queue_depth: {},
      active_conn: {},
      scale_ups: {},
      requestsByStatus: {},
      partial: false,
      totals: {
        requestsTotal: 0,
        errorsTotal: 0,
        errorRate: 0,
        queueDepth: 0,
        activeConnections: 0,
        scaleUps: 0,
        queueRejectedTotal: 0,
        queuedRequestsTotal: 0,
        modelCount: 0,
        parseErrors: 0,
      },
      byModel: {
        alpha: {
          requestsTotal: 10,
          errorsTotal: 1,
          queueDepth: 1,
          activeConnections: 1,
          scaleUps: 0,
          queueRejectedTotal: 0,
          queuedRequestsTotal: 0,
        },
        beta: {
          requestsTotal: 12,
          errorsTotal: 0,
          queueDepth: 1,
          activeConnections: 1,
          scaleUps: 0,
          queueRejectedTotal: 0,
          queuedRequestsTotal: 0,
        },
        _total: {
          requestsTotal: 22,
          errorsTotal: 1,
          queueDepth: 2,
          activeConnections: 2,
          scaleUps: 0,
          queueRejectedTotal: 0,
          queuedRequestsTotal: 0,
        },
      },
    };

    const summary = buildInferenceHealthSummary(input);
    expect(summary.modelCount).toBe(2);
  });

  it('marks partial data as an error banner message', () => {
    const input: FlexInferProxyMetricsResponse = {
      requests: {},
      latency: {},
      queue_depth: {},
      active_conn: {},
      scale_ups: {},
      byModel: {},
      requestsByStatus: {},
      partial: true,
      totals: {
        requestsTotal: 0,
        errorsTotal: 0,
        errorRate: 0,
        queueDepth: 0,
        activeConnections: 0,
        scaleUps: 0,
        queueRejectedTotal: 0,
        queuedRequestsTotal: 0,
        modelCount: 0,
        parseErrors: 1,
      },
    };

    expect(buildInferenceHealthSummary(input).error).toBe('partial data');
  });
});
