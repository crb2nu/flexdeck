import { Component, For, createEffect, createSignal, Show, lazy, Suspense } from "solid-js";
import { healthStore } from "../../stores/health";
import UsersTab from "./UsersTab";
import AuditTab from "./AuditTab";
import ClustersTab from "./ClustersTab";
import { getAdminTabs, getDefaultAdminTab } from "../../lib/featureFlags";
import { PageHeader, TabBar, LoadingState } from "../shared";

const FlexInferTab = lazy(() => import("./FlexInferTab"));

type Tab = "users" | "audit" | "clusters" | "flexinfer";

const Admin: Component = () => {
  const rbacEnabled = () => healthStore.features?.rbac?.enabled ?? false;
  const auditEnabled = () => healthStore.features?.audit?.enabled ?? false;
  const clustersEnabled = () => healthStore.features?.multi_cluster?.enabled ?? false;
  const flexinferEnabled = () => healthStore.features?.flexinfer_proxy?.enabled ?? false;

  // Default to the first enabled tab
  const defaultTab = (): Tab => getDefaultAdminTab(healthStore.features || {});

  const [activeTab, setActiveTab] = createSignal<Tab>(defaultTab());

  const tabs = () => getAdminTabs(healthStore.features || {});

  createEffect(() => {
    const enabledTabs = tabs();
    if (enabledTabs.length === 0) return;
    const isActiveEnabled = enabledTabs.some((tab) => tab.id === activeTab());
    if (!isActiveEnabled) {
      setActiveTab(enabledTabs[0].id);
    }
  });

  return (
    <div class="h-full min-h-0 overflow-y-auto space-y-4">
      {/* Page header */}
      <PageHeader title="Admin" accent="Panel" />

      {/* Tab bar */}
      <TabBar
        tabs={tabs().map(t => ({ id: t.id, label: t.label }))}
        active={activeTab()}
        onChange={setActiveTab}
      />

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
        <Show when={activeTab() === "flexinfer" && flexinferEnabled()}>
          <Suspense fallback={<LoadingState message="Loading FlexInfer..." />}>
            <FlexInferTab />
          </Suspense>
        </Show>
      </div>

      <Show
        when={!rbacEnabled() && !auditEnabled() && !clustersEnabled() && !flexinferEnabled()}
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
