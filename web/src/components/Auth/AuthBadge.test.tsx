/* @vitest-environment jsdom */

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(),
  user: null as null | {
    id: string;
    username: string;
    role: 'admin';
    createdAt: string;
    updatedAt: string;
    disabled: boolean;
    authVia?: 'network' | 'token';
  },
}));

vi.mock('../../stores/auth', () => ({
  currentUser: () => authMocks.user,
  logout: authMocks.logout,
}));

import AuthBadge from './AuthBadge';

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const dispose = render(() => <AuthBadge />, container);
  return () => {
    dispose();
    container.remove();
  };
}

describe('AuthBadge', () => {
  let cleanup: () => void = () => undefined;

  afterEach(() => {
    cleanup();
    cleanup = () => undefined;
    authMocks.user = null;
    authMocks.logout.mockReset();
    document.body.innerHTML = '';
  });

  it('shows trusted-network access without a misleading sign-out action', () => {
    authMocks.user = {
      id: 'trusted-network',
      username: 'Trusted network',
      role: 'admin',
      createdAt: '',
      updatedAt: '',
      disabled: false,
      authVia: 'network',
    };

    cleanup = mount();

    expect(document.body.textContent).toContain('Trusted network');
    expect(document.body.textContent).toContain('trusted network');
    expect(document.querySelector('button')).toBeNull();
  });

  it('keeps sign out for token-authenticated users', () => {
    authMocks.user = {
      id: 'admin-1',
      username: 'admin',
      role: 'admin',
      createdAt: '',
      updatedAt: '',
      disabled: false,
      authVia: 'token',
    };

    cleanup = mount();

    const button = document.querySelector('button');
    expect(button?.textContent).toContain('Sign out');
    button?.click();
    expect(authMocks.logout).toHaveBeenCalledTimes(1);
  });
});
