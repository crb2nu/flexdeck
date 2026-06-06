// Severity scoring for the FlexInfer Triage Console.
//
// The whole Triage Console rests on one bet (RA-1): that a single severity
// score can rank "what needs an operator's attention right now" so the worst
// thing is always at the top, regardless of GPU pool / phase / sort. This
// module is that bet, kept PURE and exhaustively unit-tested so the ranking is
// verifiable in isolation before any UI is built on it.
//
// The scale is banded so the *reason* ordering is strict and deterministic:
//   CRITICAL  >= 5000   (Failed > stalled > idle-with-traffic > preempted >
//                        overloaded queue > high error rate)
//   DEGRADED  4000-4999 (degraded reliability > >=2% errors > queue building)
//   LOADING   3000-3999 (Loading > Pending)
//   STANDBY   1000-1999 (Idle / scaled-to-zero, or unproven reliability)
//   HEALTHY   0-999     (Ready + healthy + quiet)
// An intra-band urgency term (errors then queue) is capped < 100 so it can
// break ties WITHIN a reason but never cross a reason boundary.

import type { ModelPhase } from '../../lib/types/flexinfer';
import type { ReliabilityLevel } from '../Models/controllerIntegration';

export type SeverityTier = 'critical' | 'degraded' | 'loading' | 'standby' | 'healthy';

export interface SeverityInput {
  phase?: ModelPhase;
  reliability?: ReliabilityLevel;
  /** isStalledLoad(status): Loading+LoadingWeights with no progress past the threshold. */
  stalled?: boolean;
  /** Proxy queue depth for the model. */
  queueDepth?: number;
  /** Proxy error rate as a fraction (0..1). */
  errorRate?: number;
  /** Total requests seen — used to detect "idle but receiving traffic". */
  requests?: number;
  /** sharedGroup preemption (preemptedBy set, or state==Preempted). */
  preempted?: boolean;
}

// Error-rate thresholds (fraction) mirror proxy degradation semantics.
export const ERR_CRITICAL = 0.05;
export const ERR_DEGRADED = 0.02;
export const QUEUE_OVERLOADED = 100;
export const QUEUE_BUILDING = 10;

// Intra-band urgency: errors dominate, then queue. Capped < 100 so two models
// in the same reason band order sensibly without ever outranking a worse reason.
function intraBand(i: SeverityInput): number {
  const err = Math.max(0, Math.min(1, i.errorRate ?? 0));
  const q = Math.max(0, i.queueDepth ?? 0);
  return Math.min(99, err * 60 + Math.min(q, 200) * 0.2);
}

/** Higher = more urgent. See module header for the banding. */
export function severityScore(i: SeverityInput): number {
  const q = Math.max(0, i.queueDepth ?? 0);
  const err = Math.max(0, Math.min(1, i.errorRate ?? 0));
  const traffic = q > 0 || (i.requests ?? 0) > 0;
  const x = intraBand(i);

  // CRITICAL — ordered by reason (worst first).
  if (i.phase === 'Failed') return 5800 + x;
  if (i.stalled) return 5700 + x;
  if (i.phase === 'Idle' && traffic) return 5600 + x; // traffic arriving, nothing serving
  if (i.preempted || i.phase === 'Preempted') return 5500 + x;
  if (q >= QUEUE_OVERLOADED) return 5400 + x;
  if (err >= ERR_CRITICAL) return 5300 + x;

  // DEGRADED
  if (i.reliability === 'degraded') return 4300 + x;
  if (err >= ERR_DEGRADED) return 4200 + x;
  if (q >= QUEUE_BUILDING) return 4100 + x;

  // LOADING
  if (i.phase === 'Loading') return 3200 + x;
  if (i.phase === 'Pending') return 3100 + x;

  // STANDBY — idle/scaled-to-zero, or health not yet proven.
  if (i.phase === 'Idle') return 1200 + x;
  if (i.reliability === 'partial' || i.reliability === 'unknown') return 1100 + x;

  // HEALTHY — Ready + healthy + quiet.
  return x;
}

export function severityTier(score: number): SeverityTier {
  if (score >= 5000) return 'critical';
  if (score >= 4000) return 'degraded';
  if (score >= 3000) return 'loading';
  if (score >= 1000) return 'standby';
  return 'healthy';
}

// Coarse rank (0 = most urgent) for STABLE list ordering. Sort lists by this
// tier + a stable tiebreak (e.g. name) — never by the fine score — so live
// metric jitter (queue/error wobbling within a tier) does not reorder rows
// every poll. Rows move only when a model actually changes tier.
export const SEVERITY_TIER_RANK: Record<SeverityTier, number> = {
  critical: 0,
  degraded: 1,
  loading: 2,
  standby: 3,
  healthy: 4,
};

export function classifySeverity(i: SeverityInput): { score: number; tier: SeverityTier } {
  const score = severityScore(i);
  return { score, tier: severityTier(score) };
}
