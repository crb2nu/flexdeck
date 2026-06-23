/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const storageValues = new Map<string, string>();
const localStorageMock: Storage = {
  get length() {
    return storageValues.size;
  },
  clear: () => storageValues.clear(),
  getItem: (key: string) => storageValues.get(key) ?? null,
  key: (index: number) => Array.from(storageValues.keys())[index] ?? null,
  removeItem: (key: string) => {
    storageValues.delete(key);
  },
  setItem: (key: string, value: string) => {
    storageValues.set(key, value);
  },
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});

const { authStatus, currentUser, token, setToken, checkAuth, login, logout, notifyUnauthorized } =
  await import('./auth');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(status === 401 ? 'unauthorized' : JSON.stringify(body), {
    status,
    headers: { 'content-type': status === 401 ? 'text/plain' : 'application/json' },
  });
}

const adminUser = {
  id: 'u1',
  username: 'admin',
  role: 'admin' as const,
  createdAt: '',
  updatedAt: '',
  disabled: false,
};

describe('auth store', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    window.localStorage.clear();
    setToken(null);
  });

  it('classifies a 200 from /rbac/me as authed and records the user', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, adminUser));
    const status = await checkAuth();
    expect(status).toBe('authed');
    expect(authStatus()).toBe('authed');
    expect(currentUser()?.username).toBe('admin');
  });

  it('classifies a 401 as login-required', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, null));
    expect(await checkAuth()).toBe('required');
    expect(currentUser()).toBeNull();
  });

  it('treats a 404 (RBAC disabled, route absent) as not-required', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: 'not found' }));
    expect(await checkAuth()).toBe('not-required');
  });

  it('fails open to not-required on a network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await checkAuth()).toBe('not-required');
  });

  it('login stores the token and authenticates on success', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, adminUser));
    const ok = await login('  secret-token  ');
    expect(ok).toBe(true);
    expect(token()).toBe('secret-token'); // trimmed
    expect(window.localStorage.getItem('flexdeck_token')).toBe('secret-token');
    expect(authStatus()).toBe('authed');
  });

  it('login reports failure and the gate stays required on a bad token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, null));
    expect(await login('bad')).toBe(false);
    expect(authStatus()).toBe('required');
  });

  it('logout clears the token and re-opens the gate', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, adminUser));
    await login('good');
    logout();
    expect(token()).toBeNull();
    expect(currentUser()).toBeNull();
    expect(authStatus()).toBe('required');
  });

  it('notifyUnauthorized re-opens the gate from an authed session', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, adminUser));
    await checkAuth();
    expect(authStatus()).toBe('authed');
    notifyUnauthorized();
    expect(authStatus()).toBe('required');
  });

  it('notifyUnauthorized leaves a known non-RBAC deployment untouched', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    await checkAuth();
    expect(authStatus()).toBe('not-required');
    notifyUnauthorized();
    expect(authStatus()).toBe('not-required');
  });
});
