import {
  Component,
  createSignal,
  createResource,
  createUniqueId,
  Show,
  For,
} from "solid-js";
import { clustersApi } from "../../lib/api";
import { Button, Input, ErrorState, LoadingState, EmptyState } from "../shared";
import { showToast, ToastContainer } from "../shared/Toast";

const ClustersTab: Component = () => {
  // Surface list failures via clusters.error instead of masking them as an
  // empty registry.
  const [clusters, { refetch }] = createResource(() => clustersApi.list());

  const [showAdd, setShowAdd] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [newHost, setNewHost] = createSignal("");
  const [newToken, setNewToken] = createSignal("");
  const [newNamespace, setNewNamespace] = createSignal("default");
  const [testing, setTesting] = createSignal<string | null>(null);
  const [adding, setAdding] = createSignal(false);
  const [settingDefaultId, setSettingDefaultId] = createSignal<string | null>(null);
  const [deletingId, setDeletingId] = createSignal<string | null>(null);

  const nameId = createUniqueId();
  const hostId = createUniqueId();
  const tokenId = createUniqueId();
  const namespaceId = createUniqueId();

  const errorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error && error.message.trim() !== "") {
      return error.message;
    }
    return fallback;
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      const name = newName().trim();
      await clustersApi.create({
        name,
        host: newHost().trim(),
        token: newToken().trim(),
        namespace: newNamespace().trim(),
      });
      setShowAdd(false);
      setNewName("");
      setNewHost("");
      setNewToken("");
      setNewNamespace("default");
      showToast(`Cluster "${name}" added`, "success");
      refetch();
    } catch (error) {
      showToast(errorMessage(error, "Failed to add cluster"), "error");
    }
    setAdding(false);
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await clustersApi.test(id);
      if (result.ok) {
        showToast("Connection successful", "success");
      } else {
        showToast(`Connection failed: ${result.error}`, "error");
      }
      refetch();
    } catch (error) {
      showToast(errorMessage(error, "Test failed"), "error");
    }
    setTesting(null);
  };

  const handleSetDefault = async (id: string) => {
    setSettingDefaultId(id);
    try {
      await clustersApi.setDefault(id);
      showToast("Default cluster updated", "success");
      refetch();
    } catch (error) {
      showToast(errorMessage(error, "Failed to set default"), "error");
    }
    setSettingDefaultId(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete cluster "${name}"?`)) return;
    setDeletingId(id);
    try {
      await clustersApi.delete(id);
      showToast(`Cluster "${name}" deleted`, "success");
      refetch();
    } catch (error) {
      showToast(errorMessage(error, "Failed to delete cluster"), "error");
    }
    setDeletingId(null);
  };

  const statusColor = (status: string) => {
    if (status === "connected") return "bg-status-ok";
    if (status === "disconnected") return "bg-red-500";
    return "bg-yellow-500";
  };

  return (
    <div class="space-y-4">
      {/* Header */}
      <div class="flex items-center justify-between">
        <h3 class="heading-label">Cluster Registry</h3>
        <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
          + Add cluster
        </Button>
      </div>

      {/* Add cluster form */}
      <Show when={showAdd()}>
        <div class="surface p-4 space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for={nameId} class="heading-label block mb-1">
                Name
              </label>
              <Input
                id={nameId}
                type="text"
                value={newName()}
                onInput={(e) => setNewName(e.currentTarget.value)}
                placeholder="production"
              />
            </div>
            <div>
              <label for={hostId} class="heading-label block mb-1">
                Host
              </label>
              <Input
                id={hostId}
                type="text"
                value={newHost()}
                onInput={(e) => setNewHost(e.currentTarget.value)}
                placeholder="https://k8s.example.com:6443"
              />
            </div>
            <div>
              <label for={tokenId} class="heading-label block mb-1">
                Bearer Token
              </label>
              <Input
                id={tokenId}
                type="password"
                value={newToken()}
                onInput={(e) => setNewToken(e.currentTarget.value)}
                placeholder="eyJ..."
              />
            </div>
            <div>
              <label for={namespaceId} class="heading-label block mb-1">
                Default Namespace
              </label>
              <Input
                id={namespaceId}
                type="text"
                value={newNamespace()}
                onInput={(e) => setNewNamespace(e.currentTarget.value)}
              />
            </div>
          </div>
          <div class="flex gap-2">
            <Button
              variant="primary"
              loading={adding()}
              disabled={!newName().trim() || !newHost().trim()}
              onClick={handleAdd}
            >
              Add Cluster
            </Button>
            <Button variant="ghost" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Show>

      {/* Cluster cards */}
      <Show when={clusters.error}>
        <ErrorState message="Failed to load clusters." onRetry={() => refetch()} />
      </Show>
      <Show when={!clusters.error && clusters.loading && !clusters.latest}>
        <LoadingState size="sm" />
      </Show>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <For
          each={clusters.error ? [] : clusters.latest || []}
          fallback={
            <Show when={!clusters.error && !clusters.loading}>
              <div class="col-span-full">
                <EmptyState size="sm" title="No clusters found" subtitle="Register a cluster to manage it from FlexDeck." />
              </div>
            </Show>
          }
        >
          {(cluster) => (
            <div class="surface p-4 space-y-3">
              {/* Name + status */}
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span
                    class={`h-2 w-2 rounded-full ${statusColor(cluster.status)}`}
                  />
                  <span class="text-sm font-mono text-white">
                    {cluster.name}
                  </span>
                </div>
                <Show when={cluster.isDefault}>
                  <span class="text-[9px] text-text-muted border border-white/20 rounded px-1.5 py-0.5 font-mono">
                    DEFAULT
                  </span>
                </Show>
              </div>

              {/* Details */}
              <div class="space-y-1 text-[10px] text-text-dim font-mono">
                <div class="truncate">HOST: {cluster.host}</div>
                <div>NS: {cluster.namespace}</div>
                <div class="flex items-center gap-2">
                  <span>STATUS: </span>
                  <span
                    class={
                      cluster.status === "connected"
                        ? "text-status-ok"
                        : cluster.status === "disconnected"
                          ? "text-red-400"
                          : "text-yellow-400"
                    }
                  >
                    {cluster.status.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div class="flex items-center gap-2 pt-2 border-t border-white/5">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={testing() === cluster.id}
                  onClick={() => handleTest(cluster.id)}
                >
                  Test
                </Button>
                <Show when={!cluster.isDefault}>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={settingDefaultId() === cluster.id}
                    onClick={() => handleSetDefault(cluster.id)}
                  >
                    Set default
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    class="ml-auto"
                    loading={deletingId() === cluster.id}
                    onClick={() => handleDelete(cluster.id, cluster.name)}
                  >
                    Delete
                  </Button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>

      <ToastContainer />
    </div>
  );
};

export default ClustersTab;
