import { Component, createSignal, createEffect, onCleanup, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import LogStream from './LogStream';

interface LogEntry {
  timestamp: string;
  line: string;
  labels: Record<string, string>;
}

interface LokiStream {
  stream: Record<string, string>;
  values: [string, string][];
}

interface LokiQueryResponse {
  status: string;
  data: {
    resultType: string;
    result: LokiStream[];
  };
}

const Logs: Component = () => {
  const [query, setQuery] = createSignal('{namespace="default"}');
  const [logs, setLogs] = createStore<LogEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [streaming, setStreaming] = createSignal(false);
  const [limit, setLimit] = createSignal(100);
  const [timeRange, setTimeRange] = createSignal('1h');
  const [viewMode, setViewMode] = createSignal<'list' | 'flow' | 'rain'>('list');

  let logContainerRef: HTMLDivElement | undefined;
  let eventSource: EventSource | null = null;

  const timeRanges = [
    { label: '15m', value: '15m' },
    { label: '1h', value: '1h' },
    { label: '3h', value: '3h' },
    { label: '6h', value: '6h' },
    { label: '12h', value: '12h' },
    { label: '24h', value: '24h' },
  ];

  const parseTimeRange = (range: string): number => {
    const match = range.match(/^(\d+)([mhd])$/);
    if (!match) return 3600000; // default 1h in ms
    const [, num, unit] = match;
    const multipliers: Record<string, number> = { m: 60000, h: 3600000, d: 86400000 };
    return parseInt(num) * (multipliers[unit] || 3600000);
  };

  const fetchLogs = async () => {
    setLoading(true);
    setError('');

    try {
      const now = Date.now();
      const start = now - parseTimeRange(timeRange());
      const params = new URLSearchParams({
        query: query(),
        limit: limit().toString(),
        start: (BigInt(start) * 1000000n).toString(), // nanoseconds
        end: (BigInt(now) * 1000000n).toString(),
      });

      const response = await fetch(`/api/loki/query_range?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: LokiQueryResponse = await response.json();

      const entries: LogEntry[] = [];
      if (data.data && data.data.result) {
          for (const stream of data.data.result) {
            for (const [ts, line] of stream.values) {
              entries.push({
                timestamp: new Date(Number(BigInt(ts) / 1000000n)).toISOString(),
                line,
                labels: stream.stream,
              });
            }
          }
      }

      // Sort by timestamp descending (newest first)
      entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      setLogs(entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  };

  const startStreaming = () => {
    if (eventSource) {
      eventSource.close();
    }

    setStreaming(true);
    const params = new URLSearchParams({ query: query() });
    eventSource = new EventSource(`/api/loki/tail-sse?${params}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.streams) {
          for (const stream of data.streams) {
            for (const [ts, line] of stream.values) {
              const entry: LogEntry = {
                timestamp: new Date(Number(BigInt(ts) / 1000000n)).toISOString(),
                line,
                labels: stream.stream,
              };
              setLogs((prev) => [entry, ...prev.slice(0, 999)]);
            }
          }
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      setStreaming(false);
      eventSource?.close();
      eventSource = null;
    };
  };

  const stopStreaming = () => {
    setStreaming(false);
    eventSource?.close();
    eventSource = null;
  };

  onCleanup(() => {
    eventSource?.close();
  });

  // Auto-scroll to bottom when new logs arrive
  createEffect(() => {
    if (logs.length > 0 && logContainerRef && viewMode() === 'list') {
      // Only auto-scroll if already near bottom
      const { scrollTop, scrollHeight, clientHeight } = logContainerRef;
      if (scrollHeight - scrollTop - clientHeight < 100) {
        logContainerRef.scrollTop = scrollHeight;
      }
    }
  });

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const getLogLevelClass = (line: string): string => {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) {
      return 'text-status-error';
    }
    if (lower.includes('warn')) {
      return 'text-status-warn';
    }
    if (lower.includes('debug') || lower.includes('trace')) {
      return 'text-text-dim';
    }
    return 'text-text-muted';
  };

  return (
    <div class="flex h-full flex-col gap-4">
      {/* Query Bar */}
      <div class="glass-panel p-4">
        <div class="flex flex-wrap items-center gap-4">
          <div class="flex-1 min-w-[300px]">
            <input
              type="text"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder='{namespace="default"}'
              class="w-full rounded-md border border-white/10 bg-black/50 px-4 py-2 text-sm text-white placeholder-white/30 focus:border-neon-cyan focus:outline-none focus:ring-1 focus:ring-neon-cyan/50 transition-all font-mono"
            />
          </div>

          <div class="flex items-center gap-2">
            <select
              value={timeRange()}
              onChange={(e) => setTimeRange(e.currentTarget.value)}
              class="rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-text-main focus:border-neon-cyan focus:outline-none"
            >
              <For each={timeRanges}>{(range) => <option value={range.value}>{range.label}</option>}</For>
            </select>

            <select
              value={limit()}
              onChange={(e) => setLimit(parseInt(e.currentTarget.value))}
              class="rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-text-main focus:border-neon-cyan focus:outline-none"
            >
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
          </div>

          <div class="flex items-center gap-2">
            <button
              onClick={fetchLogs}
              disabled={loading()}
              class="rounded-md bg-neon-cyan/20 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/30 disabled:opacity-50"
            >
              {loading() ? 'Loading...' : 'Query'}
            </button>

            <Show
              when={!streaming()}
              fallback={
                <button
                  onClick={stopStreaming}
                  class="rounded-md bg-status-error/20 px-4 py-2 text-sm font-medium text-status-error transition-colors hover:bg-status-error/30"
                >
                  Stop
                </button>
              }
            >
              <button
                onClick={startStreaming}
                class="rounded-md bg-neon-purple/20 px-4 py-2 text-sm font-medium text-neon-purple transition-colors hover:bg-neon-purple/30"
              >
                Stream
              </button>
            </Show>
          </div>
        </div>

        <Show when={error()}>
          <div class="mt-3 text-sm text-status-error">{error()}</div>
        </Show>
      </div>

      {/* Log Display */}
      <div class="glass-panel flex-1 overflow-hidden relative flex flex-col">
         {/* Controls */}
         <div class="absolute right-4 top-2 z-10 flex gap-2">
            <div class="flex items-center gap-1 rounded-lg bg-black/40 border border-white/10 p-1 backdrop-blur">
               <button 
                onClick={() => setViewMode('list')}
                class={`px-3 py-1 text-xs font-mono rounded transition-colors ${viewMode() === 'list' ? 'bg-white/20 text-white' : 'text-text-dim hover:text-text-main'}`}
               >
                   TERMINAL
               </button>
               <button 
                onClick={() => setViewMode('flow')}
                class={`px-3 py-1 text-xs font-mono rounded transition-colors ${viewMode() === 'flow' ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-text-dim hover:text-text-main'}`}
               >
                   FLOW
               </button>
               <button 
                onClick={() => setViewMode('rain')}
                class={`px-3 py-1 text-xs font-mono rounded transition-colors ${viewMode() === 'rain' ? 'bg-neon-green/20 text-green-400' : 'text-text-dim hover:text-text-main'}`}
               >
                   MATRIX
               </button>
           </div>
        </div>

        <div class="flex h-full flex-col">
          {/* Header */}
          <div class="flex items-center justify-between border-b border-white/5 px-4 py-2">
            <div class="flex items-center gap-3">
              <span class="text-sm font-medium text-text-main">Logs</span>
              <span class="text-xs text-text-dim">{logs.length} entries</span>
              <Show when={streaming()}>
                <span class="flex items-center gap-1 text-xs text-neon-purple">
                  <span class="h-2 w-2 animate-pulse rounded-full bg-neon-purple" />
                  Streaming
                </span>
              </Show>
            </div>
            <button
              onClick={() => setLogs([])}
              class="text-xs text-text-dim hover:text-text-muted mr-48" // Margin for controls
            >
              Clear
            </button>
          </div>

          {/* Visualization Switcher */}
          <Show when={viewMode() === 'list'} fallback={
              <LogStream logs={logs} mode={viewMode() === 'rain' ? 'rain' : 'warp'} />
          }>
            <div
              ref={logContainerRef}
              class="flex-1 overflow-auto font-mono text-xs"
            >
              <Show
                when={logs.length > 0}
                fallback={
                  <div class="flex h-full items-center justify-center text-text-dim">
                    {loading() ? 'Loading logs...' : 'No logs to display. Run a query to fetch logs.'}
                  </div>
                }
              >
                <table class="w-full">
                  <tbody>
                    <For each={logs}>
                      {(entry) => (
                        <tr class="border-b border-white/5 hover:bg-white/5 group">
                          <td class="whitespace-nowrap px-3 py-1 text-text-dim w-24 align-top">
                            {formatTimestamp(entry.timestamp)}
                          </td>
                          <td class="whitespace-nowrap px-3 py-1 text-neon-cyan w-32 align-top opacity-70 group-hover:opacity-100">
                            {entry.labels.pod || entry.labels.container || '-'}
                          </td>
                          <td class={`px-3 py-1 ${getLogLevelClass(entry.line)} align-top`}>
                            <pre class="whitespace-pre-wrap break-all">{entry.line}</pre>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default Logs;
