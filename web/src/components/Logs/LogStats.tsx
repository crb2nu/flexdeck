import { Component, createMemo } from 'solid-js';
import type { FiAccelLogAnalysisMatch } from '../../lib/fiAccel';
import type { LogEntry } from './LogStream';

interface Props {
  logs: LogEntry[];
  analysis?: FiAccelLogAnalysisMatch[];
}

const LogStats: Component<Props> = (props) => {
  const stats = createMemo(() => {
    let errors = 0;
    let warnings = 0;
    let info = 0;
    let debug = 0;

    const analysis = props.analysis;
    if (analysis && analysis.length === props.logs.length) {
      for (const match of analysis) {
        if (match.level === 'error') {
          errors++;
        } else if (match.level === 'warn') {
          warnings++;
        } else if (match.level === 'debug') {
          debug++;
        } else {
          info++;
        }
      }
      return { total: props.logs.length, errors, warnings, info, debug };
    }

    for (const log of props.logs) {
      const lower = log.line.toLowerCase();
      if (lower.includes('error') || lower.includes('fatal') || lower.includes('panic')) {
        errors++;
      } else if (lower.includes('warn')) {
        warnings++;
      } else if (lower.includes('debug') || lower.includes('trace')) {
        debug++;
      } else {
        info++;
      }
    }

    return { total: props.logs.length, errors, warnings, info, debug };
  });

  const errorRate = createMemo(() => {
    const s = stats();
    if (s.total === 0) return 0;
    return (s.errors / s.total) * 100;
  });

  return (
    <div class="space-y-3">
      {/* Total Count */}
      <div class="flex items-center justify-between">
        <span class="text-xs text-text-muted">Total Logs</span>
        <span class="text-sm font-mono text-text-main">{stats().total.toLocaleString()}</span>
      </div>

      {/* Level Breakdown */}
      <div class="space-y-2">
        <span class="text-[10px] text-text-dim uppercase tracking-wider">By Level</span>

        {/* Error */}
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-status-error" />
          <span class="text-xs text-text-muted flex-1">Errors</span>
          <span class="text-xs font-mono text-status-error">{stats().errors}</span>
          <div class="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              class="h-full bg-status-error rounded-full transition-all"
              style={{ width: `${stats().total > 0 ? (stats().errors / stats().total) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Warnings */}
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-status-warn" />
          <span class="text-xs text-text-muted flex-1">Warnings</span>
          <span class="text-xs font-mono text-status-warn">{stats().warnings}</span>
          <div class="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              class="h-full bg-status-warn rounded-full transition-all"
              style={{ width: `${stats().total > 0 ? (stats().warnings / stats().total) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Info */}
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-white/40" />
          <span class="text-xs text-text-muted flex-1">Info</span>
          <span class="text-xs font-mono text-text-muted">{stats().info}</span>
          <div class="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              class="h-full bg-white/40 rounded-full transition-all"
              style={{ width: `${stats().total > 0 ? (stats().info / stats().total) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Debug */}
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-text-dim" />
          <span class="text-xs text-text-muted flex-1">Debug</span>
          <span class="text-xs font-mono text-text-dim">{stats().debug}</span>
          <div class="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              class="h-full bg-text-dim rounded-full transition-all"
              style={{ width: `${stats().total > 0 ? (stats().debug / stats().total) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Error Rate Indicator */}
      <div class="pt-2 border-t border-white/5">
        <div class="flex items-center justify-between mb-1">
          <span class="text-[10px] text-text-dim uppercase tracking-wider">Error Rate</span>
          <span class={`text-sm font-mono ${
            errorRate() > 10 ? 'text-status-error' :
            errorRate() > 5 ? 'text-status-warn' :
            'text-status-ok'
          }`}>
            {errorRate().toFixed(1)}%
          </span>
        </div>
        <div class="w-full h-2 bg-white/5 rounded-full overflow-hidden">
          <div
            class={`h-full rounded-full transition-all ${
              errorRate() > 10 ? 'bg-status-error' :
              errorRate() > 5 ? 'bg-status-warn' :
              'bg-status-ok'
            }`}
            style={{ width: `${Math.min(errorRate(), 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default LogStats;
