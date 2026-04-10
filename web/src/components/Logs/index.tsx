import { Component, createEffect, createMemo, For, Show } from 'solid-js';
import LogStream from './LogStream';
import QueryBuilder from './QueryBuilder';
import LogStats from './LogStats';
import {
  analyzeLogLines,
  getFiAccelMetricsSnapshot,
  type FiAccelLogAnalysisMatch,
} from '../../lib/fiAccel';
import {
  getLogLevelBadge,
  getLogLevelBadgeForLevel,
  getLogLevelClass,
  getLogLevelClassForLevel,
} from '../../lib/logUtils';
import { ToastContainer } from '../shared/Toast';
import { TabBar, ErrorState } from '../shared';
import { LOG_TIME_RANGES, useLogsController } from './useLogsController';

const Logs: Component = () => {
  const {
    query,
    setQuery,
    logs,
    loading,
    error,
    streaming,
    limit,
    setLimit,
    timeRange,
    setTimeRange,
    viewMode,
    setViewMode,
    selectedLog,
    searchTerm,
    setSearchTerm,
    searchRegex,
    setSearchRegex,
    showSidebar,
    setShowSidebar,
    modalClosing,
    fetchLogs,
    startStreaming,
    stopStreaming,
    closeModal,
    logFilter,
    handleLogClick,
    clearLogs,
    copyToClipboard,
    exportLogs,
  } = useLogsController();

  let logContainerRef: HTMLDivElement | undefined;

  const logAnalysis = createMemo<FiAccelLogAnalysisMatch[]>(() =>
    analyzeLogLines(logs.map((entry) => entry.line))
  );

  const fiAccelSnapshot = createMemo(() => {
    logAnalysis();
    return getFiAccelMetricsSnapshot();
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

  return (
    <div class="flex h-full min-h-0 flex-col gap-4">
      {/* Query Bar */}
      <div class="glass-panel p-4">
        <div class="flex flex-wrap items-center gap-4">
          <div class="flex-1 min-w-0 sm:min-w-[260px]">
            <input
              type="text"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder='{namespace="default"}'
              class="w-full rounded-md border border-white/10 bg-black/50 px-4 py-2 text-sm text-white placeholder-white/30 focus:border-white/20 focus:outline-none focus:ring-1 focus:ring-white/15 transition-all font-mono"
            />
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <select
              value={timeRange()}
              onChange={(e) => setTimeRange(e.currentTarget.value)}
              class="rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-text-main focus:border-white/20 focus:outline-none"
            >
              <For each={LOG_TIME_RANGES}>{(range) => <option value={range.value}>{range.label}</option>}</For>
            </select>

            <select
              value={limit()}
              onChange={(e) => setLimit(parseInt(e.currentTarget.value))}
              class="rounded-md border border-white/10 bg-black/50 px-3 py-2 text-sm text-text-main focus:border-white/20 focus:outline-none"
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
              class="rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-50"
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
                class="rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-white/20"
              >
                Stream
              </button>
            </Show>

            {/* Export buttons */}
            <div class="flex items-center gap-1 sm:ml-1 sm:border-l border-white/10 sm:pl-2">
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
                class={`rounded-md px-3 py-2 text-sm font-medium transition-colors sm:border-l border-white/10 sm:ml-1 sm:pl-3 ${
                  showSidebar()
                    ? 'bg-white/10 text-white'
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
          <div class="mt-3">
            <ErrorState message={error()!} variant="inline" />
          </div>
        </Show>
      </div>

      {/* Log Display with Optional Sidebar */}
      <div class="flex flex-1 gap-4 overflow-hidden">
        {/* Sidebar - Query Builder & Stats */}
        <Show when={showSidebar()}>
          <div class="hidden lg:block glass-panel w-72 flex-shrink-0 overflow-y-auto p-4">
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
                <LogStats logs={logs} analysis={logAnalysis()} />
              </div>
            </div>
          </div>
          <div class="fixed inset-0 z-40 lg:hidden">
            <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSidebar(false)} />
            <div class="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-xl border-t border-white/10 bg-[rgba(8,14,28,0.94)] p-4 shadow-2xl">
              <div class="mb-3 flex items-center justify-between border-b border-white/10 pb-2">
                <h3 class="text-xs font-mono uppercase tracking-[0.18em] text-text-muted">Log Tools</h3>
                <button
                  type="button"
                  class="h-8 w-8 rounded-md border border-white/10 bg-white/5 text-text-dim"
                  onClick={() => setShowSidebar(false)}
                >
                  ✕
                </button>
              </div>
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
                  <LogStats logs={logs} analysis={logAnalysis()} />
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* Main Log Panel */}
        <div class="glass-panel min-w-0 flex-1 overflow-hidden flex flex-col">
        <div class="flex h-full flex-col">
          {/* Header with Controls */}
          <div class="flex flex-wrap items-start justify-between gap-2 border-b border-white/5 px-4 py-2 sm:items-center">
            <div class="flex flex-wrap items-center gap-2 sm:gap-3">
              <span class="text-sm font-medium text-text-main">Logs</span>
              <span class="text-xs text-text-dim">{logs.length} entries</span>
              <Show when={logs.length > 0}>
                <span class="hidden md:inline text-[10px] font-mono text-text-dim">
                  accel {fiAccelSnapshot().initState} · analyze {fiAccelSnapshot().logAnalyzeCalls}x/{fiAccelSnapshot().logAnalyzeLines} lines · fallback {fiAccelSnapshot().logAnalyzeFallbackCalls}
                </span>
              </Show>
              <Show when={streaming()}>
                <span class="flex items-center gap-1 text-xs text-text-muted">
                  <span class="h-2 w-2 animate-pulse rounded-full bg-text-muted" />
                  Streaming
                </span>
              </Show>
            </div>

            {/* Right side controls */}
            <div class="flex flex-wrap items-center justify-end gap-2">
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
                    class={`w-20 sm:w-28 bg-transparent border-none text-xs text-text-main placeholder-text-dim focus:outline-none py-1 ${searchRegex() ? 'font-mono' : ''}`}
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
                        ? 'bg-white/10 text-white border border-white/20'
                        : 'text-text-dim hover:text-text-main'
                    }`}
                  >
                    .*
                  </button>
                </div>
              </Show>

              {/* View Mode Toggle */}
              <TabBar
                tabs={[
                  { id: 'list', label: 'TERMINAL' },
                  { id: 'flow', label: 'FLOW', color: 'white' },
                  { id: 'rain', label: 'MATRIX', color: 'white' },
                ]}
                active={viewMode()}
                onChange={setViewMode}
                size="sm"
              />

              {/* Clear button */}
              <button
                onClick={clearLogs}
                class="rounded px-2 py-1 text-xs text-text-dim hover:text-text-muted"
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
                  <thead class="sticky top-0 bg-[#0b1020] border-b border-white/10 z-10">
                    <tr class="text-text-dim text-[10px] uppercase tracking-wider">
                      <th class="text-left px-3 py-2 font-medium w-24">Time</th>
                      <th class="text-left px-3 py-2 font-medium w-32">Source</th>
                      <th class="text-left px-3 py-2 font-medium w-16">Level</th>
                      <th class="text-left px-3 py-2 font-medium">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={logs}>
                      {(entry, index) => {
                        const analysis = () => logAnalysis()[index()] ?? {
                          index: index(),
                          level: 'info' as const,
                          matchesFilter: true,
                          matchesSearch: false,
                        };
                        const badge = () => getLogLevelBadgeForLevel(analysis().level);
                        return (
                          <tr
                            class="border-b border-white/5 hover:bg-white/5 group cursor-pointer transition-colors duration-150"
                            onClick={() => handleLogClick(entry)}
                          >
                            <td class="whitespace-nowrap px-3 py-1.5 text-text-dim w-24 align-top">
                              {formatTimestamp(entry.timestamp)}
                            </td>
                            <td class="whitespace-nowrap px-3 py-1.5 text-text-muted w-32 align-top opacity-70 group-hover:opacity-100 truncate max-w-[8rem]" title={entry.labels.pod || entry.labels.container || '-'}>
                              {entry.labels.pod || entry.labels.container || '-'}
                            </td>
                            <td class="px-3 py-1.5 w-16 align-top">
                              <Show when={badge()}>
                                {(b) => (
                                  <span class={`px-1.5 py-0.5 text-[9px] font-mono rounded border ${b().class}`}>
                                    {b().text}
                                  </span>
                                )}
                              </Show>
                            </td>
                            <td class={`px-3 py-1.5 ${getLogLevelClassForLevel(analysis().level)} align-top`}>
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
                      'bg-white/40'
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
                              <span class="text-white">{key}</span>=<span class="text-text-main">{value}</span>
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
                    class="px-4 py-2 text-xs font-mono rounded bg-white/10 text-white border border-white/15 hover:bg-white/20 transition-colors"
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
