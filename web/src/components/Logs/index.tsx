import { Component, createSignal, createEffect, onCleanup, onMount, For, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import LogStream, { type LogEntry, type LogFilter } from './LogStream';
import QueryBuilder from './QueryBuilder';
import LogStats from './LogStats';
import { getLogLevelClass, getLogLevelBadge } from '../../lib/logUtils';
import { showToast, ToastContainer } from '../shared/Toast';

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
  const [selectedLog, setSelectedLog] = createSignal<LogEntry | null>(null);
  const [searchTerm, setSearchTerm] = createSignal('');
  const [searchRegex, setSearchRegex] = createSignal(false);
  const [showSidebar, setShowSidebar] = createSignal(false);
  const [modalClosing, setModalClosing] = createSignal(false);

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

  // Close modal with animation
  const closeModal = () => {
    setModalClosing(true);
    setTimeout(() => {
      setSelectedLog(null);
      setModalClosing(false);
    }, 150);
  };

  // Keyboard shortcuts
  onMount(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedLog()) {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    onCleanup(() => window.removeEventListener('keydown', handleKeydown));
  });

  const logFilter = (): LogFilter => ({
    searchTerm: searchTerm() || undefined,
    searchRegex: searchRegex()
  });

  const handleLogClick = (log: LogEntry) => {
    setSelectedLog(log);
  };

  const copyToClipboard = async (text: string, label: string = 'Content') => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied to clipboard`, 'success');
    } catch {
      showToast('Failed to copy to clipboard', 'error');
    }
  };

  const exportLogs = (format: 'json' | 'csv') => {
    const now = Date.now();
    const start = now - parseTimeRange(timeRange());
    const params = new URLSearchParams({
      query: query(),
      start: (BigInt(start) * 1000000n).toString(),
      end: (BigInt(now) * 1000000n).toString(),
      format,
    });
    window.open(`/api/loki/export?${params}`, '_blank');
  };

  return (
    <div class="flex h-full min-h-0 flex-col gap-4">
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

            {/* Export buttons */}
            <div class="flex items-center gap-1 border-l border-white/10 pl-2 ml-1">
              <button
                onClick={() => exportLogs('json')}
                class="rounded-md bg-white/5 px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text-main"
                title="Export as JSON"
              >
                JSON
              </button>
              <button
                onClick={() => exportLogs('csv')}
                class="rounded-md bg-white/5 px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-text-main"
                title="Export as CSV"
              >
                CSV
              </button>
            </div>

            {/* Query Builder Toggle */}
            <button
              onClick={() => setShowSidebar(!showSidebar())}
              class={`rounded-md px-3 py-2 text-sm font-medium transition-colors border-l border-white/10 ml-1 pl-3 ${
                showSidebar()
                  ? 'bg-neon-purple/20 text-neon-purple'
                  : 'bg-white/5 text-text-muted hover:bg-white/10 hover:text-text-main'
              }`}
              title="Query Builder & Stats"
            >
              <svg class="w-4 h-4 inline-block mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Tools
            </button>
          </div>
        </div>

        <Show when={error()}>
          <div class="mt-3 text-sm text-status-error">{error()}</div>
        </Show>
      </div>

      {/* Log Display with Optional Sidebar */}
      <div class="flex flex-1 gap-4 overflow-hidden">
        {/* Sidebar - Query Builder & Stats */}
        <Show when={showSidebar()}>
          <div class="glass-panel w-72 flex-shrink-0 overflow-y-auto p-4">
            <div class="space-y-6">
              {/* Query Builder Section */}
              <div>
                <h3 class="text-xs font-mono text-text-main uppercase tracking-wider mb-3 flex items-center gap-2">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Query Builder
                </h3>
                <QueryBuilder onQueryChange={setQuery} initialQuery={query()} />
              </div>

              {/* Stats Section */}
              <div class="border-t border-white/10 pt-4">
                <h3 class="text-xs font-mono text-text-main uppercase tracking-wider mb-3 flex items-center gap-2">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Log Statistics
                </h3>
                <LogStats logs={logs} />
              </div>
            </div>
          </div>
        </Show>

        {/* Main Log Panel */}
        <div class="glass-panel flex-1 overflow-hidden flex flex-col">
        <div class="flex h-full flex-col">
          {/* Header with Controls */}
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

            {/* Right side controls */}
            <div class="flex items-center gap-3">
              {/* Search input for visualization modes */}
              <Show when={viewMode() !== 'list'}>
                <div class="flex items-center gap-1 rounded-lg bg-black/40 border border-white/10 px-2">
                  <svg class="w-3 h-3 text-text-dim" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={searchTerm()}
                    onInput={(e) => setSearchTerm(e.currentTarget.value)}
                    placeholder={searchRegex() ? 'Regex...' : 'Search...'}
                    class={`w-28 bg-transparent border-none text-xs text-text-main placeholder-text-dim focus:outline-none py-1 ${searchRegex() ? 'font-mono' : ''}`}
                  />
                  <Show when={searchTerm()}>
                    <button
                      onClick={() => setSearchTerm('')}
                      class="text-text-dim hover:text-text-main text-xs"
                    >
                      ×
                    </button>
                  </Show>
                  <button
                    onClick={() => setSearchRegex(!searchRegex())}
                    title={searchRegex() ? 'Regex mode ON' : 'Enable regex search'}
                    class={`px-1.5 py-0.5 text-[10px] font-mono rounded transition-colors ${
                      searchRegex()
                        ? 'bg-neon-purple/30 text-neon-purple border border-neon-purple/50'
                        : 'text-text-dim hover:text-text-main'
                    }`}
                  >
                    .*
                  </button>
                </div>
              </Show>

              {/* View Mode Toggle */}
              <div class="flex items-center gap-1 rounded-lg bg-black/40 border border-white/10 p-1">
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

              {/* Clear button */}
              <button
                onClick={() => setLogs([])}
                class="text-xs text-text-dim hover:text-text-muted"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Visualization Switcher */}
          <Show when={viewMode() === 'list'} fallback={
              <LogStream
                logs={logs}
                mode={viewMode() === 'rain' ? 'rain' : 'warp'}
                filter={logFilter()}
                onLogClick={handleLogClick}
              />
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
                  <thead class="sticky top-0 bg-surface-dark/95 backdrop-blur border-b border-white/10 z-10">
                    <tr class="text-text-dim text-[10px] uppercase tracking-wider">
                      <th class="text-left px-3 py-2 font-medium w-24">Time</th>
                      <th class="text-left px-3 py-2 font-medium w-32">Source</th>
                      <th class="text-left px-3 py-2 font-medium w-16">Level</th>
                      <th class="text-left px-3 py-2 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={logs}>
                      {(entry) => {
                        const badge = getLogLevelBadge(entry.line);
                        return (
                          <tr
                            class="border-b border-white/5 hover:bg-white/5 group cursor-pointer transition-colors duration-150"
                            onClick={() => handleLogClick(entry)}
                          >
                            <td class="whitespace-nowrap px-3 py-1.5 text-text-dim w-24 align-top">
                              {formatTimestamp(entry.timestamp)}
                            </td>
                            <td class="whitespace-nowrap px-3 py-1.5 text-neon-cyan w-32 align-top opacity-70 group-hover:opacity-100 truncate max-w-[8rem]" title={entry.labels.pod || entry.labels.container || '-'}>
                              {entry.labels.pod || entry.labels.container || '-'}
                            </td>
                            <td class="px-3 py-1.5 w-16 align-top">
                              <Show when={badge}>
                                {(b) => (
                                  <span class={`px-1.5 py-0.5 text-[9px] font-mono rounded border ${b().class}`}>
                                    {b().text}
                                  </span>
                                )}
                              </Show>
                            </td>
                            <td class={`px-3 py-1.5 ${getLogLevelClass(entry.line)} align-top`}>
                              <pre class="whitespace-pre-wrap break-all">{entry.line}</pre>
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>

      {/* Log Detail Modal */}
      <Show when={selectedLog()}>
        {log => {
          const badge = getLogLevelBadge(log().line);
          return (
            <div
              class={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity duration-150 ${
                modalClosing() ? 'opacity-0' : 'animate-fade-in'
              }`}
              onClick={closeModal}
            >
              <div
                class={`w-full max-w-2xl mx-4 bg-surface-dark border border-white/10 rounded-lg shadow-2xl overflow-hidden transition-all duration-150 ${
                  modalClosing() ? 'opacity-0 scale-95' : 'animate-scale-in'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-black/40">
                  <div class="flex items-center gap-2">
                    <div class={`w-2 h-2 rounded-full ${
                      log().line.toLowerCase().includes('error') ? 'bg-red-500' :
                      log().line.toLowerCase().includes('warn') ? 'bg-yellow-500' :
                      'bg-neon-cyan'
                    }`} />
                    <span class="text-sm font-semibold text-text-main">Log Entry</span>
                    <Show when={badge}>
                      {(b) => (
                        <span class={`px-1.5 py-0.5 text-[9px] font-mono rounded border ${b().class}`}>
                          {b().text}
                        </span>
                      )}
                    </Show>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] text-text-dim">Press ESC to close</span>
                    <button
                      onClick={closeModal}
                      class="text-text-dim hover:text-text-main transition-colors p-1"
                    >
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div class="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
                  {/* Timestamp */}
                  <div>
                    <label class="block text-[10px] text-text-dim uppercase mb-1">Timestamp</label>
                    <div class="font-mono text-sm text-text-main">
                      {new Date(log().timestamp).toLocaleString()}
                    </div>
                  </div>

                  {/* Labels */}
                  <Show when={Object.keys(log().labels).length > 0}>
                    <div>
                      <label class="block text-[10px] text-text-dim uppercase mb-2">Labels</label>
                      <div class="flex flex-wrap gap-2">
                        <For each={Object.entries(log().labels)}>
                          {([key, value]) => (
                            <span
                              class="px-2 py-1 rounded bg-white/5 text-xs text-text-muted font-mono cursor-pointer hover:bg-white/10 transition-colors"
                              onClick={() => copyToClipboard(`${key}="${value}"`, 'Label')}
                              title="Click to copy"
                            >
                              <span class="text-neon-cyan">{key}</span>=<span class="text-text-main">{value}</span>
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* Log Line */}
                  <div>
                    <label class="block text-[10px] text-text-dim uppercase mb-2">Message</label>
                    <pre class={`p-3 rounded bg-black/40 font-mono text-sm whitespace-pre-wrap break-all ${getLogLevelClass(log().line)}`}>
                      {log().line}
                    </pre>
                  </div>
                </div>

                {/* Actions */}
                <div class="px-4 py-3 border-t border-white/10 bg-black/20 flex gap-2">
                  <button
                    onClick={() => copyToClipboard(log().line, 'Message')}
                    class="px-4 py-2 text-xs font-mono rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 transition-colors"
                  >
                    Copy Message
                  </button>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(log(), null, 2), 'JSON')}
                    class="px-4 py-2 text-xs font-mono rounded bg-white/5 text-text-muted border border-white/10 hover:bg-white/10 transition-colors"
                  >
                    Copy JSON
                  </button>
                </div>
              </div>
            </div>
          );
        }}
      </Show>

      {/* Toast Container */}
      <ToastContainer />
    </div>
  );
};

export default Logs;
