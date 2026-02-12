import { Component, For, Show, createSignal, onMount } from 'solid-js';
import { modelsApi } from '../../../lib/api';

interface DeploymentInfo {
  name: string;
  namespace: string;
  replicas: number;
  ready: number;
  status: 'deployed' | 'pending' | 'stopped' | 'error';
  model?: string;
  backend?: string;
  hardware?: string;
}

interface DeploymentWidgetProps {
  data: {
    deployments?: DeploymentInfo[];
    namespace?: string;
    autoDiscover?: boolean;
  };
}

const DeploymentWidget: Component<DeploymentWidgetProps> = (props) => {
  const [deployments, setDeployments] = createSignal<DeploymentInfo[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');

  const statusConfig = (status: string) => {
    switch (status) {
      case 'deployed':
        return { color: 'text-status-ok', bg: 'bg-status-ok', label: 'Running', icon: '▲' };
      case 'pending':
        return { color: 'text-status-warn', bg: 'bg-status-warn', label: 'Pending', icon: '◑' };
      case 'stopped':
        return { color: 'text-text-dim', bg: 'bg-gray-500', label: 'Stopped', icon: '■' };
      case 'error':
        return { color: 'text-status-error', bg: 'bg-status-error', label: 'Error', icon: '✕' };
      default:
        return { color: 'text-text-dim', bg: 'bg-gray-500', label: 'Unknown', icon: '?' };
    }
  };

  onMount(async () => {
    // If deployments provided statically, use them
    if (props.data.deployments) {
      setDeployments(props.data.deployments);
      setLoading(false);
      return;
    }

    // Auto-discover from API
    try {
      setLoading(true);
      const result = await modelsApi.list();
      const models = result?.models || [];
      const mapped: DeploymentInfo[] = models
        .filter((m: Record<string, unknown>) => m.deployment_name)
        .map((m: Record<string, unknown>) => ({
          name: (m.deployment_name as string) || (m.name as string),
          namespace: (m.deployment_ns as string) || 'ai',
          replicas: (m.replicas as number) || 0,
          ready: m.deployment_status === 'deployed' ? ((m.replicas as number) || 0) : 0,
          status: (m.deployment_status as string) || 'stopped',
          model: m.name as string,
          backend: (m.metadata as Record<string, string>)?.backend,
          hardware: (m.metadata as Record<string, string>)?.hardware,
        }));
      setDeployments(mapped);
    } catch {
      setError('Failed to fetch deployments');
    } finally {
      setLoading(false);
    }
  });

  const totalRunning = () => deployments().filter(d => d.status === 'deployed').length;
  const totalCount = () => deployments().length;

  return (
    <div class="rounded-lg border border-white/10 bg-black/20 overflow-hidden">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div class="flex items-center gap-2">
          <span class="text-neon-purple text-sm">⎈</span>
          <h4 class="text-xs font-bold uppercase tracking-wider text-text-dim">
            Model Deployments
          </h4>
        </div>
        <Show when={!loading()}>
          <div class="flex items-center gap-1.5 text-[10px] font-mono">
            <span class="text-status-ok">{totalRunning()}</span>
            <span class="text-text-dim">/</span>
            <span class="text-text-dim">{totalCount()}</span>
            <span class="text-text-dim">running</span>
          </div>
        </Show>
      </div>

      {/* Loading */}
      <Show when={loading()}>
        <div class="flex items-center justify-center py-8 gap-2">
          <div class="h-4 w-4 border-2 border-neon-cyan/30 border-t-neon-cyan rounded-full animate-spin" />
          <span class="text-xs text-text-dim font-mono">Discovering models...</span>
        </div>
      </Show>

      {/* Error */}
      <Show when={error()}>
        <div class="px-4 py-3 text-xs text-status-error font-mono">{error()}</div>
      </Show>

      {/* Deployments list */}
      <Show when={!loading() && !error() && deployments().length > 0}>
        <div class="divide-y divide-white/5">
          <For each={deployments()}>
            {(dep) => {
              const cfg = statusConfig(dep.status);
              return (
                <div class="px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.02] transition-colors">
                  {/* Status icon */}
                  <span class={`text-xs ${cfg.color} flex-shrink-0`}>{cfg.icon}</span>

                  {/* Info */}
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-sm text-text-main font-medium truncate">
                        {dep.model || dep.name}
                      </span>
                      <Show when={dep.backend}>
                        <span class="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-text-dim font-mono uppercase">
                          {dep.backend}
                        </span>
                      </Show>
                    </div>
                    <div class="flex items-center gap-3 mt-0.5 text-[10px] text-text-dim font-mono">
                      <span>{dep.namespace}</span>
                      <Show when={dep.hardware}>
                        <span class="text-neon-purple/70">{dep.hardware}</span>
                      </Show>
                    </div>
                  </div>

                  {/* Replica indicators */}
                  <div class="flex items-center gap-1 flex-shrink-0">
                    <For each={Array.from({ length: Math.max(dep.replicas, 1) })}>
                      {(_, i) => (
                        <div
                          class={`w-2 h-2 rounded-full transition-colors ${
                            i() < dep.ready
                              ? `${cfg.bg} shadow-sm`
                              : dep.status === 'pending'
                              ? 'bg-status-warn/40 animate-pulse'
                              : 'bg-white/10'
                          }`}
                        />
                      )}
                    </For>
                    <span class={`ml-1 text-[10px] font-mono ${cfg.color}`}>
                      {dep.ready}/{dep.replicas}
                    </span>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      {/* Empty state */}
      <Show when={!loading() && !error() && deployments().length === 0}>
        <div class="px-4 py-6 text-center text-xs text-text-dim font-mono">
          No model deployments found
        </div>
      </Show>
    </div>
  );
};

export default DeploymentWidget;
