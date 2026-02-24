import { api } from "./client";
import type {
  ClusterInfo,
  FlexInferProxyMetricsResponse,
  AlertmanagerAlert,
  AlertmanagerSilence,
} from "../types";

export const litellm = {
  health: () => api<any>("/api/litellm/health"),
  metrics: (model?: string) =>
    api<any>(`/api/litellm/metrics${model ? `/${model}` : ""}`),
  models: () => api<any[]>("/api/litellm/models"),
  router: () => api<any>("/api/litellm/router"),
};

export const langfuse = {
  health: () => api<any>("/api/langfuse/health"),
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
    return api<any>(`/api/langfuse/metrics${q ? `?${q}` : ""}`);
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
    return api<any>(`/api/langfuse/traces${q ? `?${q}` : ""}`);
  },
  scores: (params?: { limit?: number; name?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.name) qs.set("name", params.name);
    const q = qs.toString();
    return api<any>(`/api/langfuse/scores${q ? `?${q}` : ""}`);
  },
  models: (params?: { fromTimestamp?: string; toTimestamp?: string }) => {
    const qs = new URLSearchParams();
    if (params?.fromTimestamp) qs.set("fromTimestamp", params.fromTimestamp);
    if (params?.toTimestamp) qs.set("toTimestamp", params.toTimestamp);
    const q = qs.toString();
    return api<any>(`/api/langfuse/models${q ? `?${q}` : ""}`);
  },
};

export const grafanaApi = {
  dashboards: () => api<any[]>("/api/grafana/dashboards"),
  dashboard: (uid: string) =>
    api<any>(`/api/grafana/dashboards/${encodeURIComponent(uid)}`),
  datasources: () => api<any[]>("/api/grafana/datasources"),
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
  listRepos: () => api<RepoInfo[]>("/api/ci/repos"),
  getPipeline: (id: number) => api<any>(`/api/ci/pipeline/${id}`),
  getJobTrace: (projectId: number, jobId: string) =>
    api<{ jobId: string; trace: string }>(
      `/api/ci/projects/${projectId}/jobs/${jobId}/trace`,
    ),
  getJobInfo: (projectId: number, jobId: string) =>
    api<any>(`/api/ci/projects/${projectId}/jobs/${jobId}`),
  retryJob: (projectId: number, jobId: string) =>
    api<{ success: boolean; jobId: string; status: string }>(
      `/api/ci/projects/${projectId}/jobs/${jobId}/retry`,
      { method: "POST" },
    ),
  cancelJob: (projectId: number, jobId: string) =>
    api<{ success: boolean; jobId: string; status: string }>(
      `/api/ci/projects/${projectId}/jobs/${jobId}/cancel`,
      { method: "POST" },
    ),
  playJob: (projectId: number, jobId: string) =>
    api<{ success: boolean; jobId: string; status: string }>(
      `/api/ci/projects/${projectId}/jobs/${jobId}/play`,
      { method: "POST" },
    ),
  // Pipeline trends & history
  getTrends: () => api<any[]>("/api/ci/trends"),
  getProjectTrends: (id: number) => api<any>(`/api/ci/projects/${id}/trends`),
  getProjectHistory: (id: number, limit?: number) =>
    api<any[]>(
      `/api/ci/projects/${id}/history${limit ? `?limit=${limit}` : ""}`,
    ),
  // Pipeline-level actions
  listPipelines: (projectId: number) =>
    api<any[]>(`/api/ci/projects/${projectId}/pipelines`),
  retryPipeline: (projectId: number, pipelineId: string) =>
    api<any>(`/api/ci/projects/${projectId}/pipelines/${pipelineId}/retry`, {
      method: "POST",
    }),
  cancelPipeline: (projectId: number, pipelineId: string) =>
    api<any>(`/api/ci/projects/${projectId}/pipelines/${pipelineId}/cancel`, {
      method: "POST",
    }),
  triggerPipeline: (projectId: number, ref: string) =>
    api<any>(`/api/ci/projects/${projectId}/pipelines`, {
      method: "POST",
      body: JSON.stringify({ ref }),
    }),
};

export const fluxApi = {
  listKustomizations: () => api<FluxResource[]>("/api/flux/kustomizations"),
  listHelmReleases: () => api<FluxResource[]>("/api/flux/helmreleases"),
  listSources: () => api<FluxSource[]>("/api/flux/sources"),
  reconcile: (
    kind: string,
    namespace: string,
    name: string,
    withSource = false,
  ) =>
    api<{ ok: boolean; message: string }>(
      `/api/flux/reconcile/${kind}/${namespace}/${name}`,
      {
        method: "POST",
        body: JSON.stringify({ withSource }),
      },
    ),
  suspend: (kind: string, namespace: string, name: string, suspend: boolean) =>
    api<{ ok: boolean; message: string }>(
      `/api/flux/suspend/${kind}/${namespace}/${name}`,
      {
        method: "POST",
        body: JSON.stringify({ suspend }),
      },
    ),
  helmReleaseValues: (ns: string, name: string) =>
    api<any>(`/api/flux/helmreleases/${ns}/${name}/values`),
  helmReleaseHistory: (ns: string, name: string) =>
    api<any>(`/api/flux/helmreleases/${ns}/${name}/history`),
};

export const flexinferProxyApi = {
  health: () => api<any>("/api/flexinfer/proxy/health"),
  models: () => api<any>("/api/flexinfer/proxy/models"),
  metrics: () =>
    api<FlexInferProxyMetricsResponse>("/api/flexinfer/proxy/metrics"),
};

export const hudApi = {
  fleet: () => api<import("../types").HUDFleetResponse>("/api/hud/fleet"),
  presence: () =>
    api<import("../types").HUDAgentPresence[]>("/api/hud/presence"),
  claims: () => api<import("../types").HUDClaim[]>("/api/hud/claims"),
  tasks: () => api<import("../types").HUDTask[]>("/api/hud/tasks"),
  workflows: () => api<import("../types").HUDWorkflow[]>("/api/hud/workflows"),
  timeline: () =>
    api<import("../types").HUDTimelineEvent[]>("/api/hud/timeline"),
  approveWorkflow: (id: string) =>
    api<any>(`/api/hud/workflows/${id}/approve`, { method: "POST" }),
  rejectWorkflow: (id: string) =>
    api<any>(`/api/hud/workflows/${id}/reject`, { method: "POST" }),
  cancelWorkflow: (id: string, comment = "Cancelled from FlexDeck HUD") =>
    api<any>(`/api/hud/workflows/${id}/cancel`, {
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
  alerts: () => api<AlertmanagerAlert[]>("/api/alertmanager/alerts"),
  silences: () => api<AlertmanagerSilence[]>("/api/alertmanager/silences"),
  createSilence: (silence: any) =>
    api<any>("/api/alertmanager/silences", {
      method: "POST",
      body: JSON.stringify(silence),
    }),
  deleteSilence: (id: string) =>
    api<any>(`/api/alertmanager/silences/${id}`, { method: "DELETE" }),
  status: () => api<any>("/api/alertmanager/status"),
};

export const uiApi = {
  getConfig: () => api<{ title?: string; theme?: string }>("/api/ui/config"),
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
  me: () => api<import("../types").RBACUser>("/api/rbac/me"),
  roles: () => api<import("../types").RBACRole[]>("/api/rbac/roles"),
  listUsers: () => api<import("../types").RBACUser[]>("/api/rbac/users"),
  getUser: (id: string) =>
    api<import("../types").RBACUser>(`/api/rbac/users/${id}`),
  createUser: (data: { username: string; role: string }) =>
    api<import("../types").RBACUser & { token: string }>("/api/rbac/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateUser: (
    id: string,
    data: Partial<{ username: string; role: string; disabled: boolean }>,
  ) =>
    api<import("../types").RBACUser>(`/api/rbac/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteUser: (id: string) =>
    api<void>(`/api/rbac/users/${id}`, { method: "DELETE" }),
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
      `/api/audit?${qs}`,
    );
  },
  stats: () => api<import("../types").AuditStats>("/api/audit/stats"),
};

export const clustersApi = {
  list: () => api<ClusterInfo[]>("/api/clusters"),
  get: (id: string) => api<ClusterInfo>(`/api/clusters/${id}`),
  create: (data: {
    name: string;
    host: string;
    token: string;
    namespace?: string;
  }) =>
    api<ClusterInfo>("/api/clusters", {
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
    api<ClusterInfo>(`/api/clusters/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    api<void>(`/api/clusters/${id}`, { method: "DELETE" }),
  test: (id: string) =>
    api<{ ok: boolean; error?: string }>(`/api/clusters/${id}/test`, {
      method: "POST",
    }),
  setDefault: (id: string) =>
    api<void>(`/api/clusters/${id}/default`, { method: "POST" }),
};
