import { createSignal } from "solid-js";
import { authenticatedFetch } from "../stores/auth";

interface ApiError {
  error: string;
  message?: string;
}

// Multi-cluster: active cluster ID persisted in localStorage
export const [activeClusterId, setActiveClusterId] = createSignal(
  typeof localStorage !== "undefined"
    ? localStorage.getItem("flexdeck_cluster") || ""
    : "",
);

export function switchCluster(id: string): void {
  if (id) {
    localStorage.setItem("flexdeck_cluster", id);
  } else {
    localStorage.removeItem("flexdeck_cluster");
  }
  setActiveClusterId(id);
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function api<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  // Use /flexdeck/api when hosted at the subpath on www.flexinfer.ai
  const isPublicView =
    typeof window !== "undefined" &&
    window.location.hostname === "www.flexinfer.ai";
  const apiBase = isPublicView ? "/flexdeck/api" : "/api";

  const headers = new Headers(options.headers);

  // Attach multi-cluster header if a cluster is selected
  const clusterId = activeClusterId();
  if (clusterId) {
    headers.set("X-Cluster-ID", clusterId);
  }

  // Default JSON content-type when sending structured body payloads.
  if (
    !headers.has("Content-Type") &&
    options.body != null &&
    !(typeof FormData !== "undefined" && options.body instanceof FormData)
  ) {
    headers.set("Content-Type", "application/json");
  }

  const response = await authenticatedFetch(`${apiBase}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    const contentType = response.headers.get("content-type") || "";
    try {
      if (contentType.includes("application/json")) {
        const data: ApiError = await response.json();
        message = data.error || data.message || message;
      } else {
        const text = await response.text();
        if (text.trim() !== "") {
          message = text;
        }
      }
    } catch {
      // Keep default status message when response cannot be parsed.
    }
    throw new ApiRequestError(response.status, message);
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  if (text.trim() === "") {
    return undefined as T;
  }

  return text as T;
}

export const k8s = {
  getServices: (ns?: string) =>
    api<any>(`/k8s/services${ns ? `?ns=${ns}` : ""}`),
  getNodes: () => api<any>("/k8s/nodes"),
  getDeployments: (ns?: string) =>
    api<any>(`/k8s/deployments${ns ? `?ns=${ns}` : ""}`),
  getPods: (ns?: string) => api<any>(`/k8s/pods${ns ? `?ns=${ns}` : ""}`),
  getIngresses: (ns?: string) =>
    api<any>(`/k8s/ingresses${ns ? `?ns=${ns}` : ""}`),
  scaleDeployment: (ns: string, name: string, replicas: number) =>
    api<any>(`/k8s/deployments/${ns}/${name}/scale?replicas=${replicas}`, {
      method: "POST",
    }),
  restartDeployment: (ns: string, name: string) =>
    api<any>(`/k8s/deployments/${ns}/${name}/restart`, { method: "POST" }),
  // SSE endpoint URL (use EventSource directly)
  watchSSEUrl: (ns?: string) => {
    const isPublicView =
      typeof window !== "undefined" &&
      window.location.hostname === "www.flexinfer.ai";
    const apiBase = isPublicView ? "/flexdeck/api" : "/api";
    return `${apiBase}/k8s/watch-sse${ns ? `?ns=${ns}` : ""}`;
  },
  getEvents: (ns?: string, limit = 20) =>
    api<any>(`/k8s/events${ns ? `?ns=${ns}` : ""}`).then((data: any) => {
      const items = data?.items || [];
      return items
        .sort(
          (a: any, b: any) =>
            new Date(
              b.lastTimestamp || b.metadata?.creationTimestamp || 0,
            ).getTime() -
            new Date(
              a.lastTimestamp || a.metadata?.creationTimestamp || 0,
            ).getTime(),
        )
        .slice(0, limit);
    }),
  getPVCs: (ns?: string) => api<any>(`/k8s/pvcs${ns ? `?ns=${ns}` : ""}`),
  getPVs: () => api<any>("/k8s/pvs"),
  getStorageClasses: () => api<any>("/k8s/storageclasses"),
  getConfigMaps: (ns?: string) => api<any>(`/k8s/configmaps${ns ? `?ns=${ns}` : ""}`),
  getConfigMap: (ns: string, name: string) => api<any>(`/k8s/configmaps/${ns}/${name}`),
  getSecrets: (ns?: string) => api<any>(`/k8s/secrets${ns ? `?ns=${ns}` : ""}`),
  getSecret: (ns: string, name: string) => api<any>(`/k8s/secrets/${ns}/${name}`),
};

export const prom = {
  health: () => api<any>("/prom/health"),
  query: (query: string, time?: string) =>
    api<any>(
      `/prom/query?query=${encodeURIComponent(query)}${
        time ? `&time=${time}` : ""
      }`,
    ),
  queryRange: (query: string, start: string, end: string, step: string) =>
    api<any>(
      `/prom/query_range?query=${encodeURIComponent(
        query,
      )}&start=${start}&end=${end}&step=${step}`,
    ),
  alerts: () => api<any>("/prom/alerts"),
  rules: (type?: string) =>
    api<any>(`/prom/rules${type ? `?type=${encodeURIComponent(type)}` : ""}`),
};

export const loki = {
  labels: () => api<any>("/loki/labels"),
  labelValues: (name: string) => api<any>(`/loki/label/${name}/values`),
  query: (query: string, limit?: number) =>
    api<any>(
      `/loki/query?query=${encodeURIComponent(query)}${
        limit ? `&limit=${limit}` : ""
      }`,
    ),
  queryRange: (query: string, start: string, end: string, limit?: number) =>
    api<any>(
      `/loki/query_range?query=${encodeURIComponent(
        query,
      )}&start=${start}&end=${end}${limit ? `&limit=${limit}` : ""}`,
    ),
};

export const litellm = {
  health: () => api<any>("/litellm/health"),
  metrics: () => api<any>("/litellm/metrics"),
  modelMetrics: (model: string) =>
    api<any>(`/litellm/metrics/${encodeURIComponent(model)}`),
  models: () => api<any>("/litellm/models"),
  router: () => api<any>("/litellm/router"),
};

export const langfuse = {
  health: () => api<any>("/langfuse/health"),
  metrics: (params?: {
    traceName?: string;
    fromTimestamp?: string;
    toTimestamp?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.traceName) qs.set("traceName", params.traceName);
    if (params?.fromTimestamp) qs.set("fromTimestamp", params.fromTimestamp);
    if (params?.toTimestamp) qs.set("toTimestamp", params.toTimestamp);
    const q = qs.toString();
    return api<any>(`/langfuse/metrics${q ? `?${q}` : ""}`);
  },
  traces: (params?: {
    limit?: number;
    name?: string;
    userId?: string;
    fromTimestamp?: string;
    toTimestamp?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.name) qs.set("name", params.name);
    if (params?.userId) qs.set("userId", params.userId);
    if (params?.fromTimestamp) qs.set("fromTimestamp", params.fromTimestamp);
    if (params?.toTimestamp) qs.set("toTimestamp", params.toTimestamp);
    const q = qs.toString();
    return api<any>(`/langfuse/traces${q ? `?${q}` : ""}`);
  },
  scores: (params?: { limit?: number; name?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.name) qs.set("name", params.name);
    const q = qs.toString();
    return api<any>(`/langfuse/scores${q ? `?${q}` : ""}`);
  },
  models: (params?: { fromTimestamp?: string; toTimestamp?: string }) => {
    const qs = new URLSearchParams();
    if (params?.fromTimestamp) qs.set("fromTimestamp", params.fromTimestamp);
    if (params?.toTimestamp) qs.set("toTimestamp", params.toTimestamp);
    const q = qs.toString();
    return api<any>(`/langfuse/models${q ? `?${q}` : ""}`);
  },
};

export const modelsApi = {
  list: () => api<any>("/models/"),
  get: (id: string) => api<any>(`/models/${encodeURIComponent(id)}`),
  register: (source: string, sourceId: string) =>
    api<any>("/models/register", {
      method: "POST",
      body: JSON.stringify({ source, source_id: sourceId }),
    }),
  delete: (id: string) =>
    api<any>(`/models/${encodeURIComponent(id)}`, { method: "DELETE" }),
  searchHuggingFace: (query: string, filter?: string, limit?: number) =>
    api<any>(
      `/models/search/huggingface?q=${encodeURIComponent(query)}${
        filter ? `&filter=${encodeURIComponent(filter)}` : ""
      }${limit ? `&limit=${limit}` : ""}`,
    ),
  searchCivitAI: (query: string, type?: string, limit?: number) =>
    api<any>(
      `/models/search/civitai?q=${encodeURIComponent(query)}${
        type ? `&type=${encodeURIComponent(type)}` : ""
      }${limit ? `&limit=${limit}` : ""}`,
    ),
  startDownload: (id: string) =>
    api<any>(`/models/${encodeURIComponent(id)}/download`, { method: "POST" }),
  cancelDownload: (id: string) =>
    api<any>(`/models/${encodeURIComponent(id)}/download`, {
      method: "DELETE",
    }),
  deploy: (id: string, config: any) =>
    api<any>(`/models/${encodeURIComponent(id)}/deploy`, {
      method: "POST",
      body: JSON.stringify(config),
    }),
  scale: (id: string, replicas: number) =>
    api<any>(`/models/${encodeURIComponent(id)}/scale`, {
      method: "POST",
      body: JSON.stringify({ replicas }),
    }),
  discover: (namespace?: string) =>
    api<any>(
      `/models/discover${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`,
      { method: "POST" },
    ),
  crd: (namespace?: string) =>
    api<any>(
      `/models/crd${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`,
    ),
  crdScale: (namespace: string, name: string, minReplicas: number) =>
    api<any>(`/models/crd/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/scale`, {
      method: "POST",
      body: JSON.stringify({ minReplicas }),
    }),
  crdActivate: (namespace: string, name: string) =>
    api<any>(`/models/crd/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/activate`, { method: "POST" }),
  crdRestart: (namespace: string, name: string) =>
    api<any>(`/models/crd/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/restart`, { method: "POST" }),
  crdWatchSSEUrl: (namespace?: string) => {
    const isPublicView =
      typeof window !== "undefined" &&
      window.location.hostname === "www.flexinfer.ai";
    const apiBase = isPublicView ? "/flexdeck/api" : "/api";
    return `${apiBase}/models/crd/watch-sse${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`;
  },
  crdEvents: (ns: string, name: string) =>
    api<{ events: import("./types").ModelEvent[]; model: string; namespace: string }>(
      `/models/crd/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/events`
    ),
  crdInference: (ns: string, name: string) =>
    api<import("./types").InferenceMetrics>(
      `/models/crd/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/inference`
    ),
  lora: (ns: string, name: string) =>
    api<{ adapters: import("./types").LoRAAdapter[]; model: string; namespace: string }>(
      `/models/lora/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`
    ),
  catalogs: () =>
    api<{ catalogs: import("./types").ModelCatalogEntry[]; namespace: string }>("/models/catalogs"),
};

export const agentsApi = {
  list: () => api<any>("/agents/"),
  graph: () => api<{ nodes: any[]; edges: any[] }>("/agents/graph"),
  get: (id: string) => api<any>(`/agents/${encodeURIComponent(id)}`),
  create: (agent: any) =>
    api<any>("/agents/", {
      method: "POST",
      body: JSON.stringify(agent),
    }),
  update: (id: string, agent: any) =>
    api<any>(`/agents/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(agent),
    }),
  delete: (id: string) =>
    api<any>(`/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  health: () => api<any>("/agents/health"),
  checkHealth: (id: string) =>
    api<any>(`/agents/${encodeURIComponent(id)}/health`),
  test: (id: string, input: Record<string, any>) =>
    api<any>(`/agents/${encodeURIComponent(id)}/test`, {
      method: "POST",
      body: JSON.stringify({ input }),
    }),
  invoke: (id: string, request: any) =>
    api<any>(`/agents/${encodeURIComponent(id)}/invoke`, {
      method: "POST",
      body: JSON.stringify(request),
    }),
  usage: (id: string) => api<any>(`/agents/${encodeURIComponent(id)}/usage`),
  sessions: (id: string) => api<{ sessions: any[] }>(`/agents/${encodeURIComponent(id)}/sessions`),

  // Built-in Agent Builder
  builderInfo: () => api<any>("/agents/builder"),
  builderChat: (query: string, context?: Record<string, any>) =>
    api<any>("/agents/builder/chat", {
      method: "POST",
      body: JSON.stringify({ query, context }),
    }),

  // External Agent Frameworks
  frameworks: () => api<any>("/agents/frameworks"),

  // Dify integration
  difyChat: (
    query: string,
    conversationId?: string,
    inputs?: Record<string, string>,
  ) =>
    api<any>("/agents/dify/chat", {
      method: "POST",
      body: JSON.stringify({
        query,
        conversation_id: conversationId,
        inputs,
        response_mode: "blocking",
      }),
    }),

  // LangGraph integration
  langGraphAssistants: () => api<any>("/agents/langgraph/assistants"),
  langGraphRun: (
    graphId: string,
    input: Record<string, any>,
    threadId?: string,
  ) =>
    api<any>("/agents/langgraph/run", {
      method: "POST",
      body: JSON.stringify({ graph_id: graphId, input, thread_id: threadId }),
    }),
};

export const grafanaApi = {
  dashboards: () => api<any[]>("/grafana/dashboards"),
  dashboard: (uid: string) =>
    api<any>(`/grafana/dashboards/${encodeURIComponent(uid)}`),
  datasources: () => api<any[]>("/grafana/datasources"),
};

export const healthApi = {
  check: () =>
    api<{ status: string; components?: Record<string, any> }>("/health"),
};

export const uiApi = {
  getConfig: () => api<{ title?: string; theme?: string }>("/ui/config"),
};

export interface RepoInfo {
  id: number;
  name: string;
  path: string;
  type: string;
  hasConfig: boolean;
  configContent?: string;
}

export const ciApi = {
  listRepos: () => api<RepoInfo[]>("/ci/repos"),
  getPipeline: (id: number) => api<any>(`/ci/pipeline/${id}`),
  getJobTrace: (projectId: number, jobId: string) =>
    api<{ jobId: string; trace: string }>(
      `/ci/projects/${projectId}/jobs/${jobId}/trace`,
    ),
  getJobInfo: (projectId: number, jobId: string) =>
    api<any>(`/ci/projects/${projectId}/jobs/${jobId}`),
  retryJob: (projectId: number, jobId: string) =>
    api<{ success: boolean; jobId: string; status: string }>(
      `/ci/projects/${projectId}/jobs/${jobId}/retry`,
      { method: "POST" },
    ),
  cancelJob: (projectId: number, jobId: string) =>
    api<{ success: boolean; jobId: string; status: string }>(
      `/ci/projects/${projectId}/jobs/${jobId}/cancel`,
      { method: "POST" },
    ),
  playJob: (projectId: number, jobId: string) =>
    api<{ success: boolean; jobId: string; status: string }>(
      `/ci/projects/${projectId}/jobs/${jobId}/play`,
      { method: "POST" },
    ),
  // Pipeline trends & history
  getTrends: () => api<any[]>("/ci/trends"),
  getProjectTrends: (id: number) => api<any>(`/ci/projects/${id}/trends`),
  getProjectHistory: (id: number, limit?: number) =>
    api<any[]>(
      `/ci/projects/${id}/history${limit ? `?limit=${limit}` : ""}`,
    ),
  // Pipeline-level actions
  listPipelines: (projectId: number) =>
    api<any[]>(`/ci/projects/${projectId}/pipelines`),
  retryPipeline: (projectId: number, pipelineId: string) =>
    api<any>(`/ci/projects/${projectId}/pipelines/${pipelineId}/retry`, {
      method: "POST",
    }),
  cancelPipeline: (projectId: number, pipelineId: string) =>
    api<any>(`/ci/projects/${projectId}/pipelines/${pipelineId}/cancel`, {
      method: "POST",
    }),
  triggerPipeline: (projectId: number, ref: string) =>
    api<any>(`/ci/projects/${projectId}/pipelines`, {
      method: "POST",
      body: JSON.stringify({ ref }),
    }),
};

export interface FluxCondition {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface FluxSourceRef {
  kind: string;
  name: string;
  namespace?: string;
}

export interface FluxResource {
  name: string;
  namespace: string;
  kind: string;
  ready: boolean;
  message?: string;
  lastApplied?: string;
  suspended?: boolean;
  sourceRef?: FluxSourceRef;
  conditions?: FluxCondition[];
  dependsOn?: string[];
}

export interface FluxSource {
  name: string;
  namespace: string;
  kind: string;
  url?: string;
  branch?: string;
  ready: boolean;
  revision?: string;
  lastFetched?: string;
  conditions?: FluxCondition[];
}

export const fluxApi = {
  listKustomizations: () => api<FluxResource[]>("/flux/kustomizations"),
  listHelmReleases: () => api<FluxResource[]>("/flux/helmreleases"),
  listSources: () => api<FluxSource[]>("/flux/sources"),
  reconcile: (
    kind: string,
    namespace: string,
    name: string,
    withSource = false,
  ) =>
    api<{ ok: boolean; message: string }>(
      `/flux/reconcile/${kind}/${namespace}/${name}`,
      {
        method: "POST",
        body: JSON.stringify({ withSource }),
      },
    ),
  suspend: (kind: string, namespace: string, name: string, suspend: boolean) =>
    api<{ ok: boolean; message: string }>(
      `/flux/suspend/${kind}/${namespace}/${name}`,
      {
        method: "POST",
        body: JSON.stringify({ suspend }),
      },
    ),
  helmReleaseValues: (ns: string, name: string) =>
    api<any>(`/flux/helmreleases/${ns}/${name}/values`),
  helmReleaseHistory: (ns: string, name: string) =>
    api<any>(`/flux/helmreleases/${ns}/${name}/history`),
};

export const flexinferProxyApi = {
  health: () => api<any>("/flexinfer/proxy/health"),
  models: () => api<any>("/flexinfer/proxy/models"),
  metrics: () => api<import("./types").FlexInferProxyMetricsResponse>("/flexinfer/proxy/metrics"),
};

export const hudApi = {
  fleet: () => api<import("./types").HUDFleetResponse>("/hud/fleet"),
  presence: () => api<import("./types").HUDAgentPresence[]>("/hud/presence"),
  claims: () => api<import("./types").HUDClaim[]>("/hud/claims"),
  tasks: () => api<import("./types").HUDTask[]>("/hud/tasks"),
  workflows: () => api<import("./types").HUDWorkflow[]>("/hud/workflows"),
  timeline: () => api<import("./types").HUDTimelineEvent[]>("/hud/timeline"),
  approveWorkflow: (id: string) =>
    api<any>(`/hud/workflows/${id}/approve`, { method: "POST" }),
  rejectWorkflow: (id: string) =>
    api<any>(`/hud/workflows/${id}/reject`, { method: "POST" }),
  cancelWorkflow: (id: string, comment = "Cancelled from FlexDeck HUD") =>
    api<any>(`/hud/workflows/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ comment }),
    }),
  eventsSSEUrl: () => {
    const isPublicView =
      typeof window !== "undefined" &&
      window.location.hostname === "www.flexinfer.ai";
    const apiBase = isPublicView ? "/flexdeck/api" : "/api";
    return `${apiBase}/hud/events`;
  },
};

export const alertmanagerApi = {
  alerts: () => api<import("./types").AlertmanagerAlert[]>("/alertmanager/alerts"),
  silences: () => api<import("./types").AlertmanagerSilence[]>("/alertmanager/silences"),
  createSilence: (silence: any) =>
    api<any>("/alertmanager/silences", {
      method: "POST",
      body: JSON.stringify(silence),
    }),
  deleteSilence: (id: string) =>
    api<any>(`/alertmanager/silences/${id}`, { method: "DELETE" }),
  status: () => api<any>("/alertmanager/status"),
};

export const rbacApi = {
  me: () => api<import("./types").RBACUser>("/rbac/me"),
  roles: () => api<import("./types").RBACRole[]>("/rbac/roles"),
  listUsers: () => api<import("./types").RBACUser[]>("/rbac/users"),
  getUser: (id: string) => api<import("./types").RBACUser>(`/rbac/users/${id}`),
  createUser: (data: { username: string; role: string }) =>
    api<import("./types").RBACUser & { token: string }>("/rbac/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateUser: (
    id: string,
    data: Partial<{ username: string; role: string; disabled: boolean }>,
  ) =>
    api<import("./types").RBACUser>(`/rbac/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteUser: (id: string) =>
    api<void>(`/rbac/users/${id}`, { method: "DELETE" }),
};

export const auditApi = {
  list: (params?: {
    since?: string;
    until?: string;
    action?: string;
    user?: string;
    offset?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.since) qs.set("since", params.since);
    if (params?.until) qs.set("until", params.until);
    if (params?.action) qs.set("action", params.action);
    if (params?.user) qs.set("user", params.user);
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.limit) qs.set("limit", String(params.limit));
    return api<{ entries: import("./types").AuditEntry[]; total: number }>(
      `/audit?${qs}`,
    );
  },
  stats: () => api<import("./types").AuditStats>("/audit/stats"),
};

export const clustersApi = {
  list: () => api<import("./types").ClusterInfo[]>("/clusters"),
  get: (id: string) => api<import("./types").ClusterInfo>(`/clusters/${id}`),
  create: (data: {
    name: string;
    host: string;
    token: string;
    namespace?: string;
  }) =>
    api<import("./types").ClusterInfo>("/clusters", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  update: (
    id: string,
    data: Partial<{
      name: string;
      host: string;
      token: string;
      namespace: string;
      readOnly: boolean;
    }>,
  ) =>
    api<import("./types").ClusterInfo>(`/clusters/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    api<void>(`/clusters/${id}`, { method: "DELETE" }),
  test: (id: string) =>
    api<{ ok: boolean; error?: string }>(`/clusters/${id}/test`, {
      method: "POST",
    }),
  setDefault: (id: string) =>
    api<void>(`/clusters/${id}/default`, { method: "POST" }),
};
