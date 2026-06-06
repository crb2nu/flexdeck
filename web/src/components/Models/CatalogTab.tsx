import { Component, createSignal, For, Show, createMemo } from 'solid-js';
import { sanitizeError } from '../../lib/sanitizeError';
import { modelsApi } from '../../lib/api';
import { createPolling } from '../../hooks/createPolling';
import type { ModelCatalogEntry } from '../../lib/types';

type RegistrySource = 'huggingface' | 'civitai';

interface CatalogModelRow {
  catalogName: string;
  namespace: string;
  source: string;
  lastSyncTime: string;
  name: string;
  size?: string;
  tags: string[];
}

const CatalogTab: Component = () => {
  const [catalogs, setCatalogs] = createSignal<ModelCatalogEntry[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [query, setQuery] = createSignal('');
  const [sourceFilter, setSourceFilter] = createSignal('all');
  const [catalogFilter, setCatalogFilter] = createSignal('all');
  const [actionError, setActionError] = createSignal('');
  const [actionNotice, setActionNotice] = createSignal('');
  const [busyKeys, setBusyKeys] = createSignal<Set<string>>(new Set());
  const [registeredKeys, setRegisteredKeys] = createSignal<Set<string>>(new Set());

  const fetchCatalogs = async () => {
    try {
      const data = await modelsApi.catalogs();
      setCatalogs(data.catalogs || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch catalogs');
    } finally {
      setLoading(false);
    }
  };

  const normalize = (value: string) => value.trim().toLowerCase();
  const modelKey = (row: CatalogModelRow) =>
    `${row.catalogName}:${row.namespace}:${row.source}:${row.name}`;
  const toRegistrySource = (source: string): RegistrySource | undefined => {
    const normalized = normalize(source);
    if (normalized === 'huggingface' || normalized === 'hf' || normalized === 'hugging-face') return 'huggingface';
    if (normalized === 'civitai') return 'civitai';
    return undefined;
  };
  const setModelBusy = (key: string, busy: boolean) => {
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const markRegistered = (key: string) => {
    setRegisteredKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };
  const isConflictError = (message: string) => {
    const lower = normalize(message);
    return lower.includes('already exists') || lower.includes('conflict') || lower.includes('409');
  };
  const resolveExistingModelId = async (source: RegistrySource, sourceID: string) => {
    const listResp = await modelsApi.list();
    const modelList = Array.isArray(listResp?.models) ? listResp.models : [];
    const match = modelList.find((model: any) =>
      normalize(String(model?.source || '')) === source && String(model?.source_id || '') === sourceID
    );
    return typeof match?.id === 'string' ? match.id : undefined;
  };
  const ensureRegistered = async (row: CatalogModelRow): Promise<string | undefined> => {
    const source = toRegistrySource(row.source);
    if (!source) throw new Error(`Catalog source '${row.source}' is not supported for registry import.`);

    const created = await modelsApi.register(source, row.name);
    return typeof created?.id === 'string' ? created.id : undefined;
  };
  const handleRegister = async (row: CatalogModelRow) => {
    const key = modelKey(row);
    setActionError('');
    setActionNotice('');
    setModelBusy(key, true);
    try {
      await ensureRegistered(row);
      markRegistered(key);
      setActionNotice(`Added ${row.name} to registry.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add model to registry';
      if (isConflictError(message)) {
        markRegistered(key);
        setActionNotice(`${row.name} is already in the registry.`);
      } else {
        setActionError(message);
      }
    } finally {
      setModelBusy(key, false);
    }
  };
  const handleDownload = async (row: CatalogModelRow) => {
    const key = modelKey(row);
    setActionError('');
    setActionNotice('');
    setModelBusy(key, true);
    try {
      let modelID: string | undefined;
      try {
        modelID = await ensureRegistered(row);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to register model before download';
        if (!isConflictError(message)) throw err;
      }

      const registrySource = toRegistrySource(row.source);
      if (!registrySource) throw new Error(`Catalog source '${row.source}' is not supported for downloads.`);
      if (!modelID) {
        modelID = await resolveExistingModelId(registrySource, row.name);
      }
      if (!modelID) throw new Error('Model is registered but registry ID could not be resolved for download.');

      await modelsApi.startDownload(modelID);
      markRegistered(key);
      setActionNotice(`Queued download for ${row.name}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to queue download');
    } finally {
      setModelBusy(key, false);
    }
  };

  createPolling('models-catalog-tab', fetchCatalogs, 60000);

  const sourceColor = (source: string) => {
    switch (source.toLowerCase()) {
      case 'huggingface': return 'text-yellow-400';
      case 'oci': return 'text-blue-400';
      case 'ollama': return 'text-green-400';
      default: return 'text-text-muted';
    }
  };
  const allRows = createMemo<CatalogModelRow[]>(() =>
    catalogs().flatMap((catalog) =>
      (catalog.models || []).map((model) => ({
        catalogName: catalog.name,
        namespace: catalog.namespace,
        source: catalog.source,
        lastSyncTime: catalog.lastSyncTime,
        name: model.name,
        size: model.size,
        tags: model.tags || [],
      }))
    )
  );
  const catalogOptions = createMemo(() =>
    Array.from(new Set(catalogs().map((catalog) => `${catalog.namespace}/${catalog.name}`))).sort((a, b) => a.localeCompare(b))
  );
  const sourceOptions = createMemo(() =>
    Array.from(new Set(catalogs().map((catalog) => catalog.source))).sort((a, b) => a.localeCompare(b))
  );
  const filteredRows = createMemo(() => {
    const normalizedQuery = normalize(query());
    const selectedSource = sourceFilter();
    const selectedCatalog = catalogFilter();

    return allRows().filter((row) => {
      if (selectedSource !== 'all' && row.source !== selectedSource) return false;
      if (selectedCatalog !== 'all' && `${row.namespace}/${row.catalogName}` !== selectedCatalog) return false;
      if (!normalizedQuery) return true;

      return (
        normalize(row.name).includes(normalizedQuery) ||
        normalize(row.catalogName).includes(normalizedQuery) ||
        normalize(row.namespace).includes(normalizedQuery) ||
        row.tags.some((tag) => normalize(tag).includes(normalizedQuery))
      );
    });
  });
  const summary = createMemo(() => ({
    catalogs: catalogs().length,
    models: allRows().length,
    visibleModels: filteredRows().length,
  }));

  return (
    <div class="flex flex-col gap-4">
      <Show when={error()}>
        <div class="surface p-3 text-sm text-status-error">{sanitizeError(error())}</div>
      </Show>
      <Show when={actionError()}>
        <div class="surface p-3 text-sm text-status-error">{actionError()}</div>
      </Show>
      <Show when={actionNotice()}>
        <div class="surface p-3 text-sm text-status-ok">{actionNotice()}</div>
      </Show>

      <Show when={loading() && catalogs().length === 0}>
        <div class="surface flex items-center justify-center py-8">
          <div class="text-text-dim animate-pulse">Loading model catalogs...</div>
        </div>
      </Show>

      <Show when={catalogs().length === 0 && !loading()}>
        <div class="surface p-6 text-center">
          <p class="text-text-dim text-sm">No ModelCatalog CRDs found.</p>
          <p class="text-text-dim text-xs mt-1">Deploy ModelCatalog resources to your cluster to see them here.</p>
        </div>
      </Show>

      <Show when={catalogs().length > 0}>
        <div class="surface p-4 flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search model, catalog, namespace, or tag..."
              class="min-w-[220px] flex-1 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-xs text-text-main placeholder:text-text-dim/60 focus:border-white/20 focus:outline-none"
            />
            <select
              value={sourceFilter()}
              onChange={(event) => setSourceFilter(event.currentTarget.value)}
              class="rounded-md border border-white/10 bg-black/30 px-2 py-2 text-xs text-text-main focus:border-white/20 focus:outline-none"
            >
              <option value="all">All sources</option>
              <For each={sourceOptions()}>{(source) => <option value={source}>{source}</option>}</For>
            </select>
            <select
              value={catalogFilter()}
              onChange={(event) => setCatalogFilter(event.currentTarget.value)}
              class="rounded-md border border-white/10 bg-black/30 px-2 py-2 text-xs text-text-main focus:border-white/20 focus:outline-none"
            >
              <option value="all">All catalogs</option>
              <For each={catalogOptions()}>{(catalog) => <option value={catalog}>{catalog}</option>}</For>
            </select>
            <button
              onClick={() => void fetchCatalogs()}
              class="rounded-md border border-white/20 bg-black/40 px-3 py-2 text-xs font-mono text-text-muted transition-colors hover:text-text-main"
            >
              Refresh
            </button>
          </div>
          <div class="text-[11px] text-text-dim">
            {summary().visibleModels} visible models of {summary().models} across {summary().catalogs} catalogs.
          </div>
        </div>
      </Show>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <For each={catalogs()}>
          {(catalog) => {
            const catalogID = `${catalog.namespace}/${catalog.name}`;
            const modelsForCatalog = () =>
              filteredRows().filter((row) => `${row.namespace}/${row.catalogName}` === catalogID);

            return (
              <div class="surface-hover p-4 flex flex-col gap-3">
                <div class="flex items-center justify-between">
                  <span class="text-sm font-medium text-text-main font-mono">{catalog.name}</span>
                  <span class={`text-xs font-medium ${sourceColor(catalog.source)}`}>{catalog.source}</span>
                </div>

                <div class="text-xs text-text-dim">
                  {catalog.namespace} &middot; {modelsForCatalog().length} matching models
                </div>

                <Show when={catalog.lastSyncTime}>
                  <div class="text-[10px] text-text-dim">
                    Last sync: {new Date(catalog.lastSyncTime).toLocaleString()}
                  </div>
                </Show>

                <Show when={modelsForCatalog().length > 0} fallback={<div class="text-xs text-text-dim">No models match current filters.</div>}>
                  <div class="border-t border-white/5 pt-2 flex flex-col gap-2 max-h-64 overflow-y-auto">
                    <For each={modelsForCatalog()}>
                      {(row) => {
                        const key = modelKey(row);
                        const supported = !!toRegistrySource(row.source);
                        const busy = () => busyKeys().has(key);
                        const alreadyRegistered = () => registeredKeys().has(key);
                        return (
                          <div class="rounded-md border border-white/10 bg-black/20 p-2">
                            <div class="flex items-center justify-between gap-2">
                              <span class="font-mono text-text-main truncate text-xs">{row.name}</span>
                              <Show when={row.size}>
                                <span class="text-[10px] text-text-dim shrink-0">{row.size}</span>
                              </Show>
                            </div>
                            <Show when={row.tags.length > 0}>
                              <div class="mt-1 flex flex-wrap gap-1">
                                <For each={row.tags.slice(0, 3)}>
                                  {(tag) => (
                                    <span class="text-[9px] px-1 py-0.5 rounded bg-white/5 text-text-dim">{tag}</span>
                                  )}
                                </For>
                              </div>
                            </Show>
                            <div class="mt-2 flex items-center gap-2">
                              <button
                                onClick={() => void handleRegister(row)}
                                disabled={!supported || busy()}
                                title={supported ? 'Add to local registry' : `Unsupported source: ${row.source}`}
                                class="rounded border border-white/15 bg-white/10 px-2 py-1 text-[10px] font-mono text-white transition-opacity disabled:opacity-40"
                              >
                                {busy() ? 'Working...' : alreadyRegistered() ? 'In Registry' : 'Add to Registry'}
                              </button>
                              <button
                                onClick={() => void handleDownload(row)}
                                disabled={!supported || busy()}
                                title={supported ? 'Queue model download' : `Unsupported source: ${row.source}`}
                                class="rounded border border-white/15 bg-white/10 px-2 py-1 text-[10px] font-mono text-text-muted transition-opacity disabled:opacity-40"
                              >
                                Queue Download
                              </button>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>

      <Show when={catalogs().length > 0 && filteredRows().length === 0}>
        <div class="surface p-4 text-sm text-text-dim">
          No models match the current query and filters.
        </div>
      </Show>
    </div>
  );
};

export default CatalogTab;
