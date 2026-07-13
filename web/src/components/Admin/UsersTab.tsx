import {
  Component,
  createSignal,
  createResource,
  createUniqueId,
  Show,
} from "solid-js";
import { rbacApi } from "../../lib/api";
import type { RBACUser } from "../../lib/types";
import {
  Button,
  Input,
  Select,
  DataTable,
  LoadingState,
  ErrorState,
  type ColumnDef,
} from "../shared";
import { showToast, ToastContainer } from "../shared/Toast";

const ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Admin" },
];

const UsersTab: Component = () => {
  const [users, { refetch }] = createResource(() => rbacApi.listUsers());

  const [showCreate, setShowCreate] = createSignal(false);
  const [newUsername, setNewUsername] = createSignal("");
  const [newRole, setNewRole] = createSignal("viewer");
  const [createdToken, setCreatedToken] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [editUser, setEditUser] = createSignal<RBACUser | null>(null);
  const [editRole, setEditRole] = createSignal("");
  const [editDisabled, setEditDisabled] = createSignal(false);
  const [updating, setUpdating] = createSignal(false);
  const [deletingId, setDeletingId] = createSignal<string | null>(null);

  const usernameId = createUniqueId();
  const createRoleId = createUniqueId();
  const editRoleId = createUniqueId();

  const userRows = (): RBACUser[] => {
    if (users.error) return [];
    return users.latest ?? [];
  };

  const errorText = (e: unknown, fallback: string): string => {
    if (e instanceof Error && e.message.trim() !== "") return e.message;
    return fallback;
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const username = newUsername();
      const result = await rbacApi.createUser({
        username,
        role: newRole(),
      });
      setCreatedToken(result.token);
      setNewUsername("");
      setNewRole("viewer");
      showToast(`User "${username}" created`, "success");
      refetch();
    } catch (e) {
      showToast(errorText(e, "Failed to create user"), "error");
    }
    setCreating(false);
  };

  const handleUpdate = async () => {
    const user = editUser();
    if (!user) return;
    setUpdating(true);
    try {
      await rbacApi.updateUser(user.id, {
        role: editRole(),
        disabled: editDisabled(),
      });
      setEditUser(null);
      showToast(`User "${user.username}" updated`, "success");
      refetch();
    } catch (e) {
      showToast(errorText(e, "Failed to update user"), "error");
    }
    setUpdating(false);
  };

  const handleDelete = async (id: string, username: string) => {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await rbacApi.deleteUser(id);
      showToast(`User "${username}" deleted`, "success");
      refetch();
    } catch (e) {
      showToast(errorText(e, "Failed to delete user"), "error");
    }
    setDeletingId(null);
  };

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      admin: "bg-red-500/20 text-red-400 border-red-500/30",
      editor: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
      viewer: "bg-white/10 text-white border-white/20",
    };
    return colors[role] || "bg-white/10 text-text-muted border-white/20";
  };

  const columns: ColumnDef<RBACUser>[] = [
    {
      id: "username",
      header: "Username",
      accessor: (u) => u.username,
      sortable: true,
      mono: true,
      cell: (value) => <span class="text-white">{value}</span>,
    },
    {
      id: "role",
      header: "Role",
      accessor: (u) => u.role,
      sortable: true,
      cell: (value, u) => (
        <span
          class={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-mono ${roleBadge(u.role)}`}
        >
          {value}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessor: (u) => (u.disabled ? "DISABLED" : "ACTIVE"),
      sortable: true,
      cell: (_value, u) => (
        <span
          class={`text-[10px] font-mono ${u.disabled ? "text-red-400" : "text-status-ok"}`}
        >
          {u.disabled ? "DISABLED" : "ACTIVE"}
        </span>
      ),
    },
    {
      id: "lastLogin",
      header: "Last Login",
      accessor: (u) => u.lastLogin ?? "",
      sortable: true,
      cell: (_value, u) => (
        <span class="font-mono text-xs text-text-dim">
          {u.lastLogin ? new Date(u.lastLogin).toLocaleString() : "Never"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      accessor: () => "",
      align: "right",
      cell: (_value, u) => (
        <span class="inline-flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditUser(u);
              setEditRole(u.role);
              setEditDisabled(u.disabled);
            }}
          >
            Edit
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={deletingId() === u.id}
            onClick={() => handleDelete(u.id, u.username)}
          >
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div class="space-y-4">
      {/* Header */}
      <div class="flex items-center justify-between">
        <h3 class="heading-label">User Management</h3>
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            setShowCreate(true);
            setCreatedToken("");
          }}
        >
          + New user
        </Button>
      </div>

      {/* Create panel */}
      <Show when={showCreate()}>
        <div class="surface p-4 space-y-3">
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(createdToken())}
                  >
                    Copy
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowCreate(false);
                    setCreatedToken("");
                  }}
                >
                  Close
                </Button>
              </div>
            }
          >
            <div class="flex items-end gap-3">
              <div class="flex-1">
                <label for={usernameId} class="heading-label block mb-1">
                  Username
                </label>
                <Input
                  id={usernameId}
                  type="text"
                  value={newUsername()}
                  onInput={(e) => setNewUsername(e.currentTarget.value)}
                  placeholder="username"
                />
              </div>
              <div>
                <label for={createRoleId} class="heading-label block mb-1">
                  Role
                </label>
                <Select
                  id={createRoleId}
                  options={ROLE_OPTIONS}
                  value={newRole()}
                  onChange={(e) => setNewRole(e.currentTarget.value)}
                />
              </div>
              <Button
                variant="primary"
                loading={creating()}
                disabled={!newUsername()}
                onClick={handleCreate}
              >
                Create
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </Show>
        </div>
      </Show>

      {/* Edit panel */}
      <Show when={editUser()}>
        {(user) => (
          <div class="surface p-4 space-y-3">
            <div class="text-xs text-text-muted font-mono">
              Editing: {user().username}
            </div>
            <div class="flex items-end gap-3">
              <div>
                <label for={editRoleId} class="heading-label block mb-1">
                  Role
                </label>
                <Select
                  id={editRoleId}
                  options={ROLE_OPTIONS}
                  value={editRole()}
                  onChange={(e) => setEditRole(e.currentTarget.value)}
                />
              </div>
              <label class="flex items-center gap-2 py-2 text-xs text-text-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={editDisabled()}
                  onChange={(e) => setEditDisabled(e.currentTarget.checked)}
                  class="accent-white"
                />
                Disabled
              </label>
              <Button
                variant="primary"
                loading={updating()}
                onClick={handleUpdate}
              >
                Save
              </Button>
              <Button variant="ghost" onClick={() => setEditUser(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </Show>

      {/* Users table */}
      <Show
        when={!users.error}
        fallback={
          <ErrorState
            message={errorText(users.error, "Failed to load users")}
            variant="banner"
            onRetry={() => refetch()}
          />
        }
      >
        <Show
          when={!users.loading || users.latest}
          fallback={<LoadingState message="Loading users..." />}
        >
          <div class="surface overflow-hidden">
            <DataTable
              data={userRows()}
              persistKey="admin.users"
              columns={columns}
              rowKey={(u) => u.id}
              stickyHeader={false}
              emptyTitle="No users found"
            />
          </div>
        </Show>
      </Show>

      <ToastContainer />
    </div>
  );
};

export default UsersTab;
