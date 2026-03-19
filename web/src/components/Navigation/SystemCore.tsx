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
    if (healthRatio() >= 0.8) return 'text-neon-cyan';
    if (healthRatio() >= 0.5) return 'text-yellow-500';
    return 'text-red-500';
  });

  const pulseSpeed = createMemo(() => {
    if (healthStore.loading) return 'animate-ping-slow';
    if (healthStore.error) return 'animate-ping-fast';
    if (healthRatio() >= 0.8) return 'animate-ping-slow';
    return 'animate-ping-normal';
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
    enabled ? 'bg-neon-green' : 'bg-red-500/60';

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

  return (
    <div
      class="relative flex items-center justify-center p-2 group cursor-pointer"
      title={`AI SYSTEM CORE: ${statusLabel()}`}
      onClick={() => fetchHealth()}
    >
      <div class="absolute inset-0 flex items-center justify-center">
        <div
          class={`h-8 w-8 rounded-full border border-current opacity-20 ${coreColor()} ${pulseSpeed()}`}
        />
      </div>
      <div class="absolute inset-0 flex items-center justify-center">
        <div
          class={`h-12 w-12 rounded-full border border-current opacity-10 ${coreColor()} animate-spin-slow`}
        />
      </div>

      {/* Core Graphic */}
      <div
        class={`relative z-10 font-bold tracking-widest ${coreColor()} transition-colors duration-500`}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity="0.8">
            <animate
              attributeName="opacity"
              values="0.8;0.4;0.8"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>
          <path d="M12 2V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <path d="M12 20V22" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <path d="M22 12L20 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <path d="M4 12L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <path d="M19.0718 19.0718L17.6576 17.6576" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <path d="M6.34315 6.34315L4.92893 4.92893" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <path d="M19.0718 4.92893L17.6576 6.34315" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          <path d="M6.34315 17.6576L4.92893 19.0718" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </div>

      {/* Hover Tooltip — real health breakdown */}
      <div class="absolute right-full top-1/2 -translate-y-1/2 mr-4 hidden w-56 group-hover:block animate-fade-in-scale">
        <div class="bg-[#050a14]/90 border border-neon-cyan/30 rounded-lg p-3 shadow-[0_0_20px_rgba(0,217,255,0.1)]">
          <div class="text-[10px] text-neon-cyan/50 tracking-widest mb-1">SYSTEM STATUS</div>
          <div class={`text-xs font-mono mb-2 ${coreColor()}`}>{statusLabel()}</div>

          {/* Feature breakdown */}
          <div class="space-y-1.5 mb-2">
            <For each={features()}>
              {([name, feature]) => (
                <div class="flex items-center gap-2 text-xs">
                  <span class={`w-1.5 h-1.5 rounded-full ${featureStatusDot(feature.enabled)}`} />
                  <span class="text-text-muted flex-1">{featureLabel(name)}</span>
                  <span class={`text-[10px] font-mono ${feature.enabled ? 'text-neon-green' : 'text-red-400'}`}>
                    {feature.enabled ? 'ON' : 'OFF'}
                  </span>
                </div>
              )}
            </For>
          </div>

          {/* Health bar */}
          <div class="h-1 w-full bg-white/10 rounded-full overflow-hidden">
            <div
              class={`h-full rounded-full transition-all duration-500 ${
                healthRatio() >= 0.8 ? 'bg-neon-cyan' :
                healthRatio() >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${healthRatio() * 100}%` }}
            />
          </div>

          <div class="text-[9px] text-text-dim mt-1.5 text-right">
            {enabledCount()}/{totalCount()} subsystems • click to refresh
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemCore;
