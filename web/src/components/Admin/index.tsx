import { Component, For, createEffect, createSignal, Show } from "solid-js";
import { healthStore } from "../../stores/health";
import UsersTab from "./UsersTab";
import AuditTab from "./AuditTab";
import ClustersTab from "./ClustersTab";

type Tab = "users" | "audit" | "clusters";

const Admin: Component = () => {
  const rbacEnabled = () => healthStore.features?.rbac?.enabled ?? false;
  const auditEnabled = () => healthStore.features?.audit?.enabled ?? false;
  const clustersEnabled = () =>
    healthStore.features?.multi_cluster?.enabled ?? false;

  // Default to the first enabled tab
  const defaultTab = (): Tab => {
    if (rbacEnabled()) return "users";
    if (auditEnabled()) return "audit";
    if (clustersEnabled()) return "clusters";
    return "users";
  };

  const [activeTab, setActiveTab] = createSignal<Tab>(defaultTab());

  const tabs = () => {
    const t: { id: Tab; label: string; enabled: boolean }[] = [];
    t.push({ id: "users", label: "Users", enabled: rbacEnabled() });
    t.push({ id: "audit", label: "Audit Log", enabled: auditEnabled() });
    t.push({
      id: "clusters",
      label: "Clusters",
      enabled: clustersEnabled(),
    });
    return t.filter((tab) => tab.enabled);
  };

  createEffect(() => {
    const enabledTabs = tabs();
    if (enabledTabs.length === 0) return;
    const isActiveEnabled = enabledTabs.some((tab) => tab.id === activeTab());
    if (!isActiveEnabled) {
      setActiveTab(enabledTabs[0].id);
    }
  });

  return (
    <div class="h-full overflow-y-auto space-y-4">
      {/* Page header */}
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold tracking-tight text-white">
          Admin<span class="text-neon-cyan">Panel</span>
        </h2>
      </div>

      {/* Tab bar */}
      <div class="flex items-center gap-1 bg-white/5 rounded-lg p-1 border border-white/5 w-fit">
        <For each={tabs()}>
          {(tab) => (
            <button
              class="rounded-md px-4 py-1.5 text-xs font-mono transition-all duration-200"
              classList={{
                "bg-white/10 text-white shadow-sm": activeTab() === tab.id,
                "text-text-muted hover:text-white hover:bg-white/5":
                  activeTab() !== tab.id,
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </div>

      {/* Tab content */}
      <div class="min-h-0">
        <Show when={activeTab() === "users" && rbacEnabled()}>
          <UsersTab />
        </Show>
        <Show when={activeTab() === "audit" && auditEnabled()}>
          <AuditTab />
        </Show>
        <Show when={activeTab() === "clusters" && clustersEnabled()}>
          <ClustersTab />
        </Show>
      </div>

      <Show
        when={!rbacEnabled() && !auditEnabled() && !clustersEnabled()}
      >
        <div class="flex flex-col items-center justify-center py-16 text-text-dim">
          <div class="text-4xl mb-4 opacity-20">&#9881;</div>
          <div class="text-sm font-mono">No admin features enabled</div>
          <div class="text-xs mt-2 max-w-md text-center">
            Enable RBAC, Audit, or Multi-Cluster via environment variables to
            use the admin panel.
          </div>
        </div>
      </Show>
    </div>
  );
};

export default Admin;
