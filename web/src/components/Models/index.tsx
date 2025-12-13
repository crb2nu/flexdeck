import { Component, createSignal, createEffect, onCleanup, For, Show, Switch, Match } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { K8sDeployment, K8sPod, ModelThroughput, RegisteredModel, ModelSearchResult } from '../../lib/types';
import { litellm, modelsApi, k8s } from '../../lib/api';
import { Sparkline } from '../shared';

type Tab = 'running' | 'registry' | 'search';

interface ModelInstance {
  name: string;
  namespace: string;
  model: string;
  status: 'running' | 'pending' | 'stopped' | 'error';
  replicas: number;
  readyReplicas: number;
  gpuType?: string;
  endpoint?: string;
  pod?: K8sPod;
  metrics?: ModelThroughput;
}

const Models: Component = () => {
  const [activeTab, setActiveTab] = createSignal<Tab>('running');
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);

  // Running models state
  const [runningModels, setRunningModels] = createStore<ModelInstance[]>([]);

  // Registry state
  const [registeredModels, setRegisteredModels] = createStore<RegisteredModel[]>([]);

  // Search state
  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchSource, setSearchSource] = createSignal<'huggingface' | 'civitai'>('huggingface');
  const [searchResults, setSearchResults] = createStore<RegisteredModel[]>([]);
  const [searching, setSearching] = createSignal(false);

  // Fetch running K8s models
  const fetchRunningModels = async () => {
    try {
      const [deploymentsRes, podsRes, metricsData] = await Promise.all([
        fetch('/api/k8s/deployments'),
        fetch('/api/k8s/pods'),
        litellm.metrics().catch(() => ({ models: [] })),
      ]);

      if (!deploymentsRes.ok || !podsRes.ok) {
        throw new Error('Failed to fetch K8s resources');
      }

      const deploymentsData = await deploymentsRes.json();
      const podsData = await podsRes.json();

      const deployments: K8sDeployment[] = deploymentsData.items || deploymentsData;
      const pods: K8sPod[] = podsData.items || podsData;

      const metricsMap = new Map<string, ModelThroughput>();
      (metricsData.models || []).forEach((m: ModelThroughput) => {
        metricsMap.set(m.model.toLowerCase(), m);
      });

      const aiLabels = ['vllm', 'llama', 'ollama', 'sglang', 'tgi'];
      const aiDeployments = deployments.filter((d) => {
        const name = d.metadata.name.toLowerCase();
        const labels = Object.values(d.metadata.labels || {}).join(' ').toLowerCase();
        return aiLabels.some((l) => name.includes(l) || labels.includes(l));
      });

      const instances: ModelInstance[] = aiDeployments.map((d) => {
        const matchingPods = pods.filter(
          (p) =>
            p.metadata.namespace === d.metadata.namespace &&
            Object.entries(d.spec.selector.matchLabels).every(
              ([k, v]) => p.metadata.labels?.[k] === v
            )
        );

        const runningPod = matchingPods.find((p) => p.status.phase === 'Running');

        let model = 'Unknown';
        const container = d.spec.template.spec.containers[0];
        if (container?.image) {
          const imageParts = container.image.split(':');
          model = imageParts[imageParts.length - 1] || imageParts[0].split('/').pop() || 'Unknown';
        }

        const gpuType = d.metadata.annotations?.['gpu-type'] || d.metadata.labels?.['gpu-type'];

        let status: ModelInstance['status'] = 'stopped';
        if (d.spec.replicas === 0) {
          status = 'stopped';
        } else if (d.status.readyReplicas === d.spec.replicas) {
          status = 'running';
        } else if (d.status.readyReplicas && d.status.readyReplicas > 0) {
          status = 'pending';
        } else if (d.status.replicas && d.status.replicas > 0) {
          status = 'pending';
        } else {
          status = 'error';
        }

        const deploymentNameLower = d.metadata.name.toLowerCase();
        const modelLower = model.toLowerCase();
        const metrics = metricsMap.get(deploymentNameLower) ||
                        metricsMap.get(modelLower) ||
                        Array.from(metricsMap.entries()).find(([k]) =>
                          k.includes(deploymentNameLower) || deploymentNameLower.includes(k) ||
                          k.includes(modelLower) || modelLower.includes(k)
                        )?.[1];

        return {
          name: d.metadata.name,
          namespace: d.metadata.namespace || 'default',
          model,
          status,
          replicas: d.spec.replicas,
          readyReplicas: d.status.readyReplicas || 0,
          gpuType,
          pod: runningPod,
          metrics,
        };
      });

      setRunningModels(instances);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setLoading(false);
    }
  };

  // Fetch registered models from registry
  const fetchRegistry = async () => {
    try {
      const data = await modelsApi.list();
      setRegisteredModels(data.models || []);
    } catch (err) {
      console.error('Failed to fetch model registry:', err);
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
      await fetchRegistry();
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
      await fetchRegistry();
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
      await fetchRegistry();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setActionLoading(null);
    }
  };

  // Scale K8s deployment
  const scaleModel = async (name: string, namespace: string, replicas: number) => {
    setActionLoading(name);
    try {
      await k8s.scaleDeployment(namespace, name, replicas);
      await fetchRunningModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scale failed');
    } finally {
      setActionLoading(null);
    }
  };

  const restartModel = async (name: string, namespace: string) => {
    setActionLoading(name);
    try {
      await k8s.restartDeployment(namespace, name);
      await fetchRunningModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restart failed');
    } finally {
      setActionLoading(null);
    }
  };

  createEffect(() => {
    fetchRunningModels();
    fetchRegistry();
    const interval = setInterval(() => {
      fetchRunningModels();
      fetchRegistry();
    }, 15000);
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
              onClick={() => setActiveTab('running')}
              class={`rounded px-3 py-1 text-sm transition-colors ${
                activeTab() === 'running' ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-text-dim hover:text-text-main'
              }`}
            >
              Running
            </button>
            <button
              onClick={() => setActiveTab('registry')}
              class={`rounded px-3 py-1 text-sm transition-colors ${
                activeTab() === 'registry' ? 'bg-neon-purple/20 text-neon-purple' : 'text-text-dim hover:text-text-main'
              }`}
            >
              Registry
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

        <button
          onClick={() => { fetchRunningModels(); fetchRegistry(); }}
          disabled={loading()}
          class="rounded-md bg-neon-cyan/20 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <Show when={error()}>
        <div class="glass-panel p-4 text-sm text-status-error">{error()}</div>
      </Show>

      {/* Tab content */}
      <Switch>
        {/* Running Models Tab */}
        <Match when={activeTab() === 'running'}>
          <Show
            when={!loading() || runningModels.length > 0}
            fallback={<LoadingState message="Loading running models..." />}
          >
            <Show
              when={runningModels.length > 0}
              fallback={<EmptyState icon="◈" title="No AI Models Running" subtitle="Deploy vLLM, Ollama, or other AI workloads to see them here." />}
            >
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                <For each={runningModels}>
                  {(model) => (
                    <RunningModelCard
                      model={model}
                      actionLoading={actionLoading()}
                      onScale={(replicas) => scaleModel(model.name, model.namespace, replicas)}
                      onRestart={() => restartModel(model.name, model.namespace)}
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
            when={registeredModels.length > 0}
            fallback={<EmptyState icon="📦" title="No Models in Registry" subtitle="Search and add models from HuggingFace or CivitAI." />}
          >
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <For each={registeredModels}>
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

const RunningModelCard: Component<{
  model: ModelInstance;
  actionLoading: string | null;
  onScale: (replicas: number) => void;
  onRestart: () => void;
  getStatusColor: (s: string) => string;
  getStatusDot: (s: string) => string;
}> = (props) => (
  <div class="glass-panel p-4">
    <div class="mb-4 flex items-start justify-between">
      <div>
        <h3 class="font-medium text-text-main">{props.model.name}</h3>
        <p class="text-xs text-text-dim">{props.model.namespace}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class={props.getStatusDot(props.model.status)} />
        <span class={`text-sm capitalize ${props.getStatusColor(props.model.status)}`}>
          {props.model.status}
        </span>
      </div>
    </div>

    <div class="mb-4 space-y-2 text-sm">
      <div class="flex justify-between">
        <span class="text-text-dim">Model</span>
        <span class="text-text-muted">{props.model.model}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-text-dim">Replicas</span>
        <span class="text-text-muted">{props.model.readyReplicas}/{props.model.replicas}</span>
      </div>
      <Show when={props.model.gpuType}>
        <div class="flex justify-between">
          <span class="text-text-dim">GPU</span>
          <span class="text-neon-cyan">{props.model.gpuType}</span>
        </div>
      </Show>
    </div>

    <Show when={props.model.metrics}>
      <div class="mb-4 rounded-md bg-white/5 p-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-medium text-text-dim">Throughput</span>
          <Sparkline data={props.model.metrics!.sparkline || []} trend={props.model.metrics!.trend} width={60} height={20} />
        </div>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div>
            <div class="text-lg font-semibold text-neon-cyan">{props.model.metrics!.tok_per_sec_1m.toFixed(0)}</div>
            <div class="text-xs text-text-dim">tok/s 1m</div>
          </div>
          <div>
            <div class="text-lg font-semibold text-text-muted">{props.model.metrics!.tok_per_sec_5m.toFixed(0)}</div>
            <div class="text-xs text-text-dim">tok/s 5m</div>
          </div>
          <div>
            <div class="text-lg font-semibold text-text-muted">{props.model.metrics!.tok_per_sec_15m.toFixed(0)}</div>
            <div class="text-xs text-text-dim">tok/s 15m</div>
          </div>
        </div>
        <div class="mt-2 flex justify-between text-xs text-text-dim">
          <span>{props.model.metrics!.requests_per_min.toFixed(1)} req/min</span>
          <span>{props.model.metrics!.avg_latency_ms.toFixed(0)}ms latency</span>
        </div>
      </div>
    </Show>

    <div class="flex gap-2">
      <Show
        when={props.model.status === 'running' || props.model.status === 'pending'}
        fallback={
          <button
            onClick={() => props.onScale(1)}
            disabled={props.actionLoading === props.model.name}
            class="flex-1 rounded-md bg-status-ok/20 px-3 py-1.5 text-sm font-medium text-status-ok transition-colors hover:bg-status-ok/30 disabled:opacity-50"
          >
            Start
          </button>
        }
      >
        <button
          onClick={() => props.onScale(0)}
          disabled={props.actionLoading === props.model.name}
          class="flex-1 rounded-md bg-status-error/20 px-3 py-1.5 text-sm font-medium text-status-error transition-colors hover:bg-status-error/30 disabled:opacity-50"
        >
          Stop
        </button>
      </Show>
      <button
        onClick={props.onRestart}
        disabled={props.actionLoading === props.model.name || props.model.status === 'stopped'}
        class="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-white/20 disabled:opacity-50"
      >
        Restart
      </button>
    </div>
  </div>
);

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
        <p class="text-xs text-text-dim truncate">{props.model.source_id}</p>
      </div>
      <span class={`ml-2 rounded-full px-2 py-0.5 text-xs ${
        props.model.source === 'huggingface' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
      }`}>
        {props.model.source === 'huggingface' ? '🤗 HF' : '🎨 Civit'}
      </span>
    </div>

    <p class="mb-3 text-xs text-text-dim line-clamp-2">{props.model.description || 'No description'}</p>

    <div class="mb-3 space-y-1 text-xs">
      <div class="flex justify-between">
        <span class="text-text-dim">Type</span>
        <span class="text-text-muted capitalize">{props.model.type}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-text-dim">Size</span>
        <span class="text-text-muted">{props.formatSize(props.model.size)}</span>
      </div>
      <div class="flex justify-between">
        <span class="text-text-dim">Download</span>
        <span class={props.getStatusColor(props.model.download_status)}>
          {props.model.download_status === 'downloading'
            ? `${props.model.download_progress.toFixed(0)}%`
            : props.model.download_status}
        </span>
      </div>
      <Show when={props.model.deployment_status !== 'none'}>
        <div class="flex justify-between">
          <span class="text-text-dim">Deployment</span>
          <span class={props.getStatusColor(props.model.deployment_status)}>
            {props.model.deployment_status}
          </span>
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
          onClick={props.onDownload}
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
        onClick={props.onDelete}
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
      onClick={props.onRegister}
      disabled={props.actionLoading === props.model.source_id}
      class="w-full rounded-md bg-status-ok/20 px-3 py-1.5 text-sm font-medium text-status-ok transition-colors hover:bg-status-ok/30 disabled:opacity-50"
    >
      {props.actionLoading === props.model.source_id ? 'Adding...' : 'Add to Registry'}
    </button>
  </div>
);

export default Models;
