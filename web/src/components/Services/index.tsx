import { Component, createSignal, createMemo, onMount, onCleanup, For, Show } from 'solid-js';
import { healthStore } from '../../stores/health';
import { api } from '../../lib/api';
import { formatRelativeTime } from '../../lib/format';
import type { K8sDeployment, K8sService, K8sIngress, K8sList } from '../../lib/types';

const REFRESH_INTERVAL = 30000; // 30 seconds

interface DeploymentRow {
  name: string;
  namespace: string;
  ready: number;
  desired: number;
  image: string;
  age: string;
}

interface ServiceRow {
  name: string;
  namespace: string;
  type: string;
  clusterIP: string;
  ports: string;
  endpoints: string[];
}

const Services: Component = () => {
  const [deployments, setDeployments] = createSignal<K8sDeployment[]>([]);
  const [services, setServices] = createSignal<K8sService[]>([]);
  const [ingresses, setIngresses] = createSignal<K8sIngress[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [namespaceFilter, setNamespaceFilter] = createSignal('');
  const [activeTab, setActiveTab] = createSignal<'deployments' | 'services' | 'ingresses'>('deployments');

  let refreshInterval: ReturnType<typeof setInterval>;

  const isK8sEnabled = () => healthStore.features?.k8s?.enabled ?? false;
  const isReadOnly = () => healthStore.features?.k8s?.readOnly ?? true;

  // Get unique namespaces
  const namespaces = createMemo(() => {
    const ns = new Set<string>();
    deployments().forEach((d) => ns.add(d.metadata?.namespace || 'default'));
    services().forEach((s) => ns.add(s.metadata?.namespace || 'default'));
    return Array.from(ns).sort();
  });

  // Filtered data
  const filteredDeployments = createMemo(() => {
    const filter = namespaceFilter();
    if (!filter) return deployments();
    return deployments().filter((d) => d.metadata?.namespace === filter);
  });

  const filteredServices = createMemo(() => {
    const filter = namespaceFilter();
    if (!filter) return services();
    return services().filter((s) => s.metadata?.namespace === filter);
  });

  const filteredIngresses = createMemo(() => {
    const filter = namespaceFilter();
    if (!filter) return ingresses();
    return ingresses().filter((i) => i.metadata?.namespace === filter);
  });

  async function fetchData() {
    if (!isK8sEnabled()) {
      setLoading(false);
      setError('Kubernetes disabled');
      return;
    }

    try {
      const [deploys, svcs, ings] = await Promise.all([
        api<K8sList<K8sDeployment>>('/k8s/deployments'),
        api<K8sList<K8sService>>('/k8s/services'),
        api<K8sList<K8sIngress>>('/k8s/ingresses'),
      ]);

      setDeployments(deploys.items || []);
      setServices(svcs.items || []);
      setIngresses(ings.items || []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }

  async function scaleDeployment(ns: string, name: string, replicas: number) {
    if (isReadOnly()) return;

    try {
      await api(`/k8s/deployments/${ns}/${name}/scale?replicas=${replicas}`, {
        method: 'POST',
      });
      await fetchData();
    } catch (e) {
      console.error('Scale failed:', e);
    }
  }

  async function restartDeployment(ns: string, name: string) {
    if (isReadOnly()) return;

    try {
      await api(`/k8s/deployments/${ns}/${name}/restart`, { method: 'POST' });
      await fetchData();
    } catch (e) {
      console.error('Restart failed:', e);
    }
  }

  onMount(() => {
    fetchData();
    refreshInterval = setInterval(fetchData, REFRESH_INTERVAL);
  });

  onCleanup(() => {
    if (refreshInterval) clearInterval(refreshInterval);
  });

  return (
    <div class="flex h-full flex-col gap-4">
      {/* Controls */}
      <div class="glass-panel flex items-center justify-between px-4 py-3">
        {/* Tabs */}
        <div class="flex gap-1">
          <button
            class={`rounded-m px-4 py-2 text-sm font-medium transition-colors ${
              activeTab() === 'deployments'
                ? 'bg-neon-cyan/10 text-neon-cyan'
                : 'text-text-dim hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('deployments')}
          >
            Deployments ({filteredDeployments().length})
          </button>
          <button
            class={`rounded-m px-4 py-2 text-sm font-medium transition-colors ${
              activeTab() === 'services'
                ? 'bg-neon-cyan/10 text-neon-cyan'
                : 'text-text-dim hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('services')}
          >
            Services ({filteredServices().length})
          </button>
          <button
            class={`rounded-m px-4 py-2 text-sm font-medium transition-colors ${
              activeTab() === 'ingresses'
                ? 'bg-neon-cyan/10 text-neon-cyan'
                : 'text-text-dim hover:bg-white/5'
            }`}
            onClick={() => setActiveTab('ingresses')}
          >
            Ingresses ({filteredIngresses().length})
          </button>
        </div>

        {/* Namespace filter */}
        <select
          class="rounded-m bg-bg-dark px-3 py-2 text-sm text-text-main border border-white/10 focus:border-neon-cyan focus:outline-none"
          value={namespaceFilter()}
          onChange={(e) => setNamespaceFilter(e.currentTarget.value)}
        >
          <option value="">All namespaces</option>
          <For each={namespaces()}>
            {(ns) => <option value={ns}>{ns}</option>}
          </For>
        </select>
      </div>

      {/* Content */}
      <div class="glass-panel flex-1 overflow-auto">
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

        <Show when={!loading() && !error() && activeTab() === 'services'}>
          <ServicesTable services={filteredServices()} />
        </Show>

        <Show when={!loading() && !error() && activeTab() === 'ingresses'}>
          <IngressesTable ingresses={filteredIngresses()} />
        </Show>
      </div>
    </div>
  );
};

// Deployments Table
interface DeploymentsTableProps {
  deployments: K8sDeployment[];
  readOnly: boolean;
  onScale: (ns: string, name: string, replicas: number) => void;
  onRestart: (ns: string, name: string) => void;
}

const DeploymentsTable: Component<DeploymentsTableProps> = (props) => (
  <table class="w-full text-sm">
    <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted">
      <tr>
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
          const isHealthy = ready === desired && desired > 0;
          const image = d.spec?.template?.spec?.containers?.[0]?.image || '-';
          const shortImage = image.split('/').pop()?.split('@')[0] || image;

          return (
            <tr class="border-b border-white/5 hover:bg-white/5">
              <td class="px-4 py-3 font-medium text-text-main">
                {d.metadata?.name}
              </td>
              <td class="px-4 py-3 text-text-dim">{d.metadata?.namespace}</td>
              <td class="px-4 py-3">
                <span class={isHealthy ? 'text-status-ok' : 'text-status-warn'}>
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
                      class="rounded px-2 py-1 text-xs text-neon-cyan hover:bg-neon-cyan/10"
                      onClick={() =>
                        props.onScale(
                          d.metadata?.namespace || 'default',
                          d.metadata?.name || '',
                          desired + 1
                        )
                      }
                    >
                      +
                    </button>
                    <button
                      class="rounded px-2 py-1 text-xs text-neon-yellow hover:bg-neon-yellow/10"
                      onClick={() =>
                        props.onScale(
                          d.metadata?.namespace || 'default',
                          d.metadata?.name || '',
                          Math.max(0, desired - 1)
                        )
                      }
                    >
                      -
                    </button>
                    <button
                      class="rounded px-2 py-1 text-xs text-neon-purple hover:bg-neon-purple/10"
                      onClick={() =>
                        props.onRestart(
                          d.metadata?.namespace || 'default',
                          d.metadata?.name || ''
                        )
                      }
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
);

// Services Table
const ServicesTable: Component<{ services: K8sService[] }> = (props) => (
  <table class="w-full text-sm">
    <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted">
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
            <tr class="border-b border-white/5 hover:bg-white/5">
              <td class="px-4 py-3 font-medium text-text-main">
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
);

// Ingresses Table
const IngressesTable: Component<{ ingresses: K8sIngress[] }> = (props) => (
  <table class="w-full text-sm">
    <thead class="border-b border-white/10 text-left text-xs uppercase text-text-muted">
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
            <tr class="border-b border-white/5 hover:bg-white/5">
              <td class="px-4 py-3 font-medium text-text-main">
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
);

export default Services;
