import { Component, For, Show } from 'solid-js';
import { formatRelativeTime } from '../../lib/format';
import type { K8sDeployment, K8sService, K8sIngress, K8sStatefulSet, K8sDaemonSet, K8sJob } from '../../lib/types';
import StatusDot from '../shared/StatusDot';
import type { Status } from '../shared/StatusDot';
import { useServicesController } from './useServicesController';

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
          <div class="flex gap-1 flex-wrap">
            <For each={tabs}>
              {(tab) => (
                <button
                  class={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                    activeTab() === tab.id
                      ? 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30'
                      : 'text-text-dim hover:bg-white/5 border border-transparent'
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                  <span class={`ml-1.5 ${activeTab() === tab.id ? 'text-neon-cyan/70' : 'text-text-dim/50'}`}>
                    {tab.count()}
                  </span>
                </button>
              )}
            </For>
          </div>
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
          <div class="flex h-full items-center justify-center">
            <div class="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan" />
          </div>
        </Show>

        <Show when={!loading() && error()}>
          <div class="flex h-full items-center justify-center text-status-error">
            {error()}
          </div>
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

// Helper to get deployment status
const getDeploymentStatus = (d: K8sDeployment): Status => {
  const ready = d.status?.readyReplicas || 0;
  const desired = d.spec?.replicas || 0;
  const updated = d.status?.updatedReplicas || 0;

  if (ready === desired && desired > 0) return 'ok';
  if (updated < desired) return 'scaling';
  if (ready > 0) return 'warn';
  if (ready === 0 && desired > 0) return 'error';
  return 'unknown';
};

// Deployments Table
interface DeploymentsTableProps {
  deployments: K8sDeployment[];
  readOnly: boolean;
  onScale: (ns: string, name: string, replicas: number) => void;
  onRestart: (ns: string, name: string) => void;
}

const DeploymentsTable: Component<DeploymentsTableProps> = (props) => (
  <Show
    when={props.deployments.length > 0}
    fallback={
      <div class="flex h-48 items-center justify-center text-text-dim">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <p>No deployments found</p>
        </div>
      </div>
    }
  >
    <table class="w-full text-sm">
      <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-surface-dark/95 backdrop-blur">
        <tr>
          <th class="px-4 py-3 w-8" />
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Namespace</th>
          <th class="px-4 py-3">Ready</th>
          <th class="px-4 py-3">Image</th>
          <th class="px-4 py-3">Age</th>
          <Show when={!props.readOnly}>
            <th class="px-4 py-3">Actions</th>
          </Show>
        </tr>
      </thead>
      <tbody>
        <For each={props.deployments}>
        {(d) => {
          const ready = d.status?.readyReplicas || 0;
          const desired = d.spec?.replicas || 0;
          const status = getDeploymentStatus(d);
          const image = d.spec?.template?.spec?.containers?.[0]?.image || '-';
          const shortImage = image.split('/').pop()?.split('@')[0] || image;

          return (
            <tr class="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
              <td class="px-4 py-3">
                <StatusDot status={status} />
              </td>
              <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                {d.metadata?.name}
              </td>
              <td class="px-4 py-3 text-text-dim">{d.metadata?.namespace}</td>
              <td class="px-4 py-3">
                <span class={status === 'ok' ? 'text-status-ok' : status === 'error' ? 'text-status-error' : 'text-status-warn'}>
                  {ready}/{desired}
                </span>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-text-muted" title={image}>
                {shortImage}
              </td>
              <td class="px-4 py-3 text-text-muted">
                {d.metadata?.creationTimestamp
                  ? formatRelativeTime(d.metadata.creationTimestamp)
                  : '-'}
              </td>
              <Show when={!props.readOnly}>
                <td class="px-4 py-3">
                  <div class="flex gap-2">
                    <button
                      class="rounded px-2 py-1 text-xs text-neon-cyan hover:bg-neon-cyan/10 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onScale(d.metadata?.namespace || 'default', d.metadata?.name || '', desired + 1);
                      }}
                    >
                      +
                    </button>
                    <button
                      class="rounded px-2 py-1 text-xs text-neon-yellow hover:bg-neon-yellow/10 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onScale(d.metadata?.namespace || 'default', d.metadata?.name || '', Math.max(0, desired - 1));
                      }}
                    >
                      -
                    </button>
                    <button
                      class="rounded px-2 py-1 text-xs text-neon-purple hover:bg-neon-purple/10 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onRestart(d.metadata?.namespace || 'default', d.metadata?.name || '');
                      }}
                    >
                      ↻
                    </button>
                  </div>
                </td>
              </Show>
            </tr>
          );
        }}
        </For>
      </tbody>
    </table>
  </Show>
);

// StatefulSets Table
const StatefulSetsTable: Component<{ statefulsets: K8sStatefulSet[] }> = (props) => (
  <Show
    when={props.statefulsets.length > 0}
    fallback={
      <div class="flex h-48 items-center justify-center text-text-dim">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p>No statefulsets found</p>
        </div>
      </div>
    }
  >
    <table class="w-full text-sm">
      <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-surface-dark/95 backdrop-blur">
        <tr>
          <th class="px-4 py-3 w-8" />
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Namespace</th>
          <th class="px-4 py-3">Ready</th>
          <th class="px-4 py-3">Service</th>
          <th class="px-4 py-3">Age</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.statefulsets}>
          {(s) => {
            const ready = s.status?.readyReplicas || 0;
            const desired = s.spec?.replicas || 0;
            const status: Status = ready === desired && desired > 0 ? 'ok' : ready > 0 ? 'warn' : ready === 0 && desired > 0 ? 'error' : 'unknown';

            return (
              <tr class="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
                <td class="px-4 py-3">
                  <StatusDot status={status} />
                </td>
                <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                  {s.metadata?.name}
                </td>
                <td class="px-4 py-3 text-text-dim">{s.metadata?.namespace}</td>
                <td class="px-4 py-3">
                  <span class={status === 'ok' ? 'text-status-ok' : status === 'error' ? 'text-status-error' : 'text-status-warn'}>
                    {ready}/{desired}
                  </span>
                </td>
                <td class="px-4 py-3 text-text-muted font-mono text-xs">
                  {s.spec?.serviceName || '-'}
                </td>
                <td class="px-4 py-3 text-text-muted">
                  {s.metadata?.creationTimestamp ? formatRelativeTime(s.metadata.creationTimestamp) : '-'}
                </td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  </Show>
);

// DaemonSets Table
const DaemonSetsTable: Component<{ daemonsets: K8sDaemonSet[] }> = (props) => (
  <Show
    when={props.daemonsets.length > 0}
    fallback={
      <div class="flex h-48 items-center justify-center text-text-dim">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
          </svg>
          <p>No daemonsets found</p>
        </div>
      </div>
    }
  >
    <table class="w-full text-sm">
      <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-surface-dark/95 backdrop-blur">
        <tr>
          <th class="px-4 py-3 w-8" />
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Namespace</th>
          <th class="px-4 py-3">Ready</th>
          <th class="px-4 py-3">Scheduled</th>
          <th class="px-4 py-3">Age</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.daemonsets}>
          {(d) => {
            const ready = d.status?.numberReady || 0;
            const desired = d.status?.desiredNumberScheduled || 0;
            const status: Status = ready === desired && desired > 0 ? 'ok' : ready > 0 ? 'warn' : ready === 0 && desired > 0 ? 'error' : 'unknown';

            return (
              <tr class="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
                <td class="px-4 py-3">
                  <StatusDot status={status} />
                </td>
                <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                  {d.metadata?.name}
                </td>
                <td class="px-4 py-3 text-text-dim">{d.metadata?.namespace}</td>
                <td class="px-4 py-3">
                  <span class={status === 'ok' ? 'text-status-ok' : status === 'error' ? 'text-status-error' : 'text-status-warn'}>
                    {ready}/{desired}
                  </span>
                </td>
                <td class="px-4 py-3 text-text-muted">
                  {d.status?.currentNumberScheduled || 0}/{d.status?.desiredNumberScheduled || 0}
                </td>
                <td class="px-4 py-3 text-text-muted">
                  {d.metadata?.creationTimestamp ? formatRelativeTime(d.metadata.creationTimestamp) : '-'}
                </td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  </Show>
);

// Jobs Table
const JobsTable: Component<{ jobs: K8sJob[] }> = (props) => {
  const getJobStatus = (j: K8sJob): Status => {
    if ((j.status?.succeeded || 0) > 0) return 'ok';
    if ((j.status?.failed || 0) > 0) return 'error';
    if ((j.status?.active || 0) > 0) return 'running';
    return 'pending';
  };

  return (
    <Show
      when={props.jobs.length > 0}
      fallback={
        <div class="flex h-48 items-center justify-center text-text-dim">
          <div class="text-center">
            <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <p>No jobs found</p>
          </div>
        </div>
      }
    >
      <table class="w-full text-sm">
        <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-surface-dark/95 backdrop-blur">
          <tr>
            <th class="px-4 py-3 w-8" />
            <th class="px-4 py-3">Name</th>
            <th class="px-4 py-3">Namespace</th>
            <th class="px-4 py-3">Status</th>
            <th class="px-4 py-3">Completions</th>
            <th class="px-4 py-3">Duration</th>
            <th class="px-4 py-3">Age</th>
          </tr>
        </thead>
        <tbody>
          <For each={props.jobs}>
            {(j) => {
              const status = getJobStatus(j);
              const succeeded = j.status?.succeeded || 0;
              const completions = j.spec?.completions || 1;

              // Calculate duration
              let duration = '-';
              if (j.status?.startTime) {
                const start = new Date(j.status.startTime);
                const end = j.status?.completionTime ? new Date(j.status.completionTime) : new Date();
                const diffSec = Math.floor((end.getTime() - start.getTime()) / 1000);
                if (diffSec < 60) duration = `${diffSec}s`;
                else if (diffSec < 3600) duration = `${Math.floor(diffSec / 60)}m`;
                else duration = `${Math.floor(diffSec / 3600)}h`;
              }

              return (
                <tr class="border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer group">
                  <td class="px-4 py-3">
                    <StatusDot status={status} />
                  </td>
                  <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                    {j.metadata?.name}
                  </td>
                  <td class="px-4 py-3 text-text-dim">{j.metadata?.namespace}</td>
                  <td class="px-4 py-3">
                    <span class={`px-2 py-0.5 rounded text-xs ${
                      status === 'ok' ? 'bg-status-ok/10 text-status-ok' :
                      status === 'error' ? 'bg-status-error/10 text-status-error' :
                      status === 'running' ? 'bg-neon-green/10 text-neon-green' :
                      'bg-white/5 text-text-muted'
                    }`}>
                      {status === 'ok' ? 'Complete' : status === 'error' ? 'Failed' : status === 'running' ? 'Running' : 'Pending'}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-text-muted">
                    {succeeded}/{completions}
                  </td>
                  <td class="px-4 py-3 text-text-muted font-mono text-xs">
                    {duration}
                  </td>
                  <td class="px-4 py-3 text-text-muted">
                    {j.metadata?.creationTimestamp ? formatRelativeTime(j.metadata.creationTimestamp) : '-'}
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </Show>
  );
};

// Services Table
const ServicesTable: Component<{ services: K8sService[] }> = (props) => (
  <Show
    when={props.services.length > 0}
    fallback={
      <div class="flex h-48 items-center justify-center text-text-dim">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
          <p>No services found</p>
        </div>
      </div>
    }
  >
    <table class="w-full text-sm">
      <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-surface-dark/95 backdrop-blur">
        <tr>
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Namespace</th>
          <th class="px-4 py-3">Type</th>
          <th class="px-4 py-3">Cluster IP</th>
          <th class="px-4 py-3">Ports</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.services}>
          {(s) => {
            const ports =
              s.spec?.ports?.map((p) => `${p.port}/${p.protocol}`).join(', ') || '-';

            return (
              <tr class="border-b border-white/5 hover:bg-white/5 transition-colors group">
                <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                  {s.metadata?.name}
                </td>
                <td class="px-4 py-3 text-text-dim">{s.metadata?.namespace}</td>
                <td class="px-4 py-3">
                  <span
                    class={`rounded px-2 py-0.5 text-xs ${
                      s.spec?.type === 'LoadBalancer'
                        ? 'bg-neon-cyan/10 text-neon-cyan'
                        : s.spec?.type === 'NodePort'
                          ? 'bg-neon-purple/10 text-neon-purple'
                          : 'bg-white/5 text-text-muted'
                    }`}
                  >
                    {s.spec?.type}
                  </span>
                </td>
                <td class="px-4 py-3 font-mono text-xs text-text-muted">
                  {s.spec?.clusterIP || '-'}
                </td>
                <td class="px-4 py-3 font-mono text-xs text-text-muted">{ports}</td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  </Show>
);

// Ingresses Table
const IngressesTable: Component<{ ingresses: K8sIngress[] }> = (props) => (
  <Show
    when={props.ingresses.length > 0}
    fallback={
      <div class="flex h-48 items-center justify-center text-text-dim">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <p>No ingresses found</p>
        </div>
      </div>
    }
  >
    <table class="w-full text-sm">
      <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-surface-dark/95 backdrop-blur">
        <tr>
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Namespace</th>
          <th class="px-4 py-3">Hosts</th>
          <th class="px-4 py-3">Class</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.ingresses}>
          {(i) => {
            const hosts = i.spec?.rules?.map((r) => r.host).filter(Boolean) || [];

            return (
              <tr class="border-b border-white/5 hover:bg-white/5 transition-colors group">
                <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                  {i.metadata?.name}
                </td>
                <td class="px-4 py-3 text-text-dim">{i.metadata?.namespace}</td>
                <td class="px-4 py-3">
                  <For each={hosts}>
                    {(host) => (
                      <a
                        href={`https://${host}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="mr-2 text-neon-cyan hover:underline"
                      >
                        {host}
                      </a>
                    )}
                  </For>
                </td>
                <td class="px-4 py-3 text-text-muted">
                  {i.spec?.ingressClassName || '-'}
                </td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  </Show>
);

// PVC Table
const PVCTable: Component<{ pvcs: any[] }> = (props) => (
  <Show
    when={props.pvcs.length > 0}
    fallback={
      <div class="flex h-48 items-center justify-center text-text-dim">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 4 4 5 4 7z" />
          </svg>
          <p>No PVCs found</p>
        </div>
      </div>
    }
  >
    <table class="w-full text-sm">
      <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted sticky top-0 bg-surface-dark/95 backdrop-blur">
        <tr>
          <th class="px-4 py-3 w-8" />
          <th class="px-4 py-3">Name</th>
          <th class="px-4 py-3">Namespace</th>
          <th class="px-4 py-3">Status</th>
          <th class="px-4 py-3">Capacity</th>
          <th class="px-4 py-3">Storage Class</th>
          <th class="px-4 py-3">Age</th>
        </tr>
      </thead>
      <tbody>
        <For each={props.pvcs}>
          {(pvc) => {
            const phase = pvc.status?.phase || 'Unknown';
            const status: Status = phase === 'Bound' ? 'ok' : phase === 'Pending' ? 'pending' : 'warn';
            const capacity = pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage || '-';
            const storageClass = pvc.spec?.storageClassName || '-';

            return (
              <tr class="border-b border-white/5 hover:bg-white/5 transition-colors group">
                <td class="px-4 py-3">
                  <StatusDot status={status} />
                </td>
                <td class="px-4 py-3 font-medium text-text-main group-hover:text-neon-cyan transition-colors">
                  {pvc.metadata?.name}
                </td>
                <td class="px-4 py-3 text-text-dim">{pvc.metadata?.namespace}</td>
                <td class="px-4 py-3">
                  <span class={`px-2 py-0.5 rounded text-xs ${
                    phase === 'Bound' ? 'bg-status-ok/10 text-status-ok' :
                    phase === 'Pending' ? 'bg-status-warn/10 text-status-warn' :
                    'bg-white/5 text-text-muted'
                  }`}>
                    {phase}
                  </span>
                </td>
                <td class="px-4 py-3 font-mono text-xs text-text-muted">{capacity}</td>
                <td class="px-4 py-3 font-mono text-xs text-text-muted">{storageClass}</td>
                <td class="px-4 py-3 text-text-muted">
                  {pvc.metadata?.creationTimestamp ? formatRelativeTime(pvc.metadata.creationTimestamp) : '-'}
                </td>
              </tr>
            );
          }}
        </For>
      </tbody>
    </table>
  </Show>
);

// ConfigMaps Table
const ConfigMapsTable: Component<{
  configmaps: any[];
  expanded: Set<string>;
  cmData: Record<string, any>;
  onToggle: (ns: string, name: string) => void;
}> = (props) => (
  <Show
    when={props.configmaps.length > 0}
    fallback={
      <div class="flex h-48 items-center justify-center text-text-dim">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p>No configmaps found</p>
        </div>
      </div>
    }
  >
    <div class="divide-y divide-white/5">
      <For each={props.configmaps}>
        {(cm) => {
          const key = `${cm.metadata?.namespace}/${cm.metadata?.name}`;
          const isExpanded = props.expanded.has(key);
          const dataKeys = Object.keys(cm.data || {});

          return (
            <div>
              <div
                class="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer group"
                onClick={() => props.onToggle(cm.metadata?.namespace || 'default', cm.metadata?.name || '')}
              >
                <span class={`text-[10px] text-text-dim transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                  &#9656;
                </span>
                <span class="font-medium text-text-main text-sm group-hover:text-neon-cyan transition-colors">
                  {cm.metadata?.name}
                </span>
                <span class="text-text-dim text-xs">{cm.metadata?.namespace}</span>
                <span class="text-text-dim/50 text-xs ml-auto">{dataKeys.length} keys</span>
                <span class="text-text-muted text-xs">
                  {cm.metadata?.creationTimestamp ? formatRelativeTime(cm.metadata.creationTimestamp) : '-'}
                </span>
              </div>
              <Show when={isExpanded}>
                <div class="px-4 pb-3 ml-8">
                  <Show when={props.cmData[key]} fallback={
                    <div class="text-xs text-text-dim animate-pulse py-2">Loading...</div>
                  }>
                    <div class="rounded-md bg-white/[0.02] overflow-hidden">
                      <For each={Object.entries(props.cmData[key]?.data || {})}>
                        {([k, v]) => (
                          <div class="border-b border-white/5 last:border-0">
                            <div class="px-3 py-1.5 text-xs font-mono text-neon-cyan">{k}</div>
                            <pre class="px-3 pb-2 text-[11px] text-text-muted font-mono whitespace-pre-wrap break-all max-h-32 overflow-auto">
                              {String(v)}
                            </pre>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  </Show>
);

// Secrets Table
const SecretsTable: Component<{
  secrets: any[];
  expanded: Set<string>;
  secretData: Record<string, any>;
  revealedKeys: Set<string>;
  onToggle: (ns: string, name: string) => void;
  onRevealKey: (key: string) => void;
}> = (props) => (
  <Show
    when={props.secrets.length > 0}
    fallback={
      <div class="flex h-48 items-center justify-center text-text-dim">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <p>No secrets found</p>
        </div>
      </div>
    }
  >
    <div class="divide-y divide-white/5">
      <For each={props.secrets}>
        {(secret) => {
          const key = `${secret.metadata?.namespace}/${secret.metadata?.name}`;
          const isExpanded = props.expanded.has(key);
          const secretType = secret.type || 'Opaque';
          const dataKeys = Object.keys(secret.data || {});

          return (
            <div>
              <div
                class="flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors cursor-pointer group"
                onClick={() => props.onToggle(secret.metadata?.namespace || 'default', secret.metadata?.name || '')}
              >
                <span class={`text-[10px] text-text-dim transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                  &#9656;
                </span>
                <span class="font-medium text-text-main text-sm group-hover:text-neon-cyan transition-colors">
                  {secret.metadata?.name}
                </span>
                <span class="text-text-dim text-xs">{secret.metadata?.namespace}</span>
                <span class="text-[10px] font-mono text-text-dim px-1.5 py-0.5 rounded bg-white/5">
                  {secretType}
                </span>
                <span class="text-text-dim/50 text-xs ml-auto">{dataKeys.length} keys</span>
                <span class="text-text-muted text-xs">
                  {secret.metadata?.creationTimestamp ? formatRelativeTime(secret.metadata.creationTimestamp) : '-'}
                </span>
              </div>
              <Show when={isExpanded}>
                <div class="px-4 pb-3 ml-8">
                  <Show when={props.secretData[key]} fallback={
                    <div class="text-xs text-text-dim animate-pulse py-2">Loading...</div>
                  }>
                    <div class="rounded-md bg-white/[0.02] overflow-hidden">
                      <For each={Object.entries(props.secretData[key]?.data || {})}>
                        {([k, v]) => {
                          const revealKey = `${key}/${k}`;
                          const isRevealed = props.revealedKeys.has(revealKey);
                          return (
                            <div class="border-b border-white/5 last:border-0 px-3 py-1.5">
                              <div class="flex items-center gap-2">
                                <span class="text-xs font-mono text-neon-cyan">{k}</span>
                                <button
                                  class="text-[10px] text-text-dim hover:text-neon-cyan transition-colors"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    props.onRevealKey(revealKey);
                                  }}
                                >
                                  {isRevealed ? 'Hide' : 'Reveal'}
                                </button>
                              </div>
                              <div class="text-[11px] text-text-muted font-mono mt-0.5">
                                {isRevealed ? String(v) : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022'}
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  </Show>
);

export default Services;
