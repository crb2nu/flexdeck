import { createEffect, createMemo, createSignal } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { healthStore } from '../../stores/health';
import { api } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import type {
  K8sDaemonSet,
  K8sDeployment,
  K8sIngress,
  K8sJob,
  K8sList,
  K8sService,
  K8sStatefulSet,
} from '../../lib/types';

const REFRESH_INTERVAL = 30000;

export type TabType =
  | 'deployments'
  | 'services'
  | 'ingresses'
  | 'statefulsets'
  | 'daemonsets'
  | 'jobs'
  | 'storage'
  | 'configmaps'
  | 'secrets';

export function useServicesController() {
  const [deployments, setDeployments] = createSignal<K8sDeployment[]>([]);
  const [services, setServices] = createSignal<K8sService[]>([]);
  const [ingresses, setIngresses] = createSignal<K8sIngress[]>([]);
  const [statefulsets, setStatefulsets] = createSignal<K8sStatefulSet[]>([]);
  const [daemonsets, setDaemonsets] = createSignal<K8sDaemonSet[]>([]);
  const [jobs, setJobs] = createSignal<K8sJob[]>([]);
  const [pvcs, setPvcs] = createSignal<any[]>([]);
  const [configmaps, setConfigmaps] = createSignal<any[]>([]);
  const [secrets, setSecrets] = createSignal<any[]>([]);
  const [expandedCM, setExpandedCM] = createSignal<Set<string>>(new Set());
  const [expandedSecret, setExpandedSecret] = createSignal<Set<string>>(new Set());
  const [secretData, setSecretData] = createSignal<Record<string, any>>({});
  const [cmData, setCmData] = createSignal<Record<string, any>>({});
  const [revealedKeys, setRevealedKeys] = createSignal<Set<string>>(new Set());
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [namespaceFilter, setNamespaceFilter] = createSignal('');
  // Deep-link support (?tab=services&q=name): the palette and shared links can
  // land on a specific resource tab with the search pre-applied. URL → state
  // only; typing afterwards doesn't churn the URL, but a same-route navigation
  // (palette) re-applies the params.
  const [searchParams] = useSearchParams<{ q?: string; tab?: string }>();
  const isTabType = (v: unknown): v is TabType =>
    typeof v === 'string' &&
    ['deployments', 'services', 'ingresses', 'statefulsets', 'daemonsets', 'jobs', 'storage', 'configmaps', 'secrets'].includes(v);
  const [searchTerm, setSearchTerm] = createSignal(searchParams.q ?? '');
  const [activeTab, setActiveTab] = createSignal<TabType>(isTabType(searchParams.tab) ? searchParams.tab : 'deployments');
  createEffect(() => setSearchTerm(searchParams.q ?? ''));
  createEffect(() => {
    const tab = searchParams.tab;
    if (isTabType(tab)) setActiveTab(tab);
  });

  const isK8sEnabled = () => healthStore.features?.k8s?.enabled ?? false;
  const isReadOnly = () => healthStore.features?.k8s?.readOnly ?? true;

  const namespaces = createMemo(() => {
    const uniqueNamespaces = new Set<string>();
    deployments().forEach((deployment) => uniqueNamespaces.add(deployment.metadata?.namespace || 'default'));
    services().forEach((service) => uniqueNamespaces.add(service.metadata?.namespace || 'default'));
    statefulsets().forEach((statefulset) => uniqueNamespaces.add(statefulset.metadata?.namespace || 'default'));
    daemonsets().forEach((daemonset) => uniqueNamespaces.add(daemonset.metadata?.namespace || 'default'));
    jobs().forEach((job) => uniqueNamespaces.add(job.metadata?.namespace || 'default'));
    return Array.from(uniqueNamespaces).sort();
  });

  const filterResources = <T extends { metadata?: { namespace?: string; name?: string } }>(resources: T[]): T[] => {
    const nsFilter = namespaceFilter();
    const normalizedSearch = searchTerm().toLowerCase();

    return resources.filter((resource) => {
      if (nsFilter && resource.metadata?.namespace !== nsFilter) {
        return false;
      }
      if (normalizedSearch && !resource.metadata?.name?.toLowerCase().includes(normalizedSearch)) {
        return false;
      }
      return true;
    });
  };

  const filteredDeployments = createMemo(() => filterResources(deployments()));
  const filteredServices = createMemo(() => filterResources(services()));
  const filteredIngresses = createMemo(() => filterResources(ingresses()));
  const filteredStatefulsets = createMemo(() => filterResources(statefulsets()));
  const filteredDaemonsets = createMemo(() => filterResources(daemonsets()));
  const filteredJobs = createMemo(() => filterResources(jobs()));
  const filteredPvcs = createMemo(() => filterResources(pvcs()));
  const filteredConfigmaps = createMemo(() => filterResources(configmaps()));
  const filteredSecrets = createMemo(() => filterResources(secrets()));

  const fetchData = async () => {
    if (!isK8sEnabled()) {
      setLoading(false);
      setError('Kubernetes disabled');
      return;
    }

    try {
      const [deploys, svcs, ings, sts, ds, jbs, pvcData, configMapData, secretList] = await Promise.all([
        api<K8sList<K8sDeployment>>('/k8s/deployments'),
        api<K8sList<K8sService>>('/k8s/services'),
        api<K8sList<K8sIngress>>('/k8s/ingresses'),
        api<K8sList<K8sStatefulSet>>('/k8s/statefulsets').catch(() => ({ items: [] })),
        api<K8sList<K8sDaemonSet>>('/k8s/daemonsets').catch(() => ({ items: [] })),
        api<K8sList<K8sJob>>('/k8s/jobs').catch(() => ({ items: [] })),
        api<any>('/k8s/pvcs').then((data) => data.items || data).catch(() => []),
        api<any>('/k8s/configmaps').catch(() => []),
        api<any>('/k8s/secrets').catch(() => []),
      ]);

      setDeployments(deploys.items || []);
      setServices(svcs.items || []);
      setIngresses(ings.items || []);
      setStatefulsets(sts.items || []);
      setDaemonsets(ds.items || []);
      setJobs(jbs.items || []);
      setPvcs(Array.isArray(pvcData) ? pvcData : (pvcData?.items || []));
      setConfigmaps(Array.isArray(configMapData) ? configMapData : (configMapData?.items || []));
      setSecrets(Array.isArray(secretList) ? secretList : (secretList?.items || []));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const scaleDeployment = async (namespace: string, name: string, replicas: number) => {
    if (isReadOnly()) return;

    try {
      await api(`/k8s/deployments/${namespace}/${name}/scale?replicas=${replicas}`, {
        method: 'POST',
      });
      await fetchData();
    } catch (err) {
      console.error('Scale failed:', err);
    }
  };

  const restartDeployment = async (namespace: string, name: string) => {
    if (isReadOnly()) return;

    try {
      await api(`/k8s/deployments/${namespace}/${name}/restart`, { method: 'POST' });
      await fetchData();
    } catch (err) {
      console.error('Restart failed:', err);
    }
  };

  const toggleConfigMap = async (namespace: string, name: string) => {
    const key = `${namespace}/${name}`;
    setExpandedCM((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

    if (cmData()[key]) return;

    try {
      const data = await api<any>(`/k8s/configmaps/${namespace}/${name}`);
      setCmData((prev) => ({ ...prev, [key]: data }));
    } catch {
      // Ignore per-item expansion failures.
    }
  };

  const toggleSecret = async (namespace: string, name: string) => {
    const key = `${namespace}/${name}`;
    setExpandedSecret((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

    if (secretData()[key]) return;

    try {
      const data = await api<any>(`/k8s/secrets/${namespace}/${name}`);
      setSecretData((prev) => ({ ...prev, [key]: data }));
    } catch {
      // Ignore per-item expansion failures.
    }
  };

  const toggleRevealKey = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearFilters = () => {
    setSearchTerm('');
    setNamespaceFilter('');
  };

  const tabs = [
    { id: 'deployments' as const, label: 'Deployments', count: () => filteredDeployments().length },
    { id: 'statefulsets' as const, label: 'StatefulSets', count: () => filteredStatefulsets().length },
    { id: 'daemonsets' as const, label: 'DaemonSets', count: () => filteredDaemonsets().length },
    { id: 'jobs' as const, label: 'Jobs', count: () => filteredJobs().length },
    { id: 'services' as const, label: 'Services', count: () => filteredServices().length },
    { id: 'ingresses' as const, label: 'Ingresses', count: () => filteredIngresses().length },
    { id: 'storage' as const, label: 'Storage', count: () => filteredPvcs().length },
    { id: 'configmaps' as const, label: 'ConfigMaps', count: () => filteredConfigmaps().length },
    { id: 'secrets' as const, label: 'Secrets', count: () => filteredSecrets().length },
  ] satisfies { id: TabType; label: string; count: () => number }[];

  createPolling('services-refresh', async () => { if (!healthStore.loading) await fetchData(); }, REFRESH_INTERVAL);

  createEffect(() => {
    if (!healthStore.loading && healthStore.ok) {
      void fetchData();
    }
  });

  return {
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
  };
}
