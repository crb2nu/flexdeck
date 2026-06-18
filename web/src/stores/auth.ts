import { createSignal } from 'solid-js';
import { getApiBasePath } from '../lib/api/base';
import type { RBACUser } from '../lib/types/enterprise';

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

/**
 * AuthStatus models whether the RBAC login gate should be shown:
 *  - 'unknown'      : not yet probed
 *  - 'checking'     : probe in flight
 *  - 'authed'       : RBAC enforced and the current token is valid
 *  - 'required'     : RBAC enforced but no valid token — show the login screen
 *  - 'not-required' : RBAC is not enforced (or probe inconclusive) — render normally
 */
export type AuthStatus = 'unknown' | 'checking' | 'authed' | 'required' | 'not-required';

const [authStatus, setAuthStatus] = createSignal<AuthStatus>('unknown');
const [currentUser, setCurrentUser] = createSignal<RBACUser | null>(null);

/**
 * checkAuth probes GET /api/rbac/me to classify the auth state. The endpoint is
 * only mounted when RBAC is enabled, so its status code is a self-contained
 * signal (no dependency on the health feature flag):
 *   200 -> authed, 401 -> required, anything else (404/5xx/network) -> not-required.
 * We deliberately fail open to 'not-required' on ambiguous responses so a
 * backend hiccup never bricks the dashboard for a non-RBAC deployment.
 */
async function checkAuth(): Promise<AuthStatus> {
  setAuthStatus('checking');
  try {
    const res = await authenticatedFetch(`${getApiBasePath()}/rbac/me`);
    if (res.ok) {
      const user = (await res.json()) as RBACUser;
      setCurrentUser(user);
      setAuthStatus('authed');
    } else if (res.status === 401) {
      setCurrentUser(null);
      setAuthStatus('required');
    } else {
      setCurrentUser(null);
      setAuthStatus('not-required');
    }
  } catch {
    // Network error: don't lock the user out — let the app render and surface
    // its own per-request errors.
    setCurrentUser(null);
    setAuthStatus('not-required');
  }
  return authStatus();
}

/** login stores the token and re-probes; returns true when authenticated. */
async function login(newToken: string): Promise<boolean> {
  setToken(newToken.trim());
  await checkAuth();
  return authStatus() === 'authed';
}

/** logout clears the token and returns to the login gate. */
function logout(): void {
  setToken(null);
  setCurrentUser(null);
  setAuthStatus('required');
}

/**
 * notifyUnauthorized is called by the API client when a request returns 401.
 * It re-opens the login gate for an authed/just-loaded session (token expired,
 * revoked, or the user was disabled) but leaves a known non-RBAC deployment
 * untouched.
 */
function notifyUnauthorized(): void {
  const status = authStatus();
  if (status === 'authed' || status === 'unknown' || status === 'checking') {
    setCurrentUser(null);
    setAuthStatus('required');
  }
}

export {
  token,
  setToken,
  getAuthHeaders,
  authenticatedFetch,
  authStatus,
  currentUser,
  checkAuth,
  login,
  logout,
  notifyUnauthorized,
};
