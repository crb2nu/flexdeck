import type { FluxCondition } from "../../lib/api";

export type FluxSyncState = "in-sync" | "drifting" | "error" | "suspended";

interface FluxLikeStatus {
  ready: boolean;
  suspended?: boolean;
  conditions?: FluxCondition[];
}

const ERROR_REASON_PATTERN =
  /(fail|error|invalid|denied|forbidden|notfound|timeout|degraded|broken)/i;

function conditionOf(
  conditions: FluxCondition[] | undefined,
  type: string,
): FluxCondition | undefined {
  return conditions?.find((condition) => condition.type === type);
}

function isConditionTrue(
  conditions: FluxCondition[] | undefined,
  type: string,
): boolean {
  return conditionOf(conditions, type)?.status === "True";
}

function hasErrorSignal(conditions: FluxCondition[] | undefined): boolean {
  const ready = conditionOf(conditions, "Ready");
  if (!ready || ready.status !== "False") {
    return false;
  }

  const reason = ready.reason ?? "";
  const message = ready.message ?? "";
  return (
    ERROR_REASON_PATTERN.test(reason) || ERROR_REASON_PATTERN.test(message)
  );
}

export function computeFluxSyncState(resource: FluxLikeStatus): FluxSyncState {
  if (resource.suspended) {
    return "suspended";
  }

  const conditions = resource.conditions;
  if (isConditionTrue(conditions, "Stalled")) {
    return "error";
  }
  if (hasErrorSignal(conditions)) {
    return "error";
  }
  if (isConditionTrue(conditions, "Reconciling")) {
    return "drifting";
  }
  if (!resource.ready) {
    return "drifting";
  }

  return "in-sync";
}
