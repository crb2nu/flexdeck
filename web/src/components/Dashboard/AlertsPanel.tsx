import { Component, createSignal, onMount, onCleanup, For, Show, createMemo } from 'solid-js';
import { prom } from '../../lib/api';

interface PrometheusAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  state: 'firing' | 'pending' | 'inactive';
  activeAt: string;
  value: string;
}

const POLL_INTERVAL = 30_000;

const AlertsPanel: Component = () => {
  const [alerts, setAlerts] = createSignal<PrometheusAlert[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [collapsed, setCollapsed] = createSignal(false);

  const fetchAlerts = async () => {
    try {
      const data = await prom.alerts();
      // Prometheus API returns { status: "success", data: { alerts: [...] } }
      const alertList = data?.data?.alerts || data?.alerts || [];
      setAlerts(alertList);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  };

  let pollTimer: ReturnType<typeof setInterval>;
  onMount(() => {
    fetchAlerts();
    pollTimer = setInterval(fetchAlerts, POLL_INTERVAL);
  });
  onCleanup(() => clearInterval(pollTimer));

  const firingAlerts = createMemo(() =>
    alerts().filter(a => a.state === 'firing')
  );

  const pendingAlerts = createMemo(() =>
    alerts().filter(a => a.state === 'pending')
  );

  const severityColor = (severity?: string) => {
    switch (severity) {
      case 'critical': return { bg: 'bg-red-500/20', text: 'text-red-400', dot: 'bg-red-500', border: 'border-red-500/30' };
      case 'warning': return { bg: 'bg-yellow-500/20', text: 'text-yellow-400', dot: 'bg-yellow-500', border: 'border-yellow-500/30' };
      case 'info': return { bg: 'bg-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-500', border: 'border-blue-500/30' };
      default: return { bg: 'bg-orange-500/20', text: 'text-orange-400', dot: 'bg-orange-500', border: 'border-orange-500/30' };
    }
  };

  const timeAgo = (ts?: string) => {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
    return `${Math.floor(diff / 86_400_000)}d`;
  };

  const allActiveAlerts = createMemo(() => [
    ...firingAlerts(),
    ...pendingAlerts(),
  ]);

  return (
    <div class="glass-panel flex flex-col overflow-hidden" id="alerts-panel">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed())}
        class="flex items-center justify-between px-3 py-2 border-b border-white/5 w-full hover:bg-white/[0.02] transition-colors"
      >
        <div class="flex items-center gap-2">
          <span class={`text-xs ${firingAlerts().length > 0 ? 'text-red-400 animate-pulse' : 'text-neon-cyan'}`}>
            {firingAlerts().length > 0 ? '⚠' : '◉'}
          </span>
          <span class="text-xs font-mono text-text-main uppercase tracking-wider">Alerts</span>
          <Show when={firingAlerts().length > 0}>
            <span class="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-red-500/20 text-red-400 border border-red-500/30">
              {firingAlerts().length} firing
            </span>
          </Show>
          <Show when={pendingAlerts().length > 0}>
            <span class="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
              {pendingAlerts().length} pending
            </span>
          </Show>
          <Show when={allActiveAlerts().length === 0 && !loading()}>
            <span class="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-neon-green/10 text-neon-green border border-neon-green/20">
              all clear
            </span>
          </Show>
        </div>
        <svg
          class={`w-3 h-3 text-text-dim transition-transform ${collapsed() ? '-rotate-90' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      <Show when={!collapsed()}>
        <div class="flex-1 overflow-y-auto" style={{ 'max-height': '220px' }}>
          <Show
            when={!loading()}
            fallback={
              <div class="flex items-center justify-center py-6">
                <span class="text-xs text-text-dim animate-pulse">Checking alerts...</span>
              </div>
            }
          >
            <Show when={error()}>
              <div class="px-3 py-2 text-xs text-red-400">{error()}</div>
            </Show>

            <Show
              when={allActiveAlerts().length > 0}
              fallback={
                <div class="px-3 py-4 text-center">
                  <span class="text-neon-green/60 text-lg">✓</span>
                  <p class="text-xs text-text-dim mt-1">No active alerts</p>
                </div>
              }
            >
              <div class="divide-y divide-white/5">
                <For each={allActiveAlerts()}>
                  {(alert) => {
                    const severity = alert.labels?.severity || 'warning';
                    const colors = severityColor(severity);
                    return (
                      <div class="px-3 py-2 hover:bg-white/[0.02] transition-colors group">
                        <div class="flex items-start gap-2">
                          <span class={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${colors.dot} ${alert.state === 'firing' ? 'animate-pulse' : ''}`} />
                          <div class="flex-1 min-w-0">
                            <div class="flex items-center gap-1.5 mb-0.5">
                              <span class={`text-[10px] font-mono font-semibold ${colors.text}`}>
                                {alert.labels?.alertname || 'Unknown'}
                              </span>
                              <span class={`px-1 py-0.5 rounded text-[8px] font-mono uppercase ${colors.bg} ${colors.text} ${colors.border} border`}>
                                {alert.state}
                              </span>
                            </div>
                            <p class="text-[10px] text-text-muted truncate group-hover:whitespace-normal group-hover:break-words">
                              {alert.annotations?.summary || alert.annotations?.description || alert.labels?.alertname}
                            </p>
                            <div class="flex items-center gap-2 mt-1">
                              <Show when={alert.labels?.namespace}>
                                <span class="text-[9px] text-text-dim font-mono">
                                  ns:{alert.labels.namespace}
                                </span>
                              </Show>
                              <Show when={alert.labels?.pod}>
                                <span class="text-[9px] text-text-dim font-mono">
                                  pod:{alert.labels.pod}
                                </span>
                              </Show>
                              <Show when={alert.labels?.severity}>
                                <span class={`text-[9px] font-mono ${colors.text}`}>
                                  {severity}
                                </span>
                              </Show>
                            </div>
                          </div>
                          <span class="text-[9px] text-text-dim ml-1 flex-shrink-0 whitespace-nowrap">
                            {timeAgo(alert.activeAt)}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default AlertsPanel;
