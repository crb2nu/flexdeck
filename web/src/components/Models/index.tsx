import { Component, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { K8sDeployment, K8sPod } from '../../lib/types';

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
}

const Models: Component = () => {
  const [models, setModels] = createStore<ModelInstance[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [actionLoading, setActionLoading] = createSignal<string | null>(null);

  const fetchModels = async () => {
    try {
      // Fetch vLLM deployments (labeled with app=vllm or similar)
      const [deploymentsRes, podsRes] = await Promise.all([
        fetch('/api/k8s/deployments'),
        fetch('/api/k8s/pods'),
      ]);

      if (!deploymentsRes.ok || !podsRes.ok) {
        throw new Error('Failed to fetch K8s resources');
      }

      const deployments: K8sDeployment[] = await deploymentsRes.json();
      const pods: K8sPod[] = await podsRes.json();

      // Filter for AI/ML workloads
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

        // Extract model name from container args or env
        let model = 'Unknown';
        const container = d.spec.template.spec.containers[0];
        if (container?.image) {
          const imageParts = container.image.split(':');
          model = imageParts[imageParts.length - 1] || imageParts[0].split('/').pop() || 'Unknown';
        }

        // Check for GPU annotation/label
        const gpuType = d.metadata.annotations?.['gpu-type'] || d.metadata.labels?.['gpu-type'];

        // Determine status
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

        return {
          name: d.metadata.name,
          namespace: d.metadata.namespace || 'default',
          model,
          status,
          replicas: d.spec.replicas,
          readyReplicas: d.status.readyReplicas || 0,
          gpuType,
          pod: runningPod,
        };
      });

      setModels(instances);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    fetchModels();
    const interval = setInterval(fetchModels, 15000);
    onCleanup(() => clearInterval(interval));
  });

  const scaleModel = async (name: string, namespace: string, replicas: number) => {
    setActionLoading(name);
    try {
      const response = await fetch(`/api/k8s/deployments/${namespace}/${name}/scale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replicas }),
      });

      if (!response.ok) {
        throw new Error(`Failed to scale: ${response.statusText}`);
      }

      await fetchModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scale failed');
    } finally {
      setActionLoading(null);
    }
  };

  const restartModel = async (name: string, namespace: string) => {
    setActionLoading(name);
    try {
      const response = await fetch(`/api/k8s/deployments/${namespace}/${name}/restart`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(`Failed to restart: ${response.statusText}`);
      }

      await fetchModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restart failed');
    } finally {
      setActionLoading(null);
    }
  };

  const getStatusColor = (status: ModelInstance['status']) => {
    switch (status) {
      case 'running':
        return 'text-status-ok';
      case 'pending':
        return 'text-status-warn';
      case 'stopped':
        return 'text-text-dim';
      case 'error':
        return 'text-status-error';
    }
  };

  const getStatusDot = (status: ModelInstance['status']) => {
    switch (status) {
      case 'running':
        return 'status-dot-ok';
      case 'pending':
        return 'status-dot-warn animate-pulse';
      case 'stopped':
        return 'bg-text-dim/50 h-2 w-2 rounded-full';
      case 'error':
        return 'status-dot-error';
    }
  };

  return (
    <div class="flex h-full flex-col gap-4">
      {/* Header */}
      <div class="glass-panel flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-4">
          <h2 class="text-lg font-medium text-text-main">AI Models</h2>
          <span class="text-sm text-text-dim">
            {models.filter((m) => m.status === 'running').length} running
          </span>
        </div>

        <button
          onClick={fetchModels}
          disabled={loading()}
          class="rounded-md bg-neon-cyan/20 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      <Show when={error()}>
        <div class="glass-panel p-4 text-sm text-status-error">{error()}</div>
      </Show>

      {/* Models Grid */}
      <Show
        when={!loading() || models.length > 0}
        fallback={
          <div class="glass-panel flex flex-1 items-center justify-center">
            <div class="text-center">
              <div class="mb-4 text-4xl animate-pulse-glow text-neon-cyan">⬡</div>
              <p class="text-text-dim">Loading models...</p>
            </div>
          </div>
        }
      >
        <Show
          when={models.length > 0}
          fallback={
            <div class="glass-panel flex flex-1 items-center justify-center">
              <div class="text-center">
                <div class="mb-4 text-6xl text-neon-purple/30">◈</div>
                <h3 class="mb-2 text-xl font-medium text-text-main">No AI Models Found</h3>
                <p class="text-text-dim">
                  Deploy vLLM, Ollama, or other AI workloads to see them here.
                </p>
              </div>
            </div>
          }
        >
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            <For each={models}>
              {(model) => (
                <div class="glass-panel p-4">
                  {/* Header */}
                  <div class="mb-4 flex items-start justify-between">
                    <div>
                      <h3 class="font-medium text-text-main">{model.name}</h3>
                      <p class="text-xs text-text-dim">{model.namespace}</p>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class={getStatusDot(model.status)} />
                      <span class={`text-sm capitalize ${getStatusColor(model.status)}`}>
                        {model.status}
                      </span>
                    </div>
                  </div>

                  {/* Info */}
                  <div class="mb-4 space-y-2 text-sm">
                    <div class="flex justify-between">
                      <span class="text-text-dim">Model</span>
                      <span class="text-text-muted">{model.model}</span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-text-dim">Replicas</span>
                      <span class="text-text-muted">
                        {model.readyReplicas}/{model.replicas}
                      </span>
                    </div>
                    <Show when={model.gpuType}>
                      <div class="flex justify-between">
                        <span class="text-text-dim">GPU</span>
                        <span class="text-neon-cyan">{model.gpuType}</span>
                      </div>
                    </Show>
                  </div>

                  {/* Actions */}
                  <div class="flex gap-2">
                    <Show
                      when={model.status === 'running' || model.status === 'pending'}
                      fallback={
                        <button
                          onClick={() => scaleModel(model.name, model.namespace, 1)}
                          disabled={actionLoading() === model.name}
                          class="flex-1 rounded-md bg-status-ok/20 px-3 py-1.5 text-sm font-medium text-status-ok transition-colors hover:bg-status-ok/30 disabled:opacity-50"
                        >
                          Start
                        </button>
                      }
                    >
                      <button
                        onClick={() => scaleModel(model.name, model.namespace, 0)}
                        disabled={actionLoading() === model.name}
                        class="flex-1 rounded-md bg-status-error/20 px-3 py-1.5 text-sm font-medium text-status-error transition-colors hover:bg-status-error/30 disabled:opacity-50"
                      >
                        Stop
                      </button>
                    </Show>

                    <button
                      onClick={() => restartModel(model.name, model.namespace)}
                      disabled={actionLoading() === model.name || model.status === 'stopped'}
                      class="rounded-md bg-white/10 px-3 py-1.5 text-sm font-medium text-text-muted transition-colors hover:bg-white/20 disabled:opacity-50"
                    >
                      Restart
                    </button>
                  </div>

                  <Show when={actionLoading() === model.name}>
                    <div class="mt-2 text-center text-xs text-text-dim">Processing...</div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export default Models;
