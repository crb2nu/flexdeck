import { Component, createSignal, createResource, Show, For } from "solid-js";
import { clustersApi, activeClusterId, switchCluster } from "../../lib/api";
import { healthStore } from "../../stores/health";
import type { ClusterInfo } from "../../lib/types";

const ClusterSelector: Component = () => {
  const [open, setOpen] = createSignal(false);
  const enabled = () => healthStore.features?.multi_cluster?.enabled ?? false;

  const [clusters, { refetch }] = createResource(
    () => enabled(),
    async (isEnabled) => {
      if (!isEnabled) return [];
      try {
        return await clustersApi.list();
      } catch {
        return [];
      }
    },
  );

  const currentCluster = (): ClusterInfo | undefined => {
    const id = activeClusterId();
    if (!id) return clusters()?.find((c) => c.isDefault);
    return clusters()?.find((c) => c.id === id);
  };

  const statusColor = (status: string) => {
    if (status === "connected") return "bg-neon-green";
    if (status === "disconnected") return "bg-red-500";
    return "bg-yellow-500";
  };

  const handleSelect = (id: string) => {
    switchCluster(id);
    setOpen(false);
  };

  return (
    <Show when={enabled()}>
      <div class="relative">
        <button
          class="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-mono text-text-muted hover:text-white hover:border-neon-cyan/30 transition-colors"
          onClick={() => {
            refetch();
            setOpen(!open());
          }}
        >
          <span
            class={`h-1.5 w-1.5 rounded-full ${statusColor(currentCluster()?.status || "unknown")}`}
          />
          <span class="max-w-[120px] truncate">
            {currentCluster()?.name || "Select Cluster"}
          </span>
          <svg
            class="h-3 w-3 opacity-50"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M3 5l3 3 3-3"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>

        <Show when={open()}>
          <div class="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-white/10 bg-bg-panel/95 backdrop-blur-md shadow-xl">
            <div class="p-2 border-b border-white/5">
              <div class="text-[10px] text-neon-cyan/50 tracking-widest px-2">
                CLUSTERS
              </div>
            </div>
            <div class="max-h-48 overflow-y-auto p-1">
              <For each={clusters() || []}>
                {(cluster) => (
                  <button
                    class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-white/5 transition-colors"
                    classList={{
                      "bg-neon-cyan/10 text-neon-cyan":
                        cluster.id === (activeClusterId() || currentCluster()?.id),
                      "text-text-muted": cluster.id !== (activeClusterId() || currentCluster()?.id),
                    }}
                    onClick={() => handleSelect(cluster.id)}
                  >
                    <span
                      class={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${statusColor(cluster.status)}`}
                    />
                    <span class="flex-1 truncate text-left font-mono">
                      {cluster.name}
                    </span>
                    <Show when={cluster.isDefault}>
                      <span class="text-[9px] text-neon-cyan/50 border border-neon-cyan/20 rounded px-1">
                        DEFAULT
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </div>
          {/* Click outside to close */}
          <div
            class="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
        </Show>
      </div>
    </Show>
  );
};

export default ClusterSelector;
