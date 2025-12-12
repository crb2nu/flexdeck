import { authenticatedFetch } from '../stores/auth';

interface ApiError {
  error: string;
  message?: string;
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function api<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await authenticatedFetch(`/api${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
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
    api<any>(`/k8s/services${ns ? `?ns=${ns}` : ''}`),
  getNodes: () => api<any>('/k8s/nodes'),
  getDeployments: (ns?: string) =>
    api<any>(`/k8s/deployments${ns ? `?ns=${ns}` : ''}`),
  getPods: (ns?: string) => api<any>(`/k8s/pods${ns ? `?ns=${ns}` : ''}`),
  getIngresses: (ns?: string) =>
    api<any>(`/k8s/ingresses${ns ? `?ns=${ns}` : ''}`),
  scaleDeployment: (ns: string, name: string, replicas: number) =>
    api<any>(`/k8s/deployments/${ns}/${name}/scale?replicas=${replicas}`, {
      method: 'POST',
    }),
  restartDeployment: (ns: string, name: string) =>
    api<any>(`/k8s/deployments/${ns}/${name}/restart`, { method: 'POST' }),
};

export const prom = {
  health: () => api<any>('/prom/health'),
  query: (query: string, time?: string) =>
    api<any>(`/prom/query?query=${encodeURIComponent(query)}${time ? `&time=${time}` : ''}`),
  queryRange: (query: string, start: string, end: string, step: string) =>
    api<any>(
      `/prom/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}&step=${step}`
    ),
};

export const loki = {
  labels: () => api<any>('/loki/labels'),
  labelValues: (name: string) => api<any>(`/loki/label/${name}/values`),
  query: (query: string, limit?: number) =>
    api<any>(`/loki/query?query=${encodeURIComponent(query)}${limit ? `&limit=${limit}` : ''}`),
  queryRange: (
    query: string,
    start: string,
    end: string,
    limit?: number
  ) =>
    api<any>(
      `/loki/query_range?query=${encodeURIComponent(query)}&start=${start}&end=${end}${limit ? `&limit=${limit}` : ''}`
    ),
};
