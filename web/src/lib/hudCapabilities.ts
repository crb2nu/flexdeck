export interface HudCapabilitySource {
  available?: boolean;
  enabled?: boolean;
  url?: string;
  directUrl?: string;
  passthroughEnabled?: boolean;
  directEntryEnabled?: boolean;
  reason?: string;
}

export interface HudEntryState {
  available: boolean;
  passthroughEnabled: boolean;
  directEntryEnabled: boolean;
  directUrl: string | null;
  disabledReason: string | null;
}

function normalizeHudUrl(source: HudCapabilitySource | null | undefined): string | null {
  const directUrl = (source?.directUrl ?? source?.url ?? "").trim();
  return directUrl === "" ? null : directUrl;
}

export function resolveHudEntryState(source: HudCapabilitySource | null | undefined): HudEntryState {
  const directUrl = normalizeHudUrl(source);
  const configured = directUrl !== null;
  const backendEnabled = source?.enabled ?? source?.available ?? false;
  const available = backendEnabled && configured;

  return {
    available,
    passthroughEnabled: available && (source?.passthroughEnabled ?? true),
    directEntryEnabled: available && (source?.directEntryEnabled ?? true),
    directUrl,
    disabledReason: available
      ? null
      : (source?.reason ??
        (!configured ? "Loom HUD URL is not configured" : "Loom HUD is disabled")),
  };
}
