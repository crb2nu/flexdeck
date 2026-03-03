export type DashboardDataState = "ready" | "partial" | "stale" | "offline";

export interface ResolveDashboardStateInput {
  loading?: boolean;
  error?: string | null;
  lastUpdateMs?: number;
  staleAfterMs: number;
  nowMs?: number;
}

const OFFLINE_ERROR_TOKENS = ["offline", "unavailable", "timeout", "refused"];

function isOfflineError(error: string): boolean {
  const normalized = error.trim().toLowerCase();
  if (!normalized) return false;
  return OFFLINE_ERROR_TOKENS.some((token) => normalized.includes(token));
}

export function resolveDashboardDataState(
  input: ResolveDashboardStateInput,
): DashboardDataState {
  const {
    loading = false,
    error = "",
    lastUpdateMs = 0,
    staleAfterMs,
    nowMs = Date.now(),
  } = input;

  if (loading) return "partial";

  const normalizedError = (error || "").trim();
  if (normalizedError) {
    return isOfflineError(normalizedError) ? "offline" : "partial";
  }

  if (!lastUpdateMs || nowMs - lastUpdateMs > staleAfterMs) return "stale";
  return "ready";
}

export function dataStateLabel(state: DashboardDataState, detail?: string): string {
  if (!detail) return state.toUpperCase();
  return `${state.toUpperCase()} · ${detail}`;
}
