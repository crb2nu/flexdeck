import { api } from "./client";
import { getApiBasePath } from "./base";
import type {
  ClusterInfo,
  FlexInferProxyMetricsResponse,
  AlertmanagerAlert,
  AlertmanagerSilence,
  LiteLLMRouterResponse,
} from "../types";

import type { InfraSnapshot } from "../../components/Infra/types";

export const infraApi = {
  snapshot: () => api<InfraSnapshot>("/infra/snapshot"),
};

// --- Dashboard summary (server-side materialized resource metrics) ---

export interface DashboardSummaryNodeGPU {
  count: number;
  utilization: number | null;
  vram_used: number | null;
  vram_total: number | null;
  temperature: number | null;
  power_watts: number | null;
}

export interface DashboardSummaryNode {
  node: string;
  cpu_percent: number | null;
  mem_percent: number | null;
  mem_used: number | null;
  mem_total: number | null;
  gpu: DashboardSummaryNodeGPU | null;
}

export interface DashboardSummaryPod {
  namespace: string;
  pod: string;
  cpu_percent: number;
  memory_used: number;
  memory_limit: number;
}

export interface DashboardSummaryResponse {
  cluster: {
    cpu_percent: number;
    memory_used: number;
    memory_total: number;
  };
  nodes: DashboardSummaryNode[];
  pods: DashboardSummaryPod[];
  updated_at: string;
}

export const dashboardApi = {
  summary: () => api<DashboardSummaryResponse>("/dashboard/summary"),
};

export interface TrafficHost {
  host: string;
  requests: number;
  requests_per_second: number;
  four_xx: number;
  four_xx_prev: number;
  four_xx_change: number;
  five_xx: number;
  five_xx_prev: number;
  five_xx_change: number;
  error_rate: number;
  p95_latency_ms: number;
}

export interface TrafficPath {
  host: string;
  path: string;
  requests: number;
}

export interface TrafficPage {
  page: string;
  views: number;
}

export interface TrafficSignal {
  name: string;
  ok: boolean;
  value: number;
  detail: string;
}

export interface TrafficReportResponse {
  generated_at: string;
  window: string;
  status: "ok" | "partial";
  hosts: TrafficHost[];
  top_paths: TrafficPath[];
  top_pages: TrafficPage[];
  tracking_signals: TrafficSignal[];
  recommendations: string[];
  warnings?: string[];
}

export const trafficApi = {
  report: (window = "24h") =>
    api<TrafficReportResponse>(
      `/traffic/report?window=${encodeURIComponent(window)}`,
    ),
};

export const litellm = {
  health: () => api<any>("/litellm/health"),
  metrics: (model?: string) =>
    api<any>(`/litellm/metrics${model ? `/${model}` : ""}`),
  modelMetrics: (model: string) =>
    api<LiteLLMModelThroughput>(
      `/litellm/metrics/${encodeURIComponent(model)}`,
    ),
  models: () => api<any[]>("/litellm/models"),
  router: () => api<LiteLLMRouterResponse>("/litellm/router"),
};

export interface FlexInferProxyHealthResponse {
  healthy?: boolean;
  status?: string;
  mode?: string;
  partial?: boolean;
  message?: string;
}

export interface LiteLLMModelThroughput {
  model: string;
  tok_per_sec_1m: number;
  tok_per_sec_5m: number;
  tok_per_sec_15m: number;
  output_tok_per_sec: number;
  requests_per_min: number;
  avg_latency_ms: number;
  sparkline: number[];
  trend: string;
  last_updated: string;
}

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

export const prom = {
  health: () => api<any>("/prom/health"),
  query: (query: string) =>
    api<any>(`/prom/query?query=${encodeURIComponent(query)}`),
  queryRange: (query: string, start: number, end: number, step: string) =>
    api<any>(
      `/prom/query_range?query=${encodeURIComponent(
        query,
      )}&start=${start}&end=${end}&step=${step}`,
    ),
  alerts: () => api<any>("/prom/alerts"),
  rules: () => api<any>("/prom/rules"),
};

export const loki = {
  labels: () => api<any>("/loki/labels"),
  labelValues: (name: string) => api<any>(`/loki/label/${name}/values`),
  query: (query: string, limit?: number) =>
    api<any>(
      `/loki/query?query=${encodeURIComponent(query)}&limit=${limit || 100}`,
    ),
  queryRange: (query: string, start: number, end: number, limit?: number) =>
    api<any>(
      `/loki/query_range?query=${encodeURIComponent(
        query,
      )}&start=${start}&end=${end}&limit=${limit || 100}`,
    ),
  tailSSEUrl: (query: string) => {
    const apiBase = getApiBasePath();
    return `${apiBase}/loki/tail-sse?query=${encodeURIComponent(query)}`;
  },
  export: (query: string, start: number, end: number) => {
    const apiBase = getApiBasePath();
    return `${apiBase}/loki/export?query=${encodeURIComponent(query)}&start=${start}&end=${end}`;
  },
};

export const grafanaApi = {
  dashboards: () => api<any[]>("/grafana/dashboards"),
  dashboard: (uid: string) =>
    api<any>(`/grafana/dashboards/${encodeURIComponent(uid)}`),
  datasources: () => api<any[]>("/grafana/datasources"),
};

export interface RepoInfo {
  id: number;
  name: string;
  path: string;
  type: string;
  hasConfig: boolean;
  configContent?: string;
}

export interface CISummary {
  active_pipelines: number;
  failed_last_24h: number;
  success_last_24h: number;
  success_rate_24h: number;
  avg_duration_24h_s: number;
  slowest_project?: string;
  slowest_duration_s: number;
}

export interface BatchPipelinesResponse {
  pipelines: Record<string, unknown>;
}

export interface RepoConfigResponse {
  id: number;
  configContent: string;
  hasConfig: boolean;
}

export const ciApi = {
  getSummary: () => api<CISummary>("/ci/summary"),
  listRepos: () => api<RepoInfo[]>("/ci/repos"),
  getPipeline: (id: number) => api<any>(`/ci/pipeline/${id}`),
  batchPipelines: (ids: number[]) =>
    api<BatchPipelinesResponse>(`/ci/pipelines/batch?ids=${ids.join(",")}`),
  repoConfig: (id: number) => api<RepoConfigResponse>(`/ci/repos/${id}/config`),
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
    api<any[]>(`/ci/projects/${id}/history${limit ? `?limit=${limit}` : ""}`),
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
  metrics: () => api<FlexInferProxyMetricsResponse>("/flexinfer/proxy/metrics"),
};

export const hudApi = {
  fleet: () => api<import("../types").HUDFleetResponse>("/hud/fleet"),
  presence: () => api<import("../types").HUDAgentPresence[]>("/hud/presence"),
  claims: () => api<import("../types").HUDClaim[]>("/hud/claims"),
  tasks: () => api<import("../types").HUDTask[]>("/hud/tasks"),
  workflows: () => api<import("../types").HUDWorkflow[]>("/hud/workflows"),
  timeline: () => api<import("../types").HUDTimelineEvent[]>("/hud/timeline"),
  handoffs: () => api<import("../types").HUDHandoff[]>("/hud/handoffs"),
  sessionDetail: (id: string) =>
    api<import("../types").HUDSessionDetail>(`/hud/sessions/${encodeURIComponent(id)}`),
  acceptHandoff: (id: string, body?: Record<string, unknown>) =>
    api<any>(`/hud/handoffs/${id}/accept`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  rejectHandoff: (id: string, reason?: string) =>
    api<any>(`/hud/handoffs/${id}/reject`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    }),
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
    const apiBase = getApiBasePath();
    return `${apiBase}/hud/events`;
  },
};

export const alertmanagerApi = {
  alerts: () => api<AlertmanagerAlert[]>("/alertmanager/alerts"),
  silences: () => api<AlertmanagerSilence[]>("/alertmanager/silences"),
  createSilence: (silence: any) =>
    api<any>("/alertmanager/silences", {
      method: "POST",
      body: JSON.stringify(silence),
    }),
  deleteSilence: (id: string) =>
    api<any>(`/alertmanager/silences/${id}`, { method: "DELETE" }),
  status: () => api<any>("/alertmanager/status"),
};

export const uiApi = {
  getConfig: () => api<{ title?: string; theme?: string }>("/ui/config"),
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

export const rbacApi = {
  me: () => api<import("../types").RBACUser>("/rbac/me"),
  roles: () => api<import("../types").RBACRole[]>("/rbac/roles"),
  listUsers: () => api<import("../types").RBACUser[]>("/rbac/users"),
  getUser: (id: string) =>
    api<import("../types").RBACUser>(`/rbac/users/${id}`),
  createUser: (data: { username: string; role: string }) =>
    api<import("../types").RBACUser & { token: string }>("/rbac/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateUser: (
    id: string,
    data: Partial<{ username: string; role: string; disabled: boolean }>,
  ) =>
    api<import("../types").RBACUser>(`/rbac/users/${id}`, {
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
    return api<{ entries: import("../types").AuditEntry[]; total: number }>(
      `/audit?${qs}`,
    );
  },
  stats: () => api<import("../types").AuditStats>("/audit/stats"),
};

export const clustersApi = {
  list: () => api<ClusterInfo[]>("/clusters"),
  get: (id: string) => api<ClusterInfo>(`/clusters/${id}`),
  create: (data: {
    name: string;
    host: string;
    token: string;
    namespace?: string;
  }) =>
    api<ClusterInfo>("/clusters", {
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
    api<ClusterInfo>(`/clusters/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) => api<void>(`/clusters/${id}`, { method: "DELETE" }),
  test: (id: string) =>
    api<{ ok: boolean; error?: string }>(`/clusters/${id}/test`, {
      method: "POST",
    }),
  setDefault: (id: string) =>
    api<void>(`/clusters/${id}/default`, { method: "POST" }),
};
