import { Component, createMemo, createResource, For, Show } from 'solid-js';
import { modelsApi } from '../../../lib/api';
import type { RegisteredModel } from '../../../lib/types';

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

function normalizeDeploymentStatus(status: RegisteredModel['deployment_status']): DeploymentInfo['status'] {
  switch (status) {
    case 'deployed':
      return 'deployed';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'error';
    case 'stopped':
    case 'none':
    default:
      return 'stopped';
  }
}

function mapRegisteredModelToDeployment(model: RegisteredModel): DeploymentInfo | null {
  if (!model.deployment_name) return null;

  const status = normalizeDeploymentStatus(model.deployment_status);

  return {
    name: model.deployment_name || model.name,
    namespace: model.deployment_ns || 'ai',
    replicas: model.replicas || 0,
    ready: status === 'deployed' ? (model.replicas || 0) : 0,
    status,
    model: model.name,
    backend: model.metadata?.backend as string | undefined,
    hardware: model.metadata?.hardware as string | undefined,
  };
}

async function loadDeployments(props: DeploymentWidgetProps['data']): Promise<DeploymentInfo[]> {
  if (props.deployments) {
    return props.deployments;
  }

  const result = await modelsApi.list();
  const models = result?.models || [];
  return models
    .map((model: RegisteredModel) => mapRegisteredModelToDeployment(model))
    .filter((deployment: DeploymentInfo | null): deployment is DeploymentInfo => deployment !== null);
}

const DeploymentWidget: Component<DeploymentWidgetProps> = (props) => {
  const [deploymentsResource] = createResource(() => props.data, loadDeployments);

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

  const deployments = createMemo(() => deploymentsResource() || []);
  const loading = () => deploymentsResource.loading;
  const error = () => deploymentsResource.error ? 'Failed to fetch deployments' : '';
  const totalRunning = () => deployments().filter(d => d.status === 'deployed').length;
  const totalCount = () => deployments().length;

  return (
    <div class="rounded-lg border border-white/10 bg-black/20 overflow-hidden">
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div class="flex items-center gap-2">
          <span class="text-text-muted text-sm">⎈</span>
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
          <div class="h-4 w-4 border-2 border-white/15 border-t-white rounded-full animate-spin" />
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
                        <span class="text-text-dim">{dep.hardware}</span>
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
