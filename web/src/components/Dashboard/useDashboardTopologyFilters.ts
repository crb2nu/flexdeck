import { createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import type { K8sNode, K8sPod } from '../../lib/types';
import type { HoloDeckFilter } from './HoloDeck';

const EMPTY_OPTIONS: string[] = [];

interface UseDashboardTopologyFiltersInput {
  nodes: Accessor<K8sNode[]>;
  pods: Accessor<K8sPod[]>;
  showFilters: Accessor<boolean>;
}

export function useDashboardTopologyFilters(input: UseDashboardTopologyFiltersInput) {
  const { nodes, pods, showFilters } = input;
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

  // Filters apply to both the 2D graph and the 3D HoloDeck; only compute the
  // option lists while the filter panel is actually open.
  const shouldComputeFilterOptions = createMemo(() => showFilters());
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
