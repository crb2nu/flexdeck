import { Component, createMemo, For, Show, lazy, Suspense } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { healthStore } from "../../stores/health";
import UsersTab from "./UsersTab";
import AuditTab from "./AuditTab";
import ClustersTab from "./ClustersTab";
import { getAdminTabs, getDefaultAdminTab, type FeatureState } from "../../lib/featureFlags";
import { Badge, PageHeader, TabBar, LoadingState, type BadgeTone } from "../shared";

const FlexInferTab = lazy(() => import("./FlexInferTab"));

type Tab = "users" | "audit" | "clusters" | "flexinfer";

interface ReadinessItem {
  key: "audit" | "multi_cluster";
  label: string;
  feature?: FeatureState;
}

function readinessBadge(feature: FeatureState | undefined): { label: string; tone: BadgeTone } {
  if (feature?.enabled) return { label: "Ready", tone: "ok" };
  switch (feature?.mode) {
    case "disabled":
      return { label: "Flag off", tone: "default" };
    case "missing_store":
      return { label: "Store missing", tone: "warn" };
    case "missing_registry":
      return { label: "Registry missing", tone: "warn" };
    case "unconfigured":
      return { label: "Unconfigured", tone: "warn" };
    case "blocked":
      return { label: "Blocked", tone: "warn" };
    default:
      return { label: "Unavailable", tone: "default" };
  }
}

function readinessDetail(item: ReadinessItem): string {
  if (item.feature?.reason) return item.feature.reason;
  if (item.feature?.enabled) return "Ready";
  return `${item.label} is unavailable`;
}

const Admin: Component = () => {
  const rbacEnabled = () => healthStore.features?.rbac?.enabled ?? false;
  const auditEnabled = () => healthStore.features?.audit?.enabled ?? false;
  const clustersEnabled = () => healthStore.features?.multi_cluster?.enabled ?? false;
  const flexinferEnabled = () => healthStore.features?.flexinfer_proxy?.enabled ?? false;

  // Default to the first enabled tab
  const defaultTab = (): Tab => getDefaultAdminTab(healthStore.features || {});

  const tabs = () => getAdminTabs(healthStore.features || {});

  // The active tab lives in the URL (?tab=audit) so refresh keeps your place
  // and tabs are deep-linkable; deriving from searchParams also re-applies the
  // tab on same-route navigations (palette). A requested tab that isn't
  // enabled (flag off, stale link) falls back to the first enabled tab.
  const [searchParams, setSearchParams] = useSearchParams<{ tab?: string }>();
  const activeTab = createMemo<Tab>(() => {
    const requested = searchParams.tab;
    return tabs().some((tab) => tab.id === requested) ? (requested as Tab) : defaultTab();
  });
  const setActiveTab = (tab: Tab) => setSearchParams({ tab });
  const readinessItems = createMemo<ReadinessItem[]>(() => {
    const items: ReadinessItem[] = [
      { key: "audit", label: "Audit Logs", feature: healthStore.features?.audit },
      { key: "multi_cluster", label: "Multi-Cluster", feature: healthStore.features?.multi_cluster },
    ];
    return items.filter((item) => item.feature && !item.feature.enabled && (item.feature.mode || item.feature.reason));
  });

  return (
    <div class="h-full min-h-0 overflow-y-auto space-y-4">
      {/* Page header */}
      <PageHeader title="Admin" accent="Panel" />

      <Show when={readinessItems().length > 0}>
        <div class="grid gap-2 md:grid-cols-2">
          <For each={readinessItems()}>
            {(item) => {
              const badge = () => readinessBadge(item.feature);
              return (
                <div class="surface flex min-h-20 items-center justify-between gap-3 px-4 py-3">
                  <div class="min-w-0">
                    <div class="heading-label mb-1">{item.label}</div>
                    <div class="truncate text-xs text-text-muted" title={readinessDetail(item)}>
                      {readinessDetail(item)}
                    </div>
                  </div>
                  <Badge tone={badge().tone} size="sm">{badge().label}</Badge>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={tabs().length > 0}>
        <TabBar
          tabs={tabs().map(t => ({ id: t.id, label: t.label }))}
          active={activeTab()}
          onChange={setActiveTab}
        />
      </Show>

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
