import { createSignal, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { LogEntry, LogFilter } from './LogStream';
import { showToast } from '../shared/Toast';

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

export const LOG_TIME_RANGES = [
  { label: '15m', value: '15m' },
  { label: '1h', value: '1h' },
  { label: '3h', value: '3h' },
  { label: '6h', value: '6h' },
  { label: '12h', value: '12h' },
  { label: '24h', value: '24h' },
] as const;

const DEFAULT_QUERY = '{namespace="default"}';
const DEFAULT_LIMIT = 100;
const DEFAULT_TIME_RANGE = '1h';
const DEFAULT_VIEW_MODE = 'list';
const STREAM_LOG_CAP = 1000;

function parseTimeRange(range: string): number {
  const match = range.match(/^(\d+)([mhd])$/);
  if (!match) return 3600000;
  const [, count, unit] = match;
  const multipliers: Record<string, number> = { m: 60000, h: 3600000, d: 86400000 };
  return parseInt(count, 10) * (multipliers[unit] || 3600000);
}

function buildLogEntries(streams: LokiStream[] | undefined): LogEntry[] {
  if (!streams?.length) return [];

  const entries: LogEntry[] = [];
  for (const stream of streams) {
    for (const [timestampNs, line] of stream.values) {
      entries.push({
        timestamp: new Date(Number(BigInt(timestampNs) / 1000000n)).toISOString(),
        line,
        labels: stream.stream,
      });
    }
  }

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries;
}

export function useLogsController() {
  const [query, setQuery] = createSignal(DEFAULT_QUERY);
  const [logs, setLogs] = createStore<LogEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [streaming, setStreaming] = createSignal(false);
  const [limit, setLimit] = createSignal(DEFAULT_LIMIT);
  const [timeRange, setTimeRange] = createSignal(DEFAULT_TIME_RANGE);
  const [viewMode, setViewMode] = createSignal<'list' | 'flow' | 'rain'>(DEFAULT_VIEW_MODE);
  const [selectedLog, setSelectedLog] = createSignal<LogEntry | null>(null);
  const [searchTerm, setSearchTerm] = createSignal('');
  const [searchRegex, setSearchRegex] = createSignal(false);
  const [showSidebar, setShowSidebar] = createSignal(false);
  const [modalClosing, setModalClosing] = createSignal(false);

  let eventSource: EventSource | null = null;
  let closeModalTimeout: ReturnType<typeof setTimeout> | null = null;

  const stopStreaming = () => {
    setStreaming(false);
    eventSource?.close();
    eventSource = null;
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
        start: (BigInt(start) * 1000000n).toString(),
        end: (BigInt(now) * 1000000n).toString(),
      });

      const response = await fetch(`/api/loki/query_range?${params}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: LokiQueryResponse = await response.json();
      setLogs(buildLogEntries(data.data?.result));
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
        const data = JSON.parse(event.data) as { streams?: LokiStream[] };
        if (!data.streams?.length) return;
        const nextEntries = buildLogEntries(data.streams);
        if (nextEntries.length === 0) return;
        setLogs((prev: LogEntry[]) => [...nextEntries, ...prev].slice(0, STREAM_LOG_CAP));
      } catch {
        // Ignore parse errors.
      }
    };

    eventSource.onerror = () => {
      stopStreaming();
    };
  };

  const closeModal = () => {
    if (closeModalTimeout) {
      clearTimeout(closeModalTimeout);
      closeModalTimeout = null;
    }

    setModalClosing(true);
    closeModalTimeout = setTimeout(() => {
      setSelectedLog(null);
      setModalClosing(false);
      closeModalTimeout = null;
    }, 150);
  };

  const logFilter = (): LogFilter => ({
    searchTerm: searchTerm() || undefined,
    searchRegex: searchRegex(),
  });

  const handleLogClick = (log: LogEntry) => {
    setSelectedLog(log);
  };

  const clearLogs = () => setLogs([]);

  const copyToClipboard = async (text: string, label = 'Content') => {
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

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && selectedLog()) {
        closeModal();
      }
    };

    window.addEventListener('keydown', handleKeydown);
    onCleanup(() => window.removeEventListener('keydown', handleKeydown));
  });

  onCleanup(() => {
    stopStreaming();
    if (closeModalTimeout) {
      clearTimeout(closeModalTimeout);
    }
  });

  return {
    query,
    setQuery,
    logs,
    setLogs,
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
    setSelectedLog,
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
  };
}
