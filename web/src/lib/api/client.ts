import { createSignal } from "solid-js";
import { authenticatedFetch } from "../../stores/auth";

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
