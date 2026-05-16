import { describe, expect, it } from 'vitest';

import {
  activeConnectionsForModel,
  errorRateForModel,
  findProxyMetricModel,
  hasProxyMetricsForModel,
  listInferenceModels,
  proxyMetricsForModel,
  queueDepthForModel,
  requestsForModel,
} from './inferenceMetrics';
import type { FlexInferProxyMetricsResponse } from '../../lib/types';

const base: FlexInferProxyMetricsResponse = {
  requests: { alpha: 10, legacyOnly: 2, _total: 12 },
  latency: {},
  queue_depth: { alpha: 1, legacyOnly: 3, _total: 4 },
  active_conn: { alpha: 2, legacyOnly: 1, _total: 3 },
  scale_ups: {},
  byModel: {
    alpha: {
      requestsTotal: 20,
      errorsTotal: 2,
      queueDepth: 5,
      activeConnections: 4,
      scaleUps: 0,
      queueRejectedTotal: 0,
      queuedRequestsTotal: 0,
    },
    beta: {
      requestsTotal: 7,
      errorsTotal: 1,
      queueDepth: 0,
      activeConnections: 1,
      scaleUps: 0,
      queueRejectedTotal: 0,
      queuedRequestsTotal: 0,
    },
    _total: {
      requestsTotal: 27,
      errorsTotal: 3,
      queueDepth: 5,
      activeConnections: 5,
      scaleUps: 0,
      queueRejectedTotal: 0,
      queuedRequestsTotal: 0,
    },
  },
  totals: {
    modelCount: 2,
    requestsTotal: 27,
    errorsTotal: 3,
    queueDepth: 5,
    activeConnections: 5,
    scaleUps: 0,
    queueRejectedTotal: 0,
    queuedRequestsTotal: 0,
    errorRate: 0.111,
    parseErrors: 0,
  },
  requestsByStatus: {
    alpha: { '200': 18, '500': 2 },
  },
  partial: false,
};

describe('inferenceMetrics', () => {
  it('returns merged model list from normalized and legacy sections', () => {
    expect(listInferenceModels(base)).toEqual(['alpha', 'beta', 'legacyOnly']);
  });

  it('prefers normalized values for request/queue/connection counters', () => {
    expect(requestsForModel(base, 'alpha')).toBe(20);
    expect(queueDepthForModel(base, 'alpha')).toBe(5);
    expect(activeConnectionsForModel(base, 'alpha')).toBe(4);
  });

  it('falls back to legacy sections when normalized bucket is missing', () => {
    expect(requestsForModel(base, 'legacyOnly')).toBe(2);
    expect(queueDepthForModel(base, 'legacyOnly')).toBe(3);
    expect(activeConnectionsForModel(base, 'legacyOnly')).toBe(1);
  });

  it('distinguishes missing proxy series from observed zero values', () => {
    expect(hasProxyMetricsForModel(base, 'alpha')).toBe(true);
    expect(hasProxyMetricsForModel(base, 'legacyOnly')).toBe(true);
    expect(hasProxyMetricsForModel(base, 'missing')).toBe(false);
  });

  it('resolves the first available proxy metric name from CRD aliases', () => {
    expect(findProxyMetricModel(base, ['missing', 'beta', 'alpha'])).toBe('beta');
    expect(findProxyMetricModel(base, ['missing'])).toBeUndefined();
    expect(proxyMetricsForModel(base, 'beta')?.requestsTotal).toBe(7);
  });

  it('derives error rate from status map first, then normalized totals', () => {
    expect(errorRateForModel(base, 'alpha')).toBeCloseTo(0.1, 6);
    expect(errorRateForModel(base, 'beta')).toBeCloseTo(1 / 7, 6);
    expect(errorRateForModel(base, 'missing')).toBe(0);
  });
});
