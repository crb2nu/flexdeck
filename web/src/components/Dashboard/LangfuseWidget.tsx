import { Component, createSignal, onMount, onCleanup, For, Show, createMemo } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { langfuse } from '../../lib/api';

interface LangfuseModelStats {
  model: string;
  totalCalls: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  errors: number;
}

interface LangfuseTrace {
  id: string;
  name: string;
  userId?: string;
  timestamp: string;
  latency?: number;
  totalCost?: number;
  input?: unknown;
  output?: unknown;
  tags?: string[];
  observations?: Array<{
    model?: string;
    usage?: { input: number; output: number; total: number };
  }>;
}

interface DailyMetric {
  date: string;
  countTraces: number;
  totalCost: number;
  usage: {
    inputUsage: number;
    outputUsage: number;
    totalUsage: number;
  };
}

const POLL_INTERVAL = 60_000; // 1 minute

const LangfuseWidget: Component = () => {
  const [healthy, setHealthy] = createSignal<boolean | null>(null);
  const [modelStats, setModelStats] = createSignal<LangfuseModelStats[]>([]);
  const [traces, setTraces] = createSignal<LangfuseTrace[]>([]);
  const [dailyMetrics, setDailyMetrics] = createSignal<DailyMetric[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [activeTab, setActiveTab] = createSignal<'models' | 'traces' | 'overview'>('overview');

  const fetchAll = async () => {
    try {
      // Health check
      const health = await langfuse.health();
      setHealthy(health?.healthy ?? false);

      if (!health?.healthy) {
        setError('Langfuse unreachable');
        setLoading(false);
        return;
      }

      // Fetch in parallel
      const [modelsRes, tracesRes, metricsRes] = await Promise.allSettled([
        langfuse.models(),
        langfuse.traces({ limit: 20 }),
        langfuse.metrics(),
      ]);

      if (modelsRes.status === 'fulfilled') {
        setModelStats(modelsRes.value?.models || []);
      }
      if (tracesRes.status === 'fulfilled') {
        setTraces(tracesRes.value?.data || []);
      }
      if (metricsRes.status === 'fulfilled') {
        setDailyMetrics(metricsRes.value?.data || []);
      }

      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Langfuse data');
    } finally {
      setLoading(false);
    }
  };

  createPolling('dash-langfuse', fetchAll, POLL_INTERVAL);

  // Computed
  const totalCost = createMemo(() =>
    modelStats().reduce((sum, m) => sum + m.totalCost, 0)
  );

  const totalTokens = createMemo(() =>
    modelStats().reduce((sum, m) => sum + m.totalTokens, 0)
  );

  const totalCalls = createMemo(() =>
    modelStats().reduce((sum, m) => sum + m.totalCalls, 0)
  );

  const totalErrors = createMemo(() =>
    modelStats().reduce((sum, m) => sum + m.errors, 0)
  );

  const sortedModels = createMemo(() =>
    [...modelStats()].sort((a, b) => b.totalCalls - a.totalCalls)
  );

  const formatCost = (cost: number) => {
    if (cost === 0) return '$0.00';
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatTokens = (tokens: number) => {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
    return String(tokens);
  };

  const timeAgo = (ts?: string) => {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60_000) return `${Math.floor(diff / 1000)}s`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
    return `${Math.floor(diff / 86_400_000)}d`;
  };

  // Mini sparkline for daily metrics (last 7 days)
  const Sparkline: Component<{ data: number[]; color: string }> = (props) => {
    const path = createMemo(() => {
      const d = props.data;
      if (d.length < 2) return '';
      const max = Math.max(...d, 1);
      const w = 80;
      const h = 20;
      const points = d.map((v, i) => {
        const x = (i / (d.length - 1)) * w;
        const y = h - (v / max) * h;
        return `${x},${y}`;
      });
      return `M${points.join(' L')}`;
    });

    return (
      <svg width="80" height="20" viewBox="0 0 80 20" class="opacity-60">
        <path d={path()} fill="none" stroke={props.color} stroke-width="1.5" />
      </svg>
    );
  };

  return (
    <div class="glass-panel flex flex-col overflow-hidden" id="langfuse-widget">
      {/* Header */}
      <div class="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <div class="flex items-center gap-2">
          <span class="text-xs text-neon-purple">◈</span>
          <span class="text-xs font-mono text-text-main uppercase tracking-wider">Langfuse</span>
          <Show when={healthy() !== null}>
            <span class={`w-1.5 h-1.5 rounded-full ${healthy() ? 'bg-neon-green' : 'bg-red-500'}`} />
          </Show>
        </div>
        <div class="flex gap-0.5 bg-black/30 rounded p-0.5">
          <For each={['overview', 'models', 'traces'] as const}>
            {(tab) => (
              <button
                onClick={() => setActiveTab(tab)}
                class={`px-2 py-0.5 text-[9px] font-mono rounded transition-colors ${
                  activeTab() === tab
                    ? 'bg-neon-purple/20 text-neon-purple'
                    : 'text-text-dim hover:text-text-main'
                }`}
              >
                {tab.toUpperCase()}
              </button>
            )}
          </For>
        </div>
      </div>

      {/* Body */}
      <div class="flex-1 overflow-y-auto" style={{ 'max-height': '280px' }}>
        <Show
          when={!loading()}
          fallback={
            <div class="flex items-center justify-center py-6">
              <span class="text-xs text-text-dim animate-pulse">Loading Langfuse data...</span>
            </div>
          }
        >
          <Show when={error()}>
            <div class="px-3 py-2 text-xs text-red-400 flex items-center gap-2">
              <span>⚠</span>
              <span>{error()}</span>
            </div>
          </Show>

          {/* Overview Tab */}
          <Show when={activeTab() === 'overview'}>
            <div class="p-3 space-y-3">
              {/* Summary Cards */}
              <div class="grid grid-cols-2 gap-2">
                <div class="bg-black/30 rounded-lg p-2 border border-white/5">
                  <div class="text-[9px] text-text-dim uppercase mb-1">Total Cost</div>
                  <div class="text-sm font-mono text-neon-purple font-semibold">{formatCost(totalCost())}</div>
                </div>
                <div class="bg-black/30 rounded-lg p-2 border border-white/5">
                  <div class="text-[9px] text-text-dim uppercase mb-1">Tokens</div>
                  <div class="text-sm font-mono text-neon-cyan font-semibold">{formatTokens(totalTokens())}</div>
                </div>
                <div class="bg-black/30 rounded-lg p-2 border border-white/5">
                  <div class="text-[9px] text-text-dim uppercase mb-1">API Calls</div>
                  <div class="text-sm font-mono text-text-main font-semibold">{totalCalls()}</div>
                </div>
                <div class="bg-black/30 rounded-lg p-2 border border-white/5">
                  <div class="text-[9px] text-text-dim uppercase mb-1">Errors</div>
                  <div class={`text-sm font-mono font-semibold ${totalErrors() > 0 ? 'text-red-400' : 'text-neon-green'}`}>
                    {totalErrors()}
                  </div>
                </div>
              </div>

              {/* Daily Trend */}
              <Show when={dailyMetrics().length > 1}>
                <div class="bg-black/30 rounded-lg p-2 border border-white/5">
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-[9px] text-text-dim uppercase">7-Day Trend</span>
                    <span class="text-[9px] text-text-dim">{dailyMetrics().length} days</span>
                  </div>
                  <div class="flex items-center gap-3">
                    <div>
                      <div class="text-[9px] text-text-dim mb-0.5">Traces</div>
                      <Sparkline
                        data={dailyMetrics().slice(-7).map(d => d.countTraces)}
                        color="var(--neon-cyan, #22d3ee)"
                      />
                    </div>
                    <div>
                      <div class="text-[9px] text-text-dim mb-0.5">Cost</div>
                      <Sparkline
                        data={dailyMetrics().slice(-7).map(d => d.totalCost)}
                        color="var(--neon-purple, #a855f7)"
                      />
                    </div>
                  </div>
                </div>
              </Show>

              {/* Top Models Preview */}
              <Show when={sortedModels().length > 0}>
                <div>
                  <div class="text-[9px] text-text-dim uppercase mb-1.5">Top Models</div>
                  <div class="space-y-1">
                    <For each={sortedModels().slice(0, 3)}>
                      {(model) => {
                        const pct = totalCalls() > 0 ? (model.totalCalls / totalCalls()) * 100 : 0;
                        return (
                          <div class="flex items-center gap-2">
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center justify-between mb-0.5">
                                <span class="text-[10px] font-mono text-text-main truncate">{model.model}</span>
                                <span class="text-[9px] text-text-dim ml-1">{model.totalCalls}</span>
                              </div>
                              <div class="h-1 bg-white/5 rounded-full overflow-hidden">
                                <div
                                  class="h-full rounded-full"
                                  style={{
                                    width: `${Math.min(pct, 100)}%`,
                                    background: 'linear-gradient(90deg, var(--neon-purple, #a855f7), var(--neon-cyan, #22d3ee))',
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </Show>

          {/* Models Tab */}
          <Show when={activeTab() === 'models'}>
            <Show
              when={sortedModels().length > 0}
              fallback={
                <div class="px-3 py-4 text-center text-xs text-text-dim">No model data yet</div>
              }
            >
              <div class="divide-y divide-white/5">
                <For each={sortedModels()}>
                  {(model) => (
                    <div class="px-3 py-2 hover:bg-white/[0.02] transition-colors">
                      <div class="flex items-center justify-between mb-1">
                        <span class="text-[11px] font-mono text-text-main truncate flex-1">{model.model}</span>
                        <span class="text-[10px] font-mono text-neon-purple ml-2">{formatCost(model.totalCost)}</span>
                      </div>
                      <div class="flex items-center gap-3 text-[9px] text-text-dim">
                        <span>{model.totalCalls} calls</span>
                        <span>↑{formatTokens(model.inputTokens)}</span>
                        <span>↓{formatTokens(model.outputTokens)}</span>
                        <Show when={model.errors > 0}>
                          <span class="text-red-400">{model.errors} err</span>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>

          {/* Traces Tab */}
          <Show when={activeTab() === 'traces'}>
            <Show
              when={traces().length > 0}
              fallback={
                <div class="px-3 py-4 text-center text-xs text-text-dim">No recent traces</div>
              }
            >
              <div class="divide-y divide-white/5">
                <For each={traces().slice(0, 15)}>
                  {(trace) => (
                    <div class="px-3 py-2 hover:bg-white/[0.02] transition-colors group">
                      <div class="flex items-start gap-2">
                        <span class="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-neon-purple/60" />
                        <div class="flex-1 min-w-0">
                          <div class="flex items-center gap-1.5 mb-0.5">
                            <span class="text-[10px] font-mono text-text-main truncate">
                              {trace.name || trace.id?.slice(0, 8)}
                            </span>
                            <Show when={trace.totalCost}>
                              <span class="text-[9px] text-neon-purple">{formatCost(trace.totalCost!)}</span>
                            </Show>
                          </div>
                          <div class="flex items-center gap-2 text-[9px] text-text-dim">
                            <Show when={trace.userId}>
                              <span class="font-mono">@{trace.userId}</span>
                            </Show>
                            <Show when={trace.latency}>
                              <span>{(trace.latency! / 1000).toFixed(1)}s</span>
                            </Show>
                            <Show when={trace.tags && trace.tags.length > 0}>
                              <For each={trace.tags!.slice(0, 2)}>
                                {(tag) => (
                                  <span class="px-1 py-0.5 rounded bg-white/5 text-[8px]">{tag}</span>
                                )}
                              </For>
                            </Show>
                          </div>
                        </div>
                        <span class="text-[9px] text-text-dim ml-1 flex-shrink-0 whitespace-nowrap">
                          {timeAgo(trace.timestamp)}
                        </span>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default LangfuseWidget;
