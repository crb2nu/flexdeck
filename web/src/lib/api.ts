import { authenticatedFetch } from "../stores/auth";

interface ApiError {
  error: string;
  message?: string;
}

export class ApiRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function api<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await authenticatedFetch(`/api${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const data: ApiError = await response.json();
      message = data.error || data.message || message;
    } catch {
      // Ignore JSON parse errors
    }
    throw new ApiRequestError(response.status, message);
  }

  return response.json();
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
};

export const prom = {
  health: () => api<any>("/prom/health"),
  query: (query: string, time?: string) =>
    api<any>(
      `/prom/query?query=${encodeURIComponent(query)}${
        time ? `&time=${time}` : ""
      }`
    ),
  queryRange: (query: string, start: string, end: string, step: string) =>
    api<any>(
      `/prom/query_range?query=${encodeURIComponent(
        query
      )}&start=${start}&end=${end}&step=${step}`
    ),
};

export const loki = {
  labels: () => api<any>("/loki/labels"),
  labelValues: (name: string) => api<any>(`/loki/label/${name}/values`),
  query: (query: string, limit?: number) =>
    api<any>(
      `/loki/query?query=${encodeURIComponent(query)}${
        limit ? `&limit=${limit}` : ""
      }`
    ),
  queryRange: (query: string, start: string, end: string, limit?: number) =>
    api<any>(
      `/loki/query_range?query=${encodeURIComponent(
        query
      )}&start=${start}&end=${end}${limit ? `&limit=${limit}` : ""}`
    ),
};

export const litellm = {
  health: () => api<any>("/litellm/health"),
  metrics: () => api<any>("/litellm/metrics"),
  modelMetrics: (model: string) =>
    api<any>(`/litellm/metrics/${encodeURIComponent(model)}`),
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
      }${limit ? `&limit=${limit}` : ""}`
    ),
  searchCivitAI: (query: string, type?: string, limit?: number) =>
    api<any>(
      `/models/search/civitai?q=${encodeURIComponent(query)}${
        type ? `&type=${encodeURIComponent(type)}` : ""
      }${limit ? `&limit=${limit}` : ""}`
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
};

export const agentsApi = {
  list: () => api<any>("/agents/"),
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
};
