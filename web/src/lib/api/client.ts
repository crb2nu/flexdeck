import { createSignal } from "solid-js";
import { authenticatedFetch } from "../../stores/auth";
import { getApiBasePath } from "./base";

interface ApiErrorDetail {
  code?: string;
  message?: string;
}

interface ApiError {
  // Some upstreams return `error` as a plain string ("metrics store unavailable"),
  // others as a structured object ({ code, message }). Accept both shapes
  // and normalize via `flattenApiErrorMessage`.
  error?: string | ApiErrorDetail;
  message?: string;
}

function flattenApiErrorMessage(data: ApiError): string | null {
  if (typeof data.error === "string" && data.error.trim() !== "") {
    return data.error;
  }
  if (data.error && typeof data.error === "object") {
    const detail = data.error as ApiErrorDetail;
    if (detail.message && detail.message.trim() !== "") return detail.message;
    if (detail.code && detail.code.trim() !== "") return detail.code;
  }
  if (typeof data.message === "string" && data.message.trim() !== "") {
    return data.message;
  }
  return null;
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
  const apiBase = getApiBasePath();

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
        const data = (await response.json()) as ApiError;
        message = flattenApiErrorMessage(data) ?? message;
      } else {
        const text = await response.text();
        const trimmed = text.trim();
        if (trimmed !== "") {
          // Many Go services return JSON-shaped error bodies with
          // `text/plain` content-type. Attempt a best-effort JSON parse
          // before falling back to the raw text so users don't see
          // `{"error":"..."}` rendered verbatim in the UI.
          if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
            try {
              const data = JSON.parse(trimmed) as ApiError;
              message = flattenApiErrorMessage(data) ?? trimmed;
            } catch {
              message = trimmed;
            }
          } else {
            message = trimmed;
          }
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
