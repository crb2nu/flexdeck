import { Component, For, Show } from 'solid-js';
import { TabBar, LoadingState, ErrorState } from '../shared';
import { useServicesController } from './useServicesController';
import DeploymentsTable from './DeploymentsTable';
import StatefulSetsTable from './StatefulSetsTable';
import DaemonSetsTable from './DaemonSetsTable';
import JobsTable from './JobsTable';
import ServicesTable from './ServicesTable';
import IngressesTable from './IngressesTable';
import PVCTable from './PVCTable';
import ConfigMapsTable from './ConfigMapsTable';
import SecretsTable from './SecretsTable';

const Services: Component = () => {
  const {
    loading,
    error,
    namespaceFilter,
    setNamespaceFilter,
    searchTerm,
    setSearchTerm,
    activeTab,
    setActiveTab,
    namespaces,
    isReadOnly,
    filteredDeployments,
    filteredServices,
    filteredIngresses,
    filteredStatefulsets,
    filteredDaemonsets,
    filteredJobs,
    filteredPvcs,
    filteredConfigmaps,
    filteredSecrets,
    expandedCM,
    cmData,
    expandedSecret,
    secretData,
    revealedKeys,
    scaleDeployment,
    restartDeployment,
    toggleConfigMap,
    toggleSecret,
    toggleRevealKey,
    clearFilters,
    tabs,
  } = useServicesController();

  return (
    <div class="flex h-full min-h-0 flex-col gap-4">
      {/* Controls */}
      <div class="glass-panel corner-accents flex flex-col gap-3 px-4 py-3">
        {/* Tabs row */}
        <div class="flex items-center justify-between">
          <TabBar
            tabs={tabs.map(t => ({ id: t.id, label: t.label, count: t.count }))}
            active={activeTab()}
            onChange={setActiveTab}
          />
        </div>

        {/* Filters row */}
        <div class="flex items-center gap-3">
          {/* Search input */}
          <div class="flex items-center gap-2 flex-1 max-w-xs">
            <div class="relative flex-1">
              <input
                type="text"
                placeholder="Search by name..."
                value={searchTerm()}
                onInput={(e) => setSearchTerm(e.currentTarget.value)}
                class="w-full rounded-md bg-black/40 border border-white/10 px-3 py-1.5 pl-8 text-sm text-text-main placeholder-text-dim focus:border-neon-cyan focus:outline-none transition-colors"
              />
              <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <Show when={searchTerm()}>
                <button
                  onClick={() => setSearchTerm('')}
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-text-main"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </Show>
            </div>
          </div>

          {/* Namespace filter */}
          <select
            class="rounded-md bg-black/40 px-3 py-1.5 text-sm text-text-main border border-white/10 focus:border-neon-cyan focus:outline-none"
            value={namespaceFilter()}
            onChange={(e) => setNamespaceFilter(e.currentTarget.value)}
          >
            <option value="">All namespaces</option>
            <For each={namespaces()}>
              {(ns) => <option value={ns}>{ns}</option>}
            </For>
          </select>

          {/* Clear filters */}
          <Show when={searchTerm() || namespaceFilter()}>
            <button
              onClick={clearFilters}
              class="text-xs text-text-dim hover:text-neon-cyan transition-colors"
            >
              Clear filters
            </button>
          </Show>
        </div>
      </div>

      {/* Content */}
      <div class="glass-panel corner-accents flex-1 overflow-auto">
        <Show when={loading()}>
          <LoadingState size="lg" />
        </Show>

        <Show when={!loading() && error()}>
          <ErrorState message={error()!} variant="full" />
        </Show>

        <Show when={!loading() && !error() && activeTab() === 'deployments'}>
          <DeploymentsTable
            deployments={filteredDeployments()}
            readOnly={isReadOnly()}
            onScale={scaleDeployment}
            onRestart={restartDeployment}
          />
        </Show>

        <Show when={!loading() && !error() && activeTab() === 'statefulsets'}>
          <StatefulSetsTable statefulsets={filteredStatefulsets()} />
        </Show>

        <Show when={!loading() && !error() && activeTab() === 'daemonsets'}>
          <DaemonSetsTable daemonsets={filteredDaemonsets()} />
        </Show>

        <Show when={!loading() && !error() && activeTab() === 'jobs'}>
          <JobsTable jobs={filteredJobs()} />
        </Show>

        <Show when={!loading() && !error() && activeTab() === 'services'}>
          <ServicesTable services={filteredServices()} />
        </Show>

        <Show when={!loading() && !error() && activeTab() === 'ingresses'}>
          <IngressesTable ingresses={filteredIngresses()} />
        </Show>

        <Show when={!loading() && !error() && activeTab() === 'storage'}>
          <PVCTable pvcs={filteredPvcs()} />
        </Show>

        <Show when={!loading() && !error() && activeTab() === 'configmaps'}>
          <ConfigMapsTable
            configmaps={filteredConfigmaps()}
            expanded={expandedCM()}
            cmData={cmData()}
            onToggle={toggleConfigMap}
          />
        </Show>

        <Show when={!loading() && !error() && activeTab() === 'secrets'}>
          <SecretsTable
            secrets={filteredSecrets()}
            expanded={expandedSecret()}
            secretData={secretData()}
            revealedKeys={revealedKeys()}
            onToggle={toggleSecret}
            onRevealKey={toggleRevealKey}
          />
        </Show>
      </div>
    </div>
  );
};

export default Services;
