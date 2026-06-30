import { api } from './client';

// --- Backend JSON contract (slice 1) --------------------------------------
// GET /api/loom/health -> LoomHealth
//
// Per-source availability for the unified Loom control plane. Sources:
// hud (fleet passthrough), plans (Qdrant), mills (loom-mills-operator),
// flightdeck (board JSON API — lands in slice 5).

export interface LoomSourceHealth {
  enabled: boolean;
  available: boolean;
  detail?: string;
}

export interface LoomHealth {
  sources: Record<string, LoomSourceHealth>;
  generatedAt: string;
}

export const loomApi = {
  health: () => api<LoomHealth>('/loom/health'),
};
