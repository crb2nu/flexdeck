import { Component, Show, createSignal, createMemo } from 'solid-js';
import { useInfraController } from './useInfraController';
import ComputeView from './ComputeView';
import StorageView from './StorageView';
import NetworkingView from './NetworkingView';
import GitOpsView from './GitOpsView';
import CapacityView from './CapacityView';
import { PageHeader, TabBar, LoadingState, ErrorState } from '../shared';

type Tab = 'compute' | 'storage' | 'networking' | 'gitops' | 'capacity';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'compute', label: 'Compute', icon: '⚙' },
  { id: 'storage', label: 'Storage', icon: '💽' },
  { id: 'networking', label: 'Networking', icon: '🌐' },
  { id: 'gitops', label: 'GitOps', icon: '🔧' },
  { id: 'capacity', label: 'Capacity', icon: '📊' },
];

const Infra: Component = () => {
  const [activeTab, setActiveTab] = createSignal<Tab>('compute');
  const { snapshot, loading, error, lastUpdated, trigger } = useInfraController();

  const snap = createMemo(() => snapshot());

  return (
    <div class="flex flex-col gap-4 p-4 sm:p-6">
      {/* Header */}
      <PageHeader
        title="Infrastructure"
        subtitle="Cluster-wide compute, storage, networking, and GitOps state"
        lastUpdated={String(lastUpdated())}
        onRefresh={trigger}
      />

      {/* Tabs */}
      <TabBar
        tabs={TABS.map(t => ({ id: t.id, label: t.label, icon: t.icon }))}
        active={activeTab()}
        onChange={setActiveTab}
        variant="underline"
      />

      {/* Loading state */}
      <Show when={loading() && !snap()}>
        <LoadingState message="Loading infrastructure snapshot..." />
      </Show>

      {/* Error state (no snapshot yet) */}
      <Show when={!!error() && !snap()}>
        <ErrorState message={error()!} variant="full" onRetry={trigger} />
      </Show>

      {/* Content */}
      <Show when={snap()}>
        {(s) => (
          <>
            <Show when={activeTab() === 'compute'}>
              <ComputeView snapshot={s().compute} />
            </Show>
            <Show when={activeTab() === 'storage'}>
              <StorageView snapshot={s().storage} />
            </Show>
            <Show when={activeTab() === 'networking'}>
              <NetworkingView snapshot={s().networking} />
            </Show>
            <Show when={activeTab() === 'gitops'}>
              <GitOpsView snapshot={s().gitops} />
            </Show>
            <Show when={activeTab() === 'capacity'}>
              <CapacityView snapshot={s().capacity} />
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

export default Infra;
