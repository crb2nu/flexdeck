import {
  Component,
  createSignal,
  createResource,
  Show,
  For,
} from "solid-js";
import { clustersApi } from "../../lib/api";

const ClustersTab: Component = () => {
  const [clusters, { refetch }] = createResource(async () => {
    try {
      return await clustersApi.list();
    } catch {
      return [];
    }
  });

  const [showAdd, setShowAdd] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [newHost, setNewHost] = createSignal("");
  const [newToken, setNewToken] = createSignal("");
  const [newNamespace, setNewNamespace] = createSignal("default");
  const [testing, setTesting] = createSignal<string | null>(null);
  const [adding, setAdding] = createSignal(false);

  const errorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof Error && error.message.trim() !== "") {
      return error.message;
    }
    return fallback;
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      await clustersApi.create({
        name: newName().trim(),
        host: newHost().trim(),
        token: newToken().trim(),
        namespace: newNamespace().trim(),
      });
      setShowAdd(false);
      setNewName("");
      setNewHost("");
      setNewToken("");
      setNewNamespace("default");
      refetch();
    } catch (error) {
      alert(errorMessage(error, "Failed to add cluster"));
    }
    setAdding(false);
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    try {
      const result = await clustersApi.test(id);
      if (result.ok) {
        alert("Connection successful!");
      } else {
        alert(`Connection failed: ${result.error}`);
      }
      refetch();
    } catch (error) {
      alert(errorMessage(error, "Test failed"));
    }
    setTesting(null);
  };

  const handleSetDefault = async (id: string) => {
    try {
      await clustersApi.setDefault(id);
      refetch();
    } catch (error) {
      alert(errorMessage(error, "Failed to set default"));
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete cluster "${name}"?`)) return;
    try {
      await clustersApi.delete(id);
      refetch();
    } catch (error) {
      alert(errorMessage(error, "Failed to delete cluster"));
    }
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
        <h3 class="text-sm font-mono text-text-muted tracking-wider">
          CLUSTER REGISTRY
        </h3>
        <button
          class="rounded-md bg-white/10 border border-white/20 px-3 py-1.5 text-xs font-mono text-white hover:bg-white/15 transition-colors"
          onClick={() => setShowAdd(true)}
        >
          + ADD CLUSTER
        </button>
      </div>

      {/* Add cluster form */}
      <Show when={showAdd()}>
        <div class="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-[10px] text-text-dim block mb-1">NAME</label>
              <input
                type="text"
                class="w-full rounded border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white font-mono focus:border-white/20 focus:outline-none"
                value={newName()}
                onInput={(e) => setNewName(e.currentTarget.value)}
                placeholder="production"
              />
            </div>
            <div>
              <label class="text-[10px] text-text-dim block mb-1">HOST</label>
              <input
                type="text"
                class="w-full rounded border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white font-mono focus:border-white/20 focus:outline-none"
                value={newHost()}
                onInput={(e) => setNewHost(e.currentTarget.value)}
                placeholder="https://k8s.example.com:6443"
              />
            </div>
            <div>
              <label class="text-[10px] text-text-dim block mb-1">
                BEARER TOKEN
              </label>
              <input
                type="password"
                class="w-full rounded border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white font-mono focus:border-white/20 focus:outline-none"
                value={newToken()}
                onInput={(e) => setNewToken(e.currentTarget.value)}
                placeholder="eyJ..."
              />
            </div>
            <div>
              <label class="text-[10px] text-text-dim block mb-1">
                DEFAULT NAMESPACE
              </label>
              <input
                type="text"
                class="w-full rounded border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white font-mono focus:border-white/20 focus:outline-none"
                value={newNamespace()}
                onInput={(e) => setNewNamespace(e.currentTarget.value)}
              />
            </div>
          </div>
          <div class="flex gap-2">
            <button
              class="rounded bg-white/10 border border-white/20 px-4 py-1.5 text-xs text-white font-mono hover:bg-white/15 disabled:opacity-50"
              onClick={handleAdd}
              disabled={!newName().trim() || !newHost().trim() || adding()}
            >
              {adding() ? "Adding..." : "Add Cluster"}
            </button>
            <button
              class="text-xs text-text-dim hover:text-white px-2 py-1.5"
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </Show>

      {/* Cluster cards */}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <For
          each={clusters() || []}
          fallback={
            <div class="col-span-full text-center text-text-dim text-sm py-8">
              No clusters registered
            </div>
          }
        >
          {(cluster) => (
            <div class="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
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
              <div class="flex gap-2 pt-1 border-t border-white/5">
                <button
                  class="text-[10px] text-text-dim hover:text-white font-mono"
                  onClick={() => handleTest(cluster.id)}
                  disabled={testing() === cluster.id}
                >
                  {testing() === cluster.id ? "TESTING..." : "TEST"}
                </button>
                <Show when={!cluster.isDefault}>
                  <button
                    class="text-[10px] text-text-dim hover:text-white font-mono"
                    onClick={() => handleSetDefault(cluster.id)}
                  >
                    SET DEFAULT
                  </button>
                  <button
                    class="text-[10px] text-text-dim hover:text-red-400 font-mono ml-auto"
                    onClick={() => handleDelete(cluster.id, cluster.name)}
                  >
                    DELETE
                  </button>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default ClustersTab;
