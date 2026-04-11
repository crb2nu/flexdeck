import { Component, createMemo, For } from 'solid-js';
import { healthStore, fetchHealth } from '../../stores/health';

/**
 * SystemCore — header status icon that reflects real /api/health data.
 * Replaces the previous Math.random() mock with live feature-flag awareness.
 */
const SystemCore: Component = () => {
  // Derive aggregate health from the features map
  const features = createMemo(() => Object.entries(healthStore.features || {}));

  const enabledCount = createMemo(() =>
    features().filter(([, f]) => f.enabled).length
  );

  const totalCount = createMemo(() => features().length);

  const healthRatio = createMemo(() =>
    totalCount() > 0 ? enabledCount() / totalCount() : 0
  );

  // Map health ratio to visual state
  const coreColor = createMemo(() => {
    if (healthStore.loading) return 'text-text-dim';
    if (healthStore.error) return 'text-red-500';
    if (healthRatio() >= 0.8) return 'text-white';
    if (healthRatio() >= 0.5) return 'text-yellow-500';
    return 'text-red-500';
  });

  const pulseSpeed = createMemo(() => {
    if (healthStore.loading) return 'animate-pulse';
    if (healthStore.error) return 'animate-pulse';
    if (healthRatio() >= 0.8) return 'animate-pulse';
    return 'animate-pulse';
  });

  const statusLabel = createMemo(() => {
    if (healthStore.loading) return 'INITIALIZING...';
    if (healthStore.error) return 'OFFLINE';
    if (healthRatio() >= 1) return 'ALL SYSTEMS NOMINAL';
    if (healthRatio() >= 0.8) return 'MOSTLY NOMINAL';
    if (healthRatio() >= 0.5) return 'DEGRADED';
    return 'CRITICAL';
  });

  const featureStatusDot = (enabled: boolean) =>
    enabled ? 'bg-status-ok' : 'bg-red-500/60';

  const featureLabel = (name: string) => {
    const labels: Record<string, string> = {
      k8s: 'Kubernetes',
      prometheus: 'Prometheus',
      loki: 'Loki Logs',
      vllm: 'vLLM',
      cache: 'Model Cache',
      litellm: 'LiteLLM',
      redis: 'Redis',
    };
    return labels[name] || name;
  };

  const dotColor = createMemo(() => {
    if (healthStore.loading) return 'bg-white/30';
    if (healthStore.error) return 'bg-red-500';
    if (healthRatio() >= 0.8) return 'bg-status-ok';
    if (healthRatio() >= 0.5) return 'bg-yellow-500';
    return 'bg-red-500';
  });

  return (
    <div
      class="relative flex items-center justify-center p-1.5 group cursor-pointer"
      title={statusLabel()}
      onClick={() => fetchHealth()}
    >
      <span
        class={`w-2 h-2 rounded-full ${dotColor()} ${healthStore.loading ? 'animate-pulse' : ''}`}
      />

      {/* Hover Tooltip */}
      <div class="absolute right-full top-1/2 -translate-y-1/2 mr-3 hidden w-52 group-hover:block animate-scale-in z-50">
        <div class="surface p-3">
          <div class="heading-label mb-1">System status</div>
          <div class={`text-xs mb-2 ${coreColor()}`}>{statusLabel()}</div>

          <div class="space-y-1.5 mb-2">
            <For each={features()}>
              {([name, feature]) => (
                <div class="flex items-center gap-2 text-xs">
                  <span class={`w-1.5 h-1.5 rounded-full ${featureStatusDot(feature.enabled)}`} />
                  <span class="text-text-muted flex-1">{featureLabel(name)}</span>
                  <span class={`text-[10px] font-mono ${feature.enabled ? 'text-status-ok' : 'text-red-400'}`}>
                    {feature.enabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              )}
            </For>
          </div>

          <div class="h-1 w-full bg-white/10 rounded-full overflow-hidden">
            <div
              class={`h-full rounded-full transition-all duration-500 ${
                healthRatio() >= 0.8 ? 'bg-white/40' :
                healthRatio() >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${healthRatio() * 100}%` }}
            />
          </div>

          <div class="text-[10px] text-text-dim mt-1.5 text-right">
            {enabledCount()}/{totalCount()} subsystems
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemCore;
