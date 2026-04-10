import {
  Component,
  createSignal,
  createResource,
  Show,
  For,
} from "solid-js";
import { rbacApi } from "../../lib/api";
import type { RBACUser } from "../../lib/types";

const UsersTab: Component = () => {
  const [users, { refetch }] = createResource(async () => {
    try {
      return await rbacApi.listUsers();
    } catch {
      return [];
    }
  });

  const [showCreate, setShowCreate] = createSignal(false);
  const [newUsername, setNewUsername] = createSignal("");
  const [newRole, setNewRole] = createSignal("viewer");
  const [createdToken, setCreatedToken] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [editUser, setEditUser] = createSignal<RBACUser | null>(null);
  const [editRole, setEditRole] = createSignal("");
  const [editDisabled, setEditDisabled] = createSignal(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const result = await rbacApi.createUser({
        username: newUsername(),
        role: newRole(),
      });
      setCreatedToken(result.token);
      setNewUsername("");
      setNewRole("viewer");
      refetch();
    } catch (e: any) {
      alert(e.message || "Failed to create user");
    }
    setCreating(false);
  };

  const handleUpdate = async () => {
    const user = editUser();
    if (!user) return;
    try {
      await rbacApi.updateUser(user.id, {
        role: editRole(),
        disabled: editDisabled(),
      });
      setEditUser(null);
      refetch();
    } catch (e: any) {
      alert(e.message || "Failed to update user");
    }
  };

  const handleDelete = async (id: string, username: string) => {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try {
      await rbacApi.deleteUser(id);
      refetch();
    } catch (e: any) {
      alert(e.message || "Failed to delete user");
    }
  };

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      admin: "bg-red-500/20 text-red-400 border-red-500/30",
      editor: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      viewer: "bg-white/10 text-white border-white/20",
    };
    return colors[role] || "bg-white/10 text-text-muted border-white/20";
  };

  return (
    <div class="space-y-4">
      {/* Header */}
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-mono text-text-muted tracking-wider">
          USER MANAGEMENT
        </h3>
        <button
          class="rounded-md bg-white/10 border border-white/20 px-3 py-1.5 text-xs font-mono text-white hover:bg-white/15 transition-colors"
          onClick={() => {
            setShowCreate(true);
            setCreatedToken("");
          }}
        >
          + NEW USER
        </button>
      </div>

      {/* Create modal */}
      <Show when={showCreate()}>
        <div class="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
          <Show
            when={!createdToken()}
            fallback={
              <div class="space-y-2">
                <div class="text-xs text-status-ok font-mono">
                  User created! Copy the token now — it won't be shown again.
                </div>
                <div class="flex items-center gap-2 rounded bg-black/40 p-2">
                  <code class="flex-1 text-xs text-white font-mono break-all">
                    {createdToken()}
                  </code>
                  <button
                    class="text-xs text-text-muted hover:text-white"
                    onClick={() => navigator.clipboard.writeText(createdToken())}
                  >
                    Copy
                  </button>
                </div>
                <button
                  class="text-xs text-text-dim hover:text-white"
                  onClick={() => {
                    setShowCreate(false);
                    setCreatedToken("");
                  }}
                >
                  Close
                </button>
              </div>
            }
          >
            <div class="flex items-end gap-3">
              <div class="flex-1">
                <label class="text-[10px] text-text-dim block mb-1">
                  USERNAME
                </label>
                <input
                  type="text"
                  class="w-full rounded border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white font-mono focus:border-white/20 focus:outline-none"
                  value={newUsername()}
                  onInput={(e) => setNewUsername(e.currentTarget.value)}
                  placeholder="username"
                />
              </div>
              <div>
                <label class="text-[10px] text-text-dim block mb-1">ROLE</label>
                <select
                  class="rounded border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white font-mono focus:border-white/20 focus:outline-none"
                  value={newRole()}
                  onChange={(e) => setNewRole(e.currentTarget.value)}
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                class="rounded bg-white/10 border border-white/20 px-4 py-1.5 text-xs text-white font-mono hover:bg-white/15 disabled:opacity-50"
                onClick={handleCreate}
                disabled={creating() || !newUsername()}
              >
                {creating() ? "..." : "Create"}
              </button>
              <button
                class="text-xs text-text-dim hover:text-white px-2 py-1.5"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
            </div>
          </Show>
        </div>
      </Show>

      {/* Edit modal */}
      <Show when={editUser()}>
        {(user) => (
          <div class="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
            <div class="text-xs text-text-muted font-mono">
              Editing: {user().username}
            </div>
            <div class="flex items-end gap-3">
              <div>
                <label class="text-[10px] text-text-dim block mb-1">ROLE</label>
                <select
                  class="rounded border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white font-mono"
                  value={editRole()}
                  onChange={(e) => setEditRole(e.currentTarget.value)}
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <label class="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={editDisabled()}
                  onChange={(e) => setEditDisabled(e.currentTarget.checked)}
                  class="accent-white"
                />
                Disabled
              </label>
              <button
                class="rounded bg-white/10 border border-white/20 px-4 py-1.5 text-xs text-white font-mono"
                onClick={handleUpdate}
              >
                Save
              </button>
              <button
                class="text-xs text-text-dim hover:text-white px-2 py-1.5"
                onClick={() => setEditUser(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Show>

      {/* Users table */}
      <div class="rounded-lg border border-white/5 overflow-hidden">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-white/5 bg-white/[0.02]">
              <th class="px-4 py-2.5 text-left text-[10px] text-text-dim tracking-wider font-normal">
                USERNAME
              </th>
              <th class="px-4 py-2.5 text-left text-[10px] text-text-dim tracking-wider font-normal">
                ROLE
              </th>
              <th class="px-4 py-2.5 text-left text-[10px] text-text-dim tracking-wider font-normal">
                STATUS
              </th>
              <th class="px-4 py-2.5 text-left text-[10px] text-text-dim tracking-wider font-normal">
                LAST LOGIN
              </th>
              <th class="px-4 py-2.5 text-right text-[10px] text-text-dim tracking-wider font-normal">
                ACTIONS
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={users() || []} fallback={
              <tr>
                <td colspan="5" class="px-4 py-6 text-center text-text-dim">
                  No users found
                </td>
              </tr>
            }>
              {(user) => (
                <tr class="border-b border-white/5 hover:bg-white/[0.02]">
                  <td class="px-4 py-2.5 font-mono text-white">
                    {user.username}
                  </td>
                  <td class="px-4 py-2.5">
                    <span
                      class={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-mono ${roleBadge(user.role)}`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td class="px-4 py-2.5">
                    <span
                      class={`text-[10px] font-mono ${user.disabled ? "text-red-400" : "text-status-ok"}`}
                    >
                      {user.disabled ? "DISABLED" : "ACTIVE"}
                    </span>
                  </td>
                  <td class="px-4 py-2.5 text-text-dim font-mono">
                    {user.lastLogin
                      ? new Date(user.lastLogin).toLocaleString()
                      : "Never"}
                  </td>
                  <td class="px-4 py-2.5 text-right space-x-2">
                    <button
                      class="text-text-dim hover:text-white transition-colors"
                      onClick={() => {
                        setEditUser(user);
                        setEditRole(user.role);
                        setEditDisabled(user.disabled);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      class="text-text-dim hover:text-red-400 transition-colors"
                      onClick={() => handleDelete(user.id, user.username)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UsersTab;
