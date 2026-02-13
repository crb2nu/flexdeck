import { Component, createSignal, createEffect, onCleanup, For, Show, Switch, Match } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { RegisteredModel, ModelSearchResult } from '../../lib/types';
import { modelsApi } from '../../lib/api';

type Tab = 'deployed' | 'registry' | 'search';

const Models: Component = () => {
  const [activeTab, setActiveTab] = createSignal<Tab>('deployed');
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);
  const [discoverLoading, setDiscoverLoading] = createSignal(false);

  // All models from registry (controller-backed)
  const [allModels, setAllModels] = createStore<RegisteredModel[]>([]);

  // Search state
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchSource, setSearchSource] = createSignal<'huggingface' | 'civitai'>('huggingface');
  const [searchResults, setSearchResults] = createStore<RegisteredModel[]>([]);
  const [searching, setSearching] = createSignal(false);

  // Derived: deployed models (from flexinfer-system controller)
  const deployedModels = () =>
    allModels.filter(m => m.deployment_status === 'deployed' || m.deployment_status === 'pending');

  // Derived: registry models (downloaded/registered, not necessarily deployed)
  const registryModels = () => allModels;

  // Fetch models from the controller-backed registry
  const fetchModels = async () => {
    try {
      const data = await modelsApi.list();
      setAllModels(data.models || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setLoading(false);
    }
  };

  // Trigger K8s discovery from flexinfer-system namespace
  const discoverModels = async () => {
    setDiscoverLoading(true);
    setError('');
    try {
      const result = await modelsApi.discover('flexinfer-system');
      const count = result?.discovered || 0;
      // Refresh the model list after discovery
      await fetchModels();
      if (count > 0) {
        setError(''); // clear any stale error
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discovery failed');
    } finally {
      setDiscoverLoading(false);
    }
  };

  // Search models
  const handleSearch = async () => {
    if (!searchQuery().trim()) return;
    setSearching(true);
    try {
      const data: ModelSearchResult = searchSource() === 'huggingface'
        ? await modelsApi.searchHuggingFace(searchQuery(), '', 20)
        : await modelsApi.searchCivitAI(searchQuery(), '', 20);
      setSearchResults(data.models || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  // Register a model from search results
  const handleRegister = async (source: string, sourceId: string) => {
    setActionLoading(sourceId);
    try {
      await modelsApi.register(source, sourceId);
      await fetchModels();
      setActiveTab('registry');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setActionLoading(null);
    }
  };

  // Start download
  const handleStartDownload = async (id: string) => {
    setActionLoading(id);
    try {
      await modelsApi.startDownload(id);
      await fetchModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed to start');
    } finally {
      setActionLoading(null);
    }
  };

  // Delete model from registry
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this model from registry?')) return;
    setActionLoading(id);
    try {
      await modelsApi.delete(id);
      await fetchModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionLoading(null);
    }
  };

  // Scale model via controller
  const scaleModel = async (id: string, replicas: number) => {
    setActionLoading(id);
    try {
      await modelsApi.scale(id, replicas);
      // Give K8s a moment, then refresh
      setTimeout(() => fetchModels(), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scale failed');
    } finally {
      setActionLoading(null);
    }
  };

  createEffect(() => {
    // Initial load: discover from flexinfer-system, then fetch registry
    discoverModels();
    const interval = setInterval(fetchModels, 15000);
    onCleanup(() => clearInterval(interval));
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': case 'deployed': case 'completed': return 'text-status-ok';
      case 'pending': case 'downloading': return 'text-status-warn';
      case 'stopped': case 'none': return 'text-text-dim';
      default: return 'text-status-error';
    }
  };

  const getStatusDot = (status: string) => {
    switch (status) {
      case 'running': case 'deployed': case 'completed': return 'status-dot-ok';
      case 'pending': case 'downloading': return 'status-dot-warn animate-pulse';
      case 'stopped': case 'none': return 'bg-text-dim/50 h-2 w-2 rounded-full';
      default: return 'status-dot-error';
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes) return 'Unknown';
    const gb = bytes / (1024 * 1024 * 1024);
    return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  return (
    <div class="flex h-full flex-col gap-4">
      {/* Header with tabs */}
      <div class="glass-panel flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-4">
          <h2 class="text-lg font-medium text-text-main">AI Models</h2>
          <div class="flex gap-1 rounded-md bg-white/5 p-1">
            <button
              onClick={() => setActiveTab('deployed')}
              class={`rounded px-3 py-1 text-sm transition-colors ${
                activeTab() === 'deployed' ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-text-dim hover:text-text-main'
              }`}
            >
              Deployed
              <Show when={deployedModels().length > 0}>
                <span class="ml-1.5 text-[10px] opacity-60">{deployedModels().length}</span>
              </Show>
            </button>
            <button
              onClick={() => setActiveTab('registry')}
              class={`rounded px-3 py-1 text-sm transition-colors ${
                activeTab() === 'registry' ? 'bg-neon-purple/20 text-neon-purple' : 'text-text-dim hover:text-text-main'
              }`}
            >
              Registry
              <Show when={registryModels().length > 0}>
                <span class="ml-1.5 text-[10px] opacity-60">{registryModels().length}</span>
              </Show>
            </button>
            <button
              onClick={() => setActiveTab('search')}
              class={`rounded px-3 py-1 text-sm transition-colors ${
                activeTab() === 'search' ? 'bg-status-ok/20 text-status-ok' : 'text-text-dim hover:text-text-main'
              }`}
            >
              Search
            </button>
          </div>
        </div>

        <div class="flex gap-2">
          <button
            onClick={discoverModels}
            disabled={discoverLoading()}
            class="rounded-md bg-neon-purple/20 px-3 py-1.5 text-sm font-medium text-neon-purple transition-colors hover:bg-neon-purple/30 disabled:opacity-50"
          >
            {discoverLoading() ? 'Syncing...' : '⎈ Sync'}
          </button>
          <button
            onClick={fetchModels}
            disabled={loading()}
            class="rounded-md bg-neon-cyan/20 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="glass-panel p-4 text-sm text-status-error">{error()}</div>
      </Show>

      {/* Tab content */}
      <Switch>
        {/* Deployed Models Tab */}
        <Match when={activeTab() === 'deployed'}>
          <Show
            when={!loading() || deployedModels().length > 0}
            fallback={<LoadingState message="Discovering models from flexinfer-system..." />}
          >
            <Show
              when={deployedModels().length > 0}
              fallback={<EmptyState icon="⎈" title="No Models Deployed" subtitle="Models managed by the flexinfer-system controller will appear here." />}
            >
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                <For each={deployedModels()}>
                  {(model) => (
                    <DeployedModelCard
                      model={model}
                      actionLoading={actionLoading()}
                      onScale={(replicas) => scaleModel(model.id, replicas)}
                      getStatusColor={getStatusColor}
                      getStatusDot={getStatusDot}
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Match>

        {/* Registry Tab */}
        <Match when={activeTab() === 'registry'}>
          <Show
            when={registryModels().length > 0}
            fallback={<EmptyState icon="📦" title="No Models in Registry" subtitle="Sync from flexinfer-system or search HuggingFace/CivitAI." />}
          >
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <For each={registryModels()}>
                {(model) => (
                  <RegistryModelCard
                    model={model}
                    actionLoading={actionLoading()}
                    onDownload={() => handleStartDownload(model.id)}
                    onDelete={() => handleDelete(model.id)}
                    getStatusColor={getStatusColor}
                    getStatusDot={getStatusDot}
                    formatSize={formatSize}
                  />
                )}
              </For>
            </div>
          </Show>
        </Match>

        {/* Search Tab */}
        <Match when={activeTab() === 'search'}>
          <div class="glass-panel p-4">
            <div class="flex gap-3">
              <select
                value={searchSource()}
                onChange={(e) => setSearchSource(e.target.value as 'huggingface' | 'civitai')}
                class="rounded-md bg-white/10 px-3 py-2 text-sm text-text-main"
              >
                <option value="huggingface">HuggingFace</option>
                <option value="civitai">CivitAI</option>
              </select>
              <input
                type="text"
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder={searchSource() === 'huggingface' ? 'Search LLMs, embeddings...' : 'Search diffusion models...'}
                class="flex-1 rounded-md bg-white/10 px-4 py-2 text-sm text-text-main placeholder-text-dim focus:outline-none focus:ring-1 focus:ring-neon-cyan"
              />
              <button
                onClick={handleSearch}
                disabled={searching() || !searchQuery().trim()}
                class="rounded-md bg-neon-cyan/20 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
              >
                {searching() ? 'Searching...' : 'Search'}
              </button>
            </div>
          </div>

          <Show when={searchResults.length > 0}>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <For each={searchResults}>
                {(model) => (
                  <SearchResultCard
                    model={model}
                    actionLoading={actionLoading()}
                    onRegister={() => handleRegister(model.source, model.source_id)}
                    formatSize={formatSize}
                  />
                )}
              </For>
            </div>
          </Show>
        </Match>
      </Switch>
    </div>
  );
};

// Subcomponents
const LoadingState: Component<{ message: string }> = (props) => (
  <div class="glass-panel flex flex-1 items-center justify-center">
    <div class="text-center">
      <div class="mb-4 text-4xl animate-pulse-glow text-neon-cyan">⬡</div>
      <p class="text-text-dim">{props.message}</p>
    </div>
  </div>
);

const EmptyState: Component<{ icon: string; title: string; subtitle: string }> = (props) => (
  <div class="glass-panel flex flex-1 items-center justify-center">
    <div class="text-center">
      <div class="mb-4 text-6xl text-neon-purple/30">{props.icon}</div>
      <h3 class="mb-2 text-xl font-medium text-text-main">{props.title}</h3>
      <p class="text-text-dim">{props.subtitle}</p>
    </div>
  </div>
);

// Deployed model card — data from flexinfer-system controller via registry
const DeployedModelCard: Component<{
  model: RegisteredModel;
  actionLoading: string | null;
  onScale: (replicas: number) => void;
  getStatusColor: (s: string) => string;
  getStatusDot: (s: string) => string;
}> = (props) => {
  const meta = () => props.model.metadata || {};
  const isRunning = () => props.model.deployment_status === 'deployed';
  const isPending = () => props.model.deployment_status === 'pending';

  return (
    <div class="glass-panel p-4 group hover:-translate-y-0.5 transition-all duration-200">
      {/* Header */}
      <div class="mb-3 flex items-start justify-between">
        <div class="flex-1 min-w-0">
          <h3 class="font-medium text-text-main truncate">{props.model.name}</h3>
          <div class="flex items-center gap-2 mt-0.5">
            <Show when={props.model.deployment_name}>
              <span class="text-[10px] text-text-dim font-mono">{props.model.deployment_name}</span>
            </Show>
            <Show when={props.model.deployment_ns}>
              <span class="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-text-dim font-mono">
                {props.model.deployment_ns}
              </span>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-2 ml-2 flex-shrink-0">
          <span class={props.getStatusDot(props.model.deployment_status)} />
          <span class={`text-sm capitalize ${props.getStatusColor(props.model.deployment_status)}`}>
            {props.model.deployment_status}
          </span>
        </div>
      </div>

      {/* Info grid */}
      <div class="mb-3 space-y-1.5 text-sm">
        <Show when={props.model.type}>
          <div class="flex justify-between">
            <span class="text-text-dim">Type</span>
            <span class="text-text-muted capitalize">{props.model.type}</span>
          </div>
        </Show>
        <div class="flex justify-between">
          <span class="text-text-dim">Replicas</span>
          <div class="flex items-center gap-1.5">
            {/* Replica dots */}
            <For each={Array.from({ length: Math.max(props.model.replicas, 1) })}>
              {(_, i) => (
                <div
                  class={`w-2 h-2 rounded-full ${
                    isRunning() ? 'bg-status-ok shadow-[0_0_4px_var(--color-ok)]' :
                    isPending() && i() === 0 ? 'bg-status-warn animate-pulse' :
                    'bg-white/10'
                  }`}
                />
              )}
            </For>
            <span class="text-text-muted ml-1">{props.model.replicas}</span>
          </div>
        </div>
        <Show when={meta().backend}>
          <div class="flex justify-between">
            <span class="text-text-dim">Backend</span>
            <span class="text-neon-cyan font-mono text-xs">{meta().backend}</span>
          </div>
        </Show>
        <Show when={meta().hardware}>
          <div class="flex justify-between">
            <span class="text-text-dim">Hardware</span>
            <span class="text-neon-purple font-mono text-xs">{meta().hardware}</span>
          </div>
        </Show>
        <Show when={meta().parameters}>
          <div class="flex justify-between">
            <span class="text-text-dim">Parameters</span>
            <span class="text-text-muted font-mono text-xs">{meta().parameters}</span>
          </div>
        </Show>
        <Show when={meta().served_model}>
          <div class="flex justify-between">
            <span class="text-text-dim">Served As</span>
            <span class="text-text-muted font-mono text-xs truncate max-w-[180px]">{meta().served_model}</span>
          </div>
        </Show>
        <Show when={meta().aliases}>
          <div class="flex justify-between">
            <span class="text-text-dim">Aliases</span>
            <span class="text-text-muted font-mono text-xs truncate max-w-[180px]">{meta().aliases}</span>
          </div>
        </Show>
      </div>

      {/* Description */}
      <Show when={props.model.description || meta().description}>
        <p class="text-xs text-text-dim mb-3 line-clamp-2">
          {props.model.description || meta().description}
        </p>
      </Show>

      {/* Actions */}
      <div class="flex gap-2">
        <Show
          when={isRunning() || isPending()}
          fallback={
            <button
              onClick={() => props.onScale(1)}
              disabled={props.actionLoading === props.model.id}
              class="flex-1 rounded-md bg-status-ok/20 px-3 py-1.5 text-sm font-medium text-status-ok transition-colors hover:bg-status-ok/30 disabled:opacity-50"
            >
              Start
            </button>
          }
        >
          <button
            onClick={() => props.onScale(0)}
            disabled={props.actionLoading === props.model.id}
            class="flex-1 rounded-md bg-status-error/20 px-3 py-1.5 text-sm font-medium text-status-error transition-colors hover:bg-status-error/30 disabled:opacity-50"
          >
            Stop
          </button>
        </Show>
        <Show when={isRunning()}>
          <button
            onClick={() => props.onScale(props.model.replicas + 1)}
            disabled={props.actionLoading === props.model.id}
            class="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-white/20 disabled:opacity-50"
            title="Scale up"
          >
            +1
          </button>
        </Show>
      </div>
    </div>
  );
};

const RegistryModelCard: Component<{
  model: RegisteredModel;
  actionLoading: string | null;
  onDownload: () => void;
  onDelete: () => void;
  getStatusColor: (s: string) => string;
  getStatusDot: (s: string) => string;
  formatSize: (bytes: number) => string;
}> = (props) => (
  <div class="glass-panel p-4">
    <div class="mb-3 flex items-start justify-between">
      <div class="flex-1 min-w-0">
        <h3 class="font-medium text-text-main truncate">{props.model.name}</h3>
        <p class="text-xs text-text-dim truncate">{props.model.source_id || props.model.id}</p>
      </div>
      <span class={`ml-2 rounded-full px-2 py-0.5 text-xs flex-shrink-0 ${
        props.model.source === 'huggingface' ? 'bg-yellow-500/20 text-yellow-400' :
        props.model.source === 'local' ? 'bg-neon-purple/20 text-neon-purple' :
        'bg-blue-500/20 text-blue-400'
      }`}>
        {props.model.source === 'huggingface' ? '🤗 HF' : props.model.source === 'local' ? '⎈ Local' : '🎨 Civit'}
      </span>
    </div>

    <p class="mb-3 text-xs text-text-dim line-clamp-2">{props.model.description || 'No description'}</p>

    <div class="mb-3 space-y-1 text-xs">
      <div class="flex justify-between">
        <span class="text-text-dim">Type</span>
        <span class="text-text-muted capitalize">{props.model.type}</span>
      </div>
      <Show when={props.model.size > 0}>
        <div class="flex justify-between">
          <span class="text-text-dim">Size</span>
          <span class="text-text-muted">{props.formatSize(props.model.size)}</span>
        </div>
      </Show>
      <Show when={props.model.download_status && props.model.download_status !== 'pending'}>
        <div class="flex justify-between">
          <span class="text-text-dim">Download</span>
          <span class={props.getStatusColor(props.model.download_status)}>
            {props.model.download_status === 'downloading'
              ? `${props.model.download_progress.toFixed(0)}%`
              : props.model.download_status}
          </span>
        </div>
      </Show>
      <Show when={props.model.deployment_status !== 'none'}>
        <div class="flex justify-between">
          <span class="text-text-dim">Deployment</span>
          <div class="flex items-center gap-1.5">
            <span class={props.getStatusDot(props.model.deployment_status)} />
            <span class={props.getStatusColor(props.model.deployment_status)}>
              {props.model.deployment_status}
            </span>
          </div>
        </div>
      </Show>
      <Show when={props.model.metadata?.parameters}>
        <div class="flex justify-between">
          <span class="text-text-dim">Params</span>
          <span class="text-text-muted font-mono">{props.model.metadata!.parameters}</span>
        </div>
      </Show>
    </div>

    <Show when={props.model.download_status === 'downloading'}>
      <div class="mb-3 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          class="h-full bg-neon-cyan transition-all"
          style={{ width: `${props.model.download_progress}%` }}
        />
      </div>
    </Show>

    <div class="flex gap-2">
      <Show when={props.model.download_status === 'pending' || props.model.download_status === 'failed'}>
        <button
          onClick={() => props.onDownload()}
          disabled={props.actionLoading === props.model.id}
          class="flex-1 rounded-md bg-neon-cyan/20 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
        >
          Download
        </button>
      </Show>
      <Show when={props.model.download_status === 'completed' && props.model.deployment_status === 'none'}>
        <button
          disabled
          class="flex-1 rounded-md bg-neon-purple/20 px-3 py-1.5 text-sm font-medium text-neon-purple opacity-50"
        >
          Deploy (Soon)
        </button>
      </Show>
      <button
        onClick={() => props.onDelete()}
        disabled={props.actionLoading === props.model.id}
        class="rounded-md bg-status-error/20 px-3 py-1.5 text-sm font-medium text-status-error transition-colors hover:bg-status-error/30 disabled:opacity-50"
      >
        ✕
      </button>
    </div>
  </div>
);

const SearchResultCard: Component<{
  model: RegisteredModel;
  actionLoading: string | null;
  onRegister: () => void;
  formatSize: (bytes: number) => string;
}> = (props) => (
  <div class="glass-panel p-4">
    <div class="mb-3 flex items-start justify-between">
      <div class="flex-1 min-w-0">
        <h3 class="font-medium text-text-main truncate">{props.model.name}</h3>
        <p class="text-xs text-text-dim truncate">{props.model.source_id}</p>
      </div>
      <span class={`ml-2 rounded-full px-2 py-0.5 text-xs ${
        props.model.source === 'huggingface' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
      }`}>
        {props.model.source === 'huggingface' ? '🤗 HF' : '🎨 Civit'}
      </span>
    </div>

    <p class="mb-3 text-xs text-text-dim line-clamp-2">{props.model.description || 'No description'}</p>

    <div class="mb-3 flex flex-wrap gap-1">
      <For each={(props.model.tags || []).slice(0, 4)}>
        {(tag) => (
          <span class="rounded-full bg-white/10 px-2 py-0.5 text-xs text-text-dim">{tag}</span>
        )}
      </For>
    </div>

    <div class="mb-3 flex justify-between text-xs">
      <span class="text-text-dim">Size: {props.formatSize(props.model.size)}</span>
      <span class="text-text-dim capitalize">{props.model.type}</span>
    </div>

    <button
      onClick={() => props.onRegister()}
      disabled={props.actionLoading === props.model.source_id}
      class="w-full rounded-md bg-status-ok/20 px-3 py-1.5 text-sm font-medium text-status-ok transition-colors hover:bg-status-ok/30 disabled:opacity-50"
    >
      {props.actionLoading === props.model.source_id ? 'Adding...' : 'Add to Registry'}
    </button>
  </div>
);

export default Models;
