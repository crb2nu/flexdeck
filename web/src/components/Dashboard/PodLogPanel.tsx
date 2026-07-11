import { Component, createSignal, createEffect, onMount, onCleanup, Show, For } from 'solid-js';
import { loki } from '../../lib/api';
import { formatClockTime } from '../../lib/format';

interface LogEntry {
  timestamp: string;
  line: string;
  labels: Record<string, string>;
}

export interface PodLogPanelProps {
  podName: string;
  namespace: string;
  onClose: () => void;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

const PodLogPanel: Component<PodLogPanelProps> = (props) => {
  const [logs, setLogs] = createSignal<LogEntry[]>([]);
  const [status, setStatus] = createSignal<ConnectionStatus>('connecting');
  const [isPaused, setIsPaused] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal('');
  const [autoScroll, setAutoScroll] = createSignal(true);

  let logContainerRef: HTMLDivElement | undefined;
  let eventSource: EventSource | null = null;

  // Build Loki query for this pod
  const buildQuery = () => {
    return `{namespace="${props.namespace}", pod="${props.podName}"}`;
  };

  // Fetch initial logs (last 50 lines)
  const fetchInitialLogs = async () => {
    try {
      const query = buildQuery();
      const end = Math.floor(Date.now() / 1000);
      const start = end - 3600; // Last hour

      const response = await loki.queryRange(
        query,
        start,
        end,
        50
      );

      if (response?.data?.result) {
        const entries: LogEntry[] = [];
        for (const stream of response.data.result) {
          const labels = stream.stream || {};
          for (const [ts, line] of stream.values || []) {
            entries.push({
              timestamp: new Date(Number(ts) / 1e6).toISOString(),
              line,
              labels
            });
          }
        }
        // Sort by timestamp
        entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        setLogs(entries.slice(-50));
      }
    } catch (err) {
      console.error('Failed to fetch initial logs:', err);
    }
  };

  // Connect to SSE stream
  const connectSSE = () => {
    if (eventSource) {
      eventSource.close();
    }

    setStatus('connecting');
    const query = buildQuery();
    const url = `/api/loki/tail-sse?query=${encodeURIComponent(query)}`;

    eventSource = new EventSource(url);

    eventSource.addEventListener('ready', () => {
      setStatus('connected');
      setErrorMessage('');
    });

    eventSource.addEventListener('error', (event) => {
      console.error('SSE error:', event);
      setStatus('error');
      setErrorMessage('Connection lost');
    });

    eventSource.onmessage = (event) => {
      if (isPaused()) return;

      try {
        const data = JSON.parse(event.data);
        if (data.streams) {
          const newEntries: LogEntry[] = [];
          for (const stream of data.streams) {
            const labels = stream.stream || {};
            for (const [ts, line] of stream.values || []) {
              newEntries.push({
                timestamp: new Date(Number(ts) / 1e6).toISOString(),
                line,
                labels
              });
            }
          }

          if (newEntries.length > 0) {
            setLogs(prev => {
              const combined = [...prev, ...newEntries];
              // Keep last 500 logs
              return combined.slice(-500);
            });
          }
        }
      } catch (err) {
        console.error('Failed to parse SSE message:', err);
      }
    };
  };

  // Auto-scroll effect
  createEffect(() => {
    const _ = logs();
    if (autoScroll() && logContainerRef) {
      logContainerRef.scrollTop = logContainerRef.scrollHeight;
    }
  });

  // Handle scroll to detect manual scrolling
  const handleScroll = () => {
    if (!logContainerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const getLogLevelColor = (line: string): string => {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) return 'text-red-400';
    if (lower.includes('warn')) return 'text-yellow-400';
    if (lower.includes('debug') || lower.includes('trace')) return 'text-gray-500';
    return 'text-text-main';
  };

  const getLogLevelBadge = (line: string): { text: string; class: string } | null => {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) {
      return { text: 'ERR', class: 'bg-red-500/20 text-red-400 border-red-500/30' };
    }
    if (lower.includes('warn')) {
      return { text: 'WRN', class: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' };
    }
    if (lower.includes('debug') || lower.includes('trace')) {
      return { text: 'DBG', class: 'bg-gray-500/20 text-gray-400 border-gray-500/30' };
    }
    return { text: 'INF', class: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30' };
  };


  onMount(() => {
    fetchInitialLogs();
    connectSSE();
  });

  onCleanup(() => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  });

  return (
    <div class="fixed inset-y-0 right-0 w-full sm:w-[480px] z-modal animate-slide-in-right flex flex-col"
         style={{
           background: 'linear-gradient(180deg, rgba(10, 16, 32, 0.98) 0%, rgba(5, 10, 20, 0.99) 100%)',
           'border-left': '1px solid rgb(var(--info-rgb) / 0.2)',
           'backdrop-filter': 'blur(4px)',
           'box-shadow': '-10px 0 40px rgba(0, 0, 0, 0.5)'
         }}>
      {/* Header */}
      <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div class="flex items-center gap-3">
          {/* Connection status indicator */}
          <div class={`w-2 h-2 rounded-full ${
            status() === 'connected' ? 'bg-status-ok animate-pulse' :
            status() === 'connecting' ? 'bg-yellow-500 animate-pulse' :
            status() === 'error' ? 'bg-red-500' :
            'bg-gray-500'
          }`} />

          <div>
            <h3 class="text-sm font-bold text-white font-mono tracking-wide">
              Pod Logs
            </h3>
            <p class="text-[10px] text-text-dim truncate max-w-[250px]">
              {props.namespace}/{props.podName}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          {/* Log count */}
          <span class="text-[10px] text-text-dim font-mono">
            {logs().length} logs
          </span>

          {/* Close button */}
          <button
            onClick={props.onClose}
            aria-label="Close log panel"
            class="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-200 hover:bg-white/10 border border-white/10"
          >
            <span class="text-text-muted text-lg">×</span>
          </button>
        </div>
      </div>

      {/* Controls */}
      <div class="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-black/20">
        <button
          onClick={() => setIsPaused(!isPaused())}
          class={`px-3 py-1 text-[10px] font-mono uppercase rounded-lg transition-all border ${
            isPaused()
              ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400'
              : 'bg-white/5 border-white/10 text-text-muted hover:bg-white/10'
          }`}
        >
          {isPaused() ? 'Resume' : 'Pause'}
        </button>

        <button
          onClick={clearLogs}
          class="px-3 py-1 text-[10px] font-mono uppercase rounded-lg bg-white/5 border border-white/10 text-text-muted hover:bg-white/10 transition-all"
        >
          Clear
        </button>

        <button
          onClick={() => {
            eventSource?.close();
            connectSSE();
          }}
          class="px-3 py-1 text-[10px] font-mono uppercase rounded-lg bg-white/5 border border-white/10 text-text-muted hover:bg-white/10 transition-all"
        >
          Reconnect
        </button>

        <div class="flex-1" />

        {/* Auto-scroll indicator */}
        <button
          onClick={() => {
            setAutoScroll(true);
            if (logContainerRef) {
              logContainerRef.scrollTop = logContainerRef.scrollHeight;
            }
          }}
          class={`px-2 py-1 text-[10px] font-mono rounded transition-all ${
            autoScroll()
              ? 'text-white'
              : 'text-text-dim hover:text-text-main'
          }`}
        >
          {autoScroll() ? '⬇ Auto' : '⬇ Scroll'}
        </button>
      </div>

      {/* Error message */}
      <Show when={status() === 'error' && errorMessage()}>
        <div class="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs">
          {errorMessage()}
        </div>
      </Show>

      {/* Log content */}
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        class="flex-1 overflow-y-auto font-mono text-xs p-2 space-y-0.5"
        style={{
          background: 'rgba(0, 0, 0, 0.3)'
        }}
      >
        <Show when={logs().length === 0}>
          <div class="flex items-center justify-center h-full text-text-dim">
            <div class="text-center">
              <div class="text-2xl mb-2">📋</div>
              <p>Waiting for logs...</p>
            </div>
          </div>
        </Show>

        <For each={logs()}>
          {(log) => {
            const badge = getLogLevelBadge(log.line);
            return (
              <div class="flex gap-2 py-0.5 px-1 hover:bg-white/5 rounded group">
                <span class="text-text-dim shrink-0 w-16">
                  {formatClockTime(log.timestamp)}
                </span>
                <Show when={badge}>
                  <span class={`px-1 rounded text-[9px] border shrink-0 ${badge!.class}`}>
                    {badge!.text}
                  </span>
                </Show>
                <span class={`break-all ${getLogLevelColor(log.line)}`}>
                  {log.line}
                </span>
              </div>
            );
          }}
        </For>

        {/* Pause overlay */}
        <Show when={isPaused()}>
          <div class="sticky bottom-2 left-0 right-0 flex justify-center pointer-events-none">
            <div class="px-4 py-2 rounded-lg bg-yellow-500/20 border border-yellow-500/40 text-yellow-400 text-xs font-mono uppercase">
              Paused - {logs().length} logs buffered
            </div>
          </div>
        </Show>
      </div>

      {/* Corner accents */}
      <div class="absolute top-0 left-0 w-4 h-4 border-l-2 border-t-2 border-white/15 pointer-events-none" />
      <div class="absolute bottom-0 left-0 w-4 h-4 border-l-2 border-b-2 border-white/15 pointer-events-none" />

      <style>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }

        .animate-slide-in-right {
          animation: slide-in-right 0.3s ease-out forwards;
        }
      `}</style>
    </div>
  );
};

export default PodLogPanel;
