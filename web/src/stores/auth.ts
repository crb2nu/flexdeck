import { createSignal } from 'solid-js';

const STORAGE_KEY = 'flexdeck_token';

const [token, setTokenInternal] = createSignal<string | null>(
  typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
);

function setToken(newToken: string | null): void {
  if (newToken) {
    localStorage.setItem(STORAGE_KEY, newToken);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  setTokenInternal(newToken);
}

function getAuthHeaders(): HeadersInit {
  const t = token();
  if (t) {
    return { Authorization: `Bearer ${t}` };
  }
  return {};
}

async function authenticatedFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  const t = token();
  if (t) {
    headers.set('Authorization', `Bearer ${t}`);
  }

  return fetch(url, { ...options, headers });
}

export { token, setToken, getAuthHeaders, authenticatedFetch };
