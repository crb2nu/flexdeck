import { createSignal } from "solid-js";
import { authenticatedFetch, notifyUnauthorized } from "../../stores/auth";
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

const MAX_ERROR_TEXT_LENGTH = 240;

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
    // A 401 means RBAC rejected the request (missing/expired/revoked token).
    // Re-open the login gate so the user can re-authenticate instead of staring
    // at an empty dashboard.
    if (response.status === 401) {
      notifyUnauthorized();
    }
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
          message =
            summarizeNonJsonError(response, contentType, trimmed) ?? message;
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
  if (isHtmlResponse(contentType, text)) {
    throw new ApiRequestError(
      response.status,
      summarizeUnexpectedHtmlResponse(response, text),
    );
  }

  return text as T;
}

function summarizeNonJsonError(
  response: Response,
  contentType: string,
  text: string,
): string | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }

  if (isHtmlResponse(contentType, trimmed)) {
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    const prefix = `Request failed: ${response.status}${statusText}`;
    const title = extractHtmlTitle(trimmed);
    return title ? `${prefix} (${title})` : prefix;
  }

  // Many Go services return JSON-shaped error bodies with `text/plain`
  // content-type. Keep parsing those before falling back to raw text.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const data = JSON.parse(trimmed) as ApiError;
      return flattenApiErrorMessage(data) ?? truncateErrorText(trimmed);
    } catch {
      return truncateErrorText(trimmed);
    }
  }

  return truncateErrorText(trimmed.split(/\r?\n/, 1)[0]);
}

function summarizeUnexpectedHtmlResponse(
  response: Response,
  text: string,
): string {
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  const title = extractHtmlTitle(text);
  const prefix = `Request returned HTML instead of data: ${response.status}${statusText}`;
  return title ? `${prefix} (${title})` : prefix;
}

function truncateErrorText(value: string): string {
  if (value.length <= MAX_ERROR_TEXT_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_ERROR_TEXT_LENGTH - 3)}...`;
}

function isHtmlResponse(contentType: string, text: string): boolean {
  const trimmed = text.trim();
  return (
    contentType.includes("text/html") ||
    /^<!doctype\s+html/i.test(trimmed) ||
    /^<html[\s>]/i.test(trimmed)
  );
}

function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return "";
  }
  return decodeHtmlEntities(stripHtml(match[1]).trim());
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(#\d+|#x[\da-f]+|amp|lt|gt|quot|apos);/gi,
    (entity, raw) => {
      const namedEntities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      };
      const key = String(raw).toLowerCase();
      if (key in namedEntities) {
        return namedEntities[key];
      }
      if (key.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      }
      if (key.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
      }
      return entity;
    },
  );
}
