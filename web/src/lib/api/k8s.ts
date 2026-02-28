import { api } from "./client";
import { getApiBasePath } from "./base";

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
    const apiBase = getApiBasePath();
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
