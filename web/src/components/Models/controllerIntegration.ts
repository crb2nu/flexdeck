import type { InferenceMetrics, LoRAAdapter } from '../../lib/types';

export type ReliabilityLevel = 'healthy' | 'degraded' | 'partial' | 'unknown';

export interface ReliabilityStatus {
  level: ReliabilityLevel;
  label: string;
}

export interface LoRASummary {
  total: number;
  loaded: number;
  pending: number;
  unloading: number;
}

export interface IntegrationFetchState {
  inferenceAvailable: boolean;
  loraAvailable: boolean;
}

export interface IntegrationCoverageSummary {
  inferenceUnavailable: number;
  loraUnavailable: number;
}

export function getReliabilityStatus(metrics: InferenceMetrics | null | undefined): ReliabilityStatus {
  if (!metrics) return { level: 'unknown', label: 'Unknown' };
  if (metrics.partial) return { level: 'partial', label: 'Partial' };

  const errorRate = metrics.errorRate ?? 0;
  const queueWaitP95Ms = metrics.queueWaitP95Ms ?? 0;
  const rejectedRequestsPerSec = metrics.rejectedRequestsPerSec ?? 0;
  const activationRetries5m = metrics.activationRetries5m ?? 0;

  if (
    errorRate >= 0.02 ||
    queueWaitP95Ms >= 2000 ||
    rejectedRequestsPerSec >= 0.05 ||
    activationRetries5m >= 1
  ) {
    return { level: 'degraded', label: 'Degraded' };
  }

  return { level: 'healthy', label: 'Healthy' };
}

export function getReliabilityClasses(level: ReliabilityLevel): string {
  switch (level) {
    case 'healthy':
      return 'bg-status-ok/20 text-status-ok';
    case 'degraded':
      return 'bg-status-error/20 text-status-error';
    case 'partial':
      return 'bg-status-warn/20 text-status-warn';
    default:
      return 'bg-white/10 text-text-dim';
  }
}

export function summarizeLoRA(adapters: LoRAAdapter[] | null | undefined): LoRASummary {
  const items = adapters || [];
  const summary: LoRASummary = {
    total: items.length,
    loaded: 0,
    pending: 0,
    unloading: 0,
  };

  for (const adapter of items) {
    if (adapter.state === 'Loaded') summary.loaded += 1;
    else if (adapter.state === 'Pending') summary.pending += 1;
    else if (adapter.state === 'Unloading') summary.unloading += 1;
  }

  return summary;
}

export function summarizeIntegrationCoverage(
  states: IntegrationFetchState[] | null | undefined
): IntegrationCoverageSummary {
  const items = states || [];
  let inferenceUnavailable = 0;
  let loraUnavailable = 0;

  for (const state of items) {
    if (!state.inferenceAvailable) inferenceUnavailable += 1;
    if (!state.loraAvailable) loraUnavailable += 1;
  }

  return { inferenceUnavailable, loraUnavailable };
}
