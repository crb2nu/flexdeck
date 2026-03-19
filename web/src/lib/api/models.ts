import { api } from "./client";
import { getApiBasePath } from "./base";
import type {
  GroupSwapHistoryResponse,
  InferenceMetrics,
  LoRAAdapter,
  ModelCache,
  ModelCacheListResponse,
  ModelCatalogEntry,
  ModelEvent,
  SwapHistoryResponse,
} from "../types";

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
  crdPatchSpec: (namespace: string, name: string, specPatch: Record<string, unknown>) =>
    api<any>(`/models/crd/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/spec`, {
      method: "PATCH",
      body: JSON.stringify(specPatch),
    }),
  crdWatchSSEUrl: (namespace?: string) => {
    const apiBase = getApiBasePath();
    return `${apiBase}/models/crd/watch-sse${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`;
  },
  crdEvents: (ns: string, name: string) =>
    api<{ events: ModelEvent[]; model: string; namespace: string }>(
      `/models/crd/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/events`
    ),
  swapHistory: (ns: string, name: string, hours?: number) =>
    api<SwapHistoryResponse>(
      `/models/crd/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/swap-history${hours ? `?hours=${hours}` : ''}`
    ),
  crdInference: (ns: string, name: string) =>
    api<InferenceMetrics>(
      `/models/crd/${encodeURIComponent(ns)}/${encodeURIComponent(name)}/inference`
    ),
  lora: (ns: string, name: string) =>
    api<{ adapters: LoRAAdapter[]; model: string; namespace: string }>(
      `/models/lora/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`
    ),
  catalogs: () =>
    api<{ catalogs: ModelCatalogEntry[]; namespace: string }>("/models/catalogs"),
  cacheList: (namespace?: string) =>
    api<ModelCacheListResponse>(`/models/cache${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`),
  cacheGet: (namespace: string, name: string) =>
    api<ModelCache>(`/models/cache/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`),
  cacheWatchSSEUrl: (namespace?: string) => {
    const apiBase = getApiBasePath();
    return `${apiBase}/models/cache/watch-sse${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""}`;
  },
  cachePodLogsUrl: (namespace: string, name: string) => {
    const apiBase = getApiBasePath();
    return `${apiBase}/models/cache/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/logs`;
  },
  groupSwapHistory: (group: string, namespace: string, hours?: number) =>
    api<GroupSwapHistoryResponse>(
      `/models/crd/groups/${encodeURIComponent(group)}/swap-history?namespace=${encodeURIComponent(namespace)}${hours ? `&hours=${hours}` : ''}`
    ),
};
