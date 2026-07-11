import { Component, Show } from 'solid-js';
import { TabBar, ErrorState, SkeletonTable } from '../shared';
import PageHeader from '../shared/PageHeader';
import Input from '../shared/Input';
import Select from '../shared/Select';
import Button from '../shared/Button';
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

  const searchIcon = (
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );

  return (
    <div class="flex h-full min-h-0 flex-col gap-4">
      <PageHeader title="Services" />

      {/* Controls */}
      <div class="surface flex flex-col gap-3 px-4 py-3">
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
          <Input
            class="flex-1 max-w-xs"
            placeholder="Search by name..."
            value={searchTerm()}
            onInput={(e) => setSearchTerm(e.currentTarget.value)}
            icon={searchIcon}
            onClear={searchTerm() ? () => setSearchTerm('') : undefined}
          />

          <Select
            value={namespaceFilter()}
            onChange={(e) => setNamespaceFilter(e.currentTarget.value)}
            placeholder="All namespaces"
            options={namespaces().map((ns: string) => ({ value: ns, label: ns }))}
          />

          <Show when={searchTerm() || namespaceFilter()}>
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          </Show>
        </div>
      </div>

      {/* Content */}
      <div class="surface flex-1 overflow-auto">
        <Show when={loading()}>
          <SkeletonTable rows={8} />
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
