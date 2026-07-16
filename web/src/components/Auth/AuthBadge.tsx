import { Component, Show } from 'solid-js';
import { currentUser, logout } from '../../stores/auth';

/**
 * AuthBadge shows the signed-in RBAC user and a logout control in the header.
 * It renders nothing when no user is authenticated (RBAC disabled or logged out).
 */
const AuthBadge: Component = () => (
  <Show when={currentUser()}>
    {(user) => (
      <div class="hidden items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1 sm:flex">
        <div class="flex flex-col leading-tight">
          <span class="text-xs font-medium text-text-main">{user().username}</span>
          <span class="text-[10px] uppercase tracking-wide text-text-dim">
            {user().authVia === 'network' ? 'trusted network' : user().role}
          </span>
        </div>
        <Show when={user().authVia !== 'network'}>
          <button
            type="button"
            onClick={() => logout()}
            class="rounded px-1.5 py-0.5 text-[11px] font-medium text-text-muted transition-colors hover:text-status-error"
            title="Sign out"
          >
            Sign out
          </button>
        </Show>
      </div>
    )}
  </Show>
);

export default AuthBadge;
