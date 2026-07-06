import { createStore } from "solid-js/store";
import { getApiBasePath } from "../lib/api/base";

interface Feature {
  enabled: boolean;
  url?: string;
  directUrl?: string;
  passthroughEnabled?: boolean;
  directEntryEnabled?: boolean;
  readOnly?: boolean;
  mode?: string;
  reason?: string;
}

interface HealthState {
  ok: boolean;
  service: string;
  time: string;
  features: Record<string, Feature>;
  loading: boolean;
  error: string | null;
}

const [healthStore, setHealthStore] = createStore<HealthState>({
  ok: false,
  service: "",
  time: "",
  features: {},
  loading: true,
  error: null,
});

async function fetchHealth(): Promise<void> {
  setHealthStore("loading", true);
  setHealthStore("error", null);

  try {
    const healthUrl = `${getApiBasePath()}/health`;
    const response = await fetch(healthUrl);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    const data = await response.json();
    setHealthStore({
      ok: data.ok,
      service: data.service,
      time: data.time,
      features: data.features || {},
      loading: false,
      error: null,
    });
  } catch (err) {
    setHealthStore({
      ok: false,
      loading: false,
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
}

export { healthStore, fetchHealth };
