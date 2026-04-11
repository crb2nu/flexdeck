import {
  Component,
  createEffect,
  createSignal,
  createResource,
  Show,
  For,
} from "solid-js";
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
    const list = clusters() || [];
    if (!id) return list.find((c) => c.isDefault);
    return list.find((c) => c.id === id) || list.find((c) => c.isDefault);
  };

  createEffect(() => {
    if (!enabled()) {
      setOpen(false);
      return;
    }

    const selectedID = activeClusterId();
    if (!selectedID) return;

    const list = clusters() || [];
    if (list.length === 0) return;

    const stillExists = list.some((c) => c.id === selectedID);
    if (!stillExists) {
      const fallback = list.find((c) => c.isDefault);
      switchCluster(fallback?.id || "");
    }
  });

  const statusColor = (status: string) => {
    if (status === "connected") return "bg-status-ok";
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
          class="flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text-muted hover:text-white hover:bg-white/[0.08] transition-colors duration-150"
          onClick={() => {
            refetch();
            setOpen(!open());
          }}
        >
          <span
            class={`h-1.5 w-1.5 rounded-full ${statusColor(currentCluster()?.status || "unknown")}`}
          />
          <span class="max-w-[80px] sm:max-w-[120px] truncate">
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
          {/* Responsive container: Dropdown on desktop, Sheet on mobile */}
          <div
            class="fixed md:absolute inset-x-0 bottom-0 md:inset-auto md:right-0 md:top-full z-50 md:mt-1 flex w-full flex-col md:w-64 animate-slide-up md:animate-dropdown-in"
          >
            <div class="md:hidden absolute inset-0 z-0 bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setOpen(false)} />
            
            <div class="relative z-10 mt-auto md:mt-0 rounded-t-xl md:rounded-lg border-t md:border border-white/[0.12] bg-[rgba(8,14,28,0.96)] backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.5),0_0_1px_rgba(255,255,255,0.06)] overflow-hidden max-h-[70vh] md:max-h-none">
              <div class="p-4 md:p-2 border-b border-white/5 flex items-center justify-between">
                <div class="heading-label px-2">
                  Clusters
                </div>
                <button class="md:hidden p-2 text-text-dim" onClick={() => setOpen(false)}>✕</button>
              </div>
              <div class="max-h-64 md:max-h-48 overflow-y-auto p-2 md:p-1 flex flex-col gap-1">
                <For
                  each={clusters() || []}
                  fallback={
                    <div class="px-3 py-4 md:py-2 text-[11px] text-text-dim text-center">
                      No clusters available
                    </div>
                  }
                >
                  {(cluster) => (
                    <button
                      class="flex w-full items-center gap-3 md:gap-2 rounded-lg md:rounded-md px-4 md:px-3 py-3 md:py-2 text-sm md:text-xs hover:bg-white/5 transition-colors"
                      classList={{
                        "bg-white/10 text-white border border-white/20":
                          cluster.id === (activeClusterId() || currentCluster()?.id),
                        "text-text-muted border border-transparent": cluster.id !== (activeClusterId() || currentCluster()?.id),
                      }}
                      onClick={() => handleSelect(cluster.id)}
                    >
                      <span
                        class={`h-2 w-2 md:h-1.5 md:w-1.5 rounded-full flex-shrink-0 ${statusColor(cluster.status)}`}
                      />
                      <span class="flex-1 truncate text-left">
                        {cluster.name}
                      </span>
                      <Show when={cluster.isDefault}>
                        <span class="text-[9px] text-text-muted border border-white/20 rounded px-1">
                          DEFAULT
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
          
          {/* Desktop-only click outside to close */}
          <div
            class="hidden md:block fixed inset-0 z-40 animate-fade-in"
            onClick={() => setOpen(false)}
          />
        </Show>
      </div>
    </Show>
  );
};

export default ClusterSelector;
