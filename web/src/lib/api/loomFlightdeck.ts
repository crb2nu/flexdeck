import { api } from './client';

// --- Backend JSON contract (slice 5) --------------------------------------
// Proxy to the loom-flightdeck board API (/api/v2/*), which wraps the Stall
// Board + Context Ledger query module (LoomFlightdeck.Board). flexdeck injects
// the bearer token server-side.

export interface FlightdeckSummary {
  wait_minutes_today: number;
  blocked_now_count: number;
}

export interface FlightdeckBlocked {
  stall_id: number;
  session_id: string;
  repo: string | null;
  reason: string;
  tool_short: string | null;
  opened_at: string;
  waiting_seconds: number;
}

export interface FlightdeckPareto {
  reason: string;
  tool_short: string | null;
  count: number;
  p50_ms: number | null;
  p95_ms: number | null;
}

export interface FlightdeckAbandoned {
  abandoned_sessions: { session_id: string; repo: string | null; last_event_at: string }[];
  interrupts: { session_id: string; repo: string | null; occurred_at: string; variant: string | null }[];
}

export interface FlightdeckLiveness {
  platform: string;
  last_event_at: string | null;
  stale: boolean;
}

export interface FlightdeckStalls {
  blocked_now: FlightdeckBlocked[];
  pareto: FlightdeckPareto[];
  abandoned_and_interrupted: FlightdeckAbandoned;
  platform_liveness: FlightdeckLiveness[];
  edge_drops: { drops_total: number };
}

export interface FlightdeckCatalogEntry {
  server: string;
  tool: string;
  description_tokens: number;
  calls: number;
  last_called_at: string | null;
  verdict: string;
  cost_per_use_est: number | null;
}

export interface FlightdeckRule {
  repo: string;
  path: string;
  token_estimate: number;
  sessions_in_repo: number;
  est_cost: number;
  evidence_hits: number;
  evidence: string;
}

export interface FlightdeckContextSummary {
  wasted_tokens_week: number;
  measured_baseline: { repo: string; cache_creation_tokens: number } | null;
}

export const loomFlightdeckApi = {
  summary: () => api<FlightdeckSummary>('/loom/flightdeck/board/summary'),
  stalls: () => api<FlightdeckStalls>('/loom/flightdeck/board/stalls'),
  contextSummary: () =>
    api<{ summary: FlightdeckContextSummary; fanout: unknown; trend: unknown[] }>('/loom/flightdeck/context/summary'),
  catalog: () => api<{ catalog: FlightdeckCatalogEntry[] }>('/loom/flightdeck/context/catalog'),
  rules: () => api<{ rules: FlightdeckRule[] }>('/loom/flightdeck/context/rules'),
};
