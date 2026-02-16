import { Component, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { modelsApi } from '../../lib/api';
import type { ModelCatalogEntry } from '../../lib/types';

const CatalogTab: Component = () => {
  const [catalogs, setCatalogs] = createSignal<ModelCatalogEntry[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');

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

  createEffect(() => {
    fetchCatalogs();
    const interval = setInterval(fetchCatalogs, 60000);
    onCleanup(() => clearInterval(interval));
  });

  const sourceColor = (source: string) => {
    switch (source.toLowerCase()) {
      case 'huggingface': return 'text-yellow-400';
      case 'oci': return 'text-blue-400';
      case 'ollama': return 'text-green-400';
      default: return 'text-text-muted';
    }
  };

  return (
    <div class="flex flex-col gap-4">
      <Show when={error()}>
        <div class="glass-panel p-3 text-sm text-status-error">{error()}</div>
      </Show>

      <Show when={loading() && catalogs().length === 0}>
        <div class="glass-panel flex items-center justify-center py-8">
          <div class="text-text-dim animate-pulse">Loading model catalogs...</div>
        </div>
      </Show>

      <Show when={catalogs().length === 0 && !loading()}>
        <div class="glass-panel p-6 text-center">
          <p class="text-text-dim text-sm">No ModelCatalog CRDs found.</p>
          <p class="text-text-dim text-xs mt-1">Deploy ModelCatalog resources to your cluster to see them here.</p>
        </div>
      </Show>

      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <For each={catalogs()}>
          {(catalog) => (
            <div class="glass-panel-hover p-4 flex flex-col gap-3">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-text-main font-mono">{catalog.name}</span>
                <span class={`text-xs font-medium ${sourceColor(catalog.source)}`}>{catalog.source}</span>
              </div>

              <div class="text-xs text-text-dim">
                {catalog.namespace} &middot; {catalog.models?.length || 0} models
              </div>

              <Show when={catalog.lastSyncTime}>
                <div class="text-[10px] text-text-dim">
                  Last sync: {new Date(catalog.lastSyncTime).toLocaleString()}
                </div>
              </Show>

              <Show when={catalog.models && catalog.models.length > 0}>
                <div class="border-t border-white/5 pt-2 flex flex-col gap-1 max-h-40 overflow-y-auto">
                  <For each={catalog.models.slice(0, 10)}>
                    {(model) => (
                      <div class="flex items-center justify-between text-xs">
                        <span class="font-mono text-text-muted truncate">{model.name}</span>
                        <div class="flex items-center gap-2">
                          <Show when={model.size}>
                            <span class="text-text-dim">{model.size}</span>
                          </Show>
                          <Show when={model.tags && model.tags.length > 0}>
                            <For each={model.tags!.slice(0, 2)}>
                              {(tag) => (
                                <span class="text-[9px] px-1 py-0.5 rounded bg-white/5 text-text-dim">{tag}</span>
                              )}
                            </For>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                  <Show when={catalog.models.length > 10}>
                    <div class="text-[10px] text-text-dim text-center mt-1">
                      +{catalog.models.length - 10} more
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

export default CatalogTab;
