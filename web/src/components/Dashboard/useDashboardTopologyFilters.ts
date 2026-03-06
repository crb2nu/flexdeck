import { createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import type { K8sNode, K8sPod } from '../../lib/types';
import type { HoloDeckFilter } from './HoloDeck';

const EMPTY_OPTIONS: string[] = [];

interface UseDashboardTopologyFiltersInput {
  nodes: Accessor<K8sNode[]>;
  pods: Accessor<K8sPod[]>;
  showFilters: Accessor<boolean>;
  viewMode: Accessor<'2d' | '3d'>;
}

export function useDashboardTopologyFilters(input: UseDashboardTopologyFiltersInput) {
  const { nodes, pods, showFilters, viewMode } = input;
  const [filter, setFilter] = createSignal<HoloDeckFilter>({});
  const [searchInput, setSearchInput] = createSignal('');
  let searchDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      setFilter((current) => ({ ...current, searchTerm: value || undefined }));
    }, 300);
  };

  const toggleStatusFilter = (status: string) => {
    const current = filter().status || [];
    if (current.includes(status)) {
      const nextStatus = current.filter((value) => value !== status);
      setFilter((existing) => ({
        ...existing,
        status: nextStatus.length > 0 ? nextStatus : undefined,
      }));
      return;
    }
    setFilter((existing) => ({ ...existing, status: [...current, status] }));
  };

  const isStatusActive = (status: string) => filter().status?.includes(status) || false;

  const shouldComputeFilterOptions = createMemo(() => viewMode() === '3d' && showFilters());
  const namespaceList = createMemo(() => {
    if (!shouldComputeFilterOptions()) return EMPTY_OPTIONS;
    return [...new Set(pods().map((pod) => pod.metadata?.namespace).filter(Boolean))].sort() as string[];
  });

  const nodeNameList = createMemo(() => {
    if (!shouldComputeFilterOptions()) return EMPTY_OPTIONS;
    return nodes().map((node) => node.metadata?.name).filter(Boolean).sort() as string[];
  });

  const hasActiveFilter = createMemo(() => {
    const activeFilter = filter();
    return Boolean(
      activeFilter.namespace ||
      (activeFilter.status?.length ?? 0) > 0 ||
      activeFilter.nodeName ||
      activeFilter.searchTerm,
    );
  });

  const clearFilters = () => {
    setFilter({});
    setSearchInput('');
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  };

  onCleanup(() => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  });

  return {
    clearFilters,
    filter,
    handleSearchChange,
    hasActiveFilter,
    isStatusActive,
    namespaceList,
    nodeNameList,
    searchInput,
    setFilter,
    setSearchInput,
    toggleStatusFilter,
  };
}
