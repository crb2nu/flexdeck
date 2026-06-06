import { Component, createSignal, For, Show, createMemo } from 'solid-js';
import { sanitizeError } from '../../lib/sanitizeError';
import { createPolling } from '../../hooks/createPolling';
import { prom } from '../../lib/api';
import { stablePanelStatusClasses, useStablePanelState } from '../shared/useStablePanelState';

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
  const stablePanel = useStablePanelState({
    value: alerts,
    loading,
    error,
    signature: (items) =>
      items.map((alert) => `${alert.labels?.alertname || 'unknown'}:${alert.state}:${alert.activeAt}`).join('|'),
  });
  const displayAlerts = createMemo(() => stablePanel.effectiveValue());

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

  createPolling('dash-alerts', fetchAlerts, POLL_INTERVAL);

  const firingAlerts = createMemo(() =>
    displayAlerts().filter(a => a.state === 'firing')
  );

  const pendingAlerts = createMemo(() =>
    displayAlerts().filter(a => a.state === 'pending')
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
    <div class="surface flex flex-col overflow-hidden" id="alerts-panel">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed())}
        class="flex items-center justify-between px-3 py-2 border-b border-white/5 w-full hover:bg-white/[0.02] transition-colors"
      >
        <div class="flex items-center gap-2">
          <span class={`text-xs ${firingAlerts().length > 0 ? 'text-red-400 animate-pulse' : 'text-text-dim'}`}>
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
          <Show when={stablePanel.status()}>
            {(status) => (
              <span class={`px-1.5 py-0.5 rounded-full text-[9px] font-mono uppercase border ${stablePanelStatusClasses(status())}`}>
                {status()}
              </span>
            )}
          </Show>
          <Show when={allActiveAlerts().length === 0 && !loading()}>
            <span class="px-1.5 py-0.5 rounded-full text-[9px] font-mono bg-status-ok/10 text-status-ok border border-status-ok/20">
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
        <div class="relative flex-1 overflow-y-auto custom-scrollbar" style={{ 'max-height': '220px' }}>
          <div class={`pointer-events-none sticky top-0 z-10 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent transition-opacity duration-200 ${stablePanel.isRefreshing() ? 'opacity-100' : 'opacity-0'}`} />
          <Show
            when={!stablePanel.showBlockingLoading()}
            fallback={
              <div class="flex items-center justify-center py-6">
                <span class="text-xs text-text-dim animate-pulse">Checking alerts...</span>
              </div>
            }
          >
            <Show when={stablePanel.showBlockingError()}>
              <div class="px-3 py-3 flex items-start gap-2 text-status-error">
                <span class="text-base leading-none mt-0.5">⚠</span>
                <div class="min-w-0 flex-1">
                  <div class="text-xs font-semibold uppercase tracking-wide">Alerts unavailable</div>
                  <div
                    class="mt-0.5 text-[11px] text-status-error/80 line-clamp-2"
                    title={sanitizeError(error())}
                  >
                    {summarizeAlertError(error())}
                  </div>
                </div>
              </div>
            </Show>

            <Show when={error() && stablePanel.hasStableValue()}>
              <div class="px-3 py-2 text-[10px] text-status-warn/90 border-b border-status-warn/10 bg-status-warn/5">
                Alert refresh delayed. Showing last good snapshot.
              </div>
            </Show>

            <Show
              when={allActiveAlerts().length > 0}
              fallback={
                <div class="px-3 py-4 text-center">
                  <span class="text-status-ok/60 text-lg">✓</span>
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

/**
 * Compress upstream Prometheus / DNS errors into a short, readable summary.
 * Examples handled:
 *   "Get \"http://kube-prom...\": dial tcp: lookup kube-prom...: no such host"
 *     → "DNS lookup failed for kube-prom..."
 *   "context deadline exceeded" → "upstream timed out"
 * Falls back to the original message when no shape matches.
 */
function summarizeAlertError(raw: string): string {
  if (!raw) return 'Unknown error';
  const lc = raw.toLowerCase();
  if (lc.includes('no such host')) {
    const hostMatch = raw.match(/lookup ([^:\s]+)/);
    return hostMatch ? `DNS lookup failed for ${hostMatch[1]}` : 'DNS lookup failed';
  }
  if (lc.includes('connection refused')) return 'Upstream connection refused';
  if (lc.includes('context deadline exceeded') || lc.includes('timeout')) return 'Upstream timed out';
  if (lc.includes('eof')) return 'Upstream closed connection';
  if (raw.length > 120) return raw.slice(0, 117) + '…';
  return raw;
}

export default AlertsPanel;
