import { Component, createSignal, For, Show } from 'solid-js';
import { loki } from '../../../lib/api';
import { createPolling } from '../../../hooks/createPolling';

interface LogWidgetProps {
  data: {
    query: string;        // LogQL query or simple label matcher
    title?: string;       // Display title
    limit?: number;       // Max lines to show (default 20)
    namespace?: string;   // K8s namespace filter
    container?: string;   // Container name filter
  };
}

interface LogLine {
  timestamp: string;
  message: string;
  level?: string;
}

const LogWidget: Component<LogWidgetProps> = (props) => {
  const [logs, setLogs] = createSignal<LogLine[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [paused, setPaused] = createSignal(false);

  const limit = () => props.data.limit || 20;

  // Build a LogQL query from props
  const buildQuery = (): string => {
    if (props.data.query.startsWith('{')) return props.data.query;
    // Construct from parts
    const parts: string[] = [];
    if (props.data.namespace) parts.push(`namespace="${props.data.namespace}"`);
    if (props.data.container) parts.push(`container="${props.data.container}"`);
    if (parts.length === 0 && props.data.query) {
      // Treat as a simple app label
      parts.push(`app="${props.data.query}"`);
    }
    return `{${parts.join(', ')}}`;
  };

  const fetchLogs = async () => {
    if (paused()) return;
    try {
      const result = await loki.query(buildQuery(), limit());
      
      const lines: LogLine[] = [];
      if (result?.data?.result) {
        for (const stream of result.data.result) {
          for (const [ts, msg] of stream.values || []) {
            const level = msg.toLowerCase().includes('error') ? 'error' 
              : msg.toLowerCase().includes('warn') ? 'warn' : 'info';
            lines.push({
              timestamp: new Date(parseInt(ts) / 1_000_000).toLocaleTimeString(),
              message: msg,
              level,
            });
          }
        }
      }
      // Sort newest first, take limit
      lines.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setLogs(lines.slice(0, limit()));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  };

  createPolling('log-widget', fetchLogs, 5000);

  const levelColor = (level?: string) => {
    switch (level) {
      case 'error': return 'text-red-400';
      case 'warn': return 'text-yellow-400';
      default: return 'text-text-dim';
    }
  };

  return (
    <div class="rounded-lg border border-white/10 bg-black/30 overflow-hidden">
      {/* Header */}
      <div class="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-black/20">
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-neon-green">▶</span>
          <span class="text-xs font-mono text-text-main uppercase tracking-wider">
            {props.data.title || 'Log Stream'}
          </span>
        </div>
        <div class="flex items-center gap-2">
          <button
            onClick={() => setPaused(!paused())}
            class={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
              paused()
                ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10'
                : 'border-white/10 text-text-dim hover:text-neon-green'
            }`}
          >
            {paused() ? '⏸ PAUSED' : '⏵ LIVE'}
          </button>
          <span class="text-[9px] text-text-dim">{logs().length} lines</span>
        </div>
      </div>

      {/* Log lines */}
      <div class="max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed">
        <Show
          when={!loading()}
          fallback={
            <div class="px-3 py-4 text-center text-xs text-text-dim animate-pulse">
              Connecting to log stream...
            </div>
          }
        >
          <Show when={error()}>
            <div class="px-3 py-2 text-xs text-red-400">{error()}</div>
          </Show>

          <Show
            when={logs().length > 0}
            fallback={
              <div class="px-3 py-4 text-center text-xs text-text-dim">No logs found</div>
            }
          >
            <For each={logs()}>
              {(line) => (
                <div class="flex gap-2 px-3 py-0.5 hover:bg-white/[0.02] group">
                  <span class="text-text-dim/50 flex-shrink-0">{line.timestamp}</span>
                  <span class={`flex-1 break-all ${levelColor(line.level)}`}>
                    {line.message.length > 200 
                      ? line.message.substring(0, 200) + '…' 
                      : line.message}
                  </span>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default LogWidget;
