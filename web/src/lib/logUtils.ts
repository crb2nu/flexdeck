/**
 * Shared log level detection and styling utilities
 */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * Detect log level from a log line
 */
export function getLogLevel(line: string): LogLevel {
  const lower = line.toLowerCase();

  // Error patterns
  if (
    lower.includes('error') ||
    lower.includes('fatal') ||
    lower.includes('panic') ||
    lower.includes('exception') ||
    lower.includes('fail')
  ) {
    return 'error';
  }

  // Warning patterns
  if (lower.includes('warn') || lower.includes('warning')) {
    return 'warn';
  }

  // Debug patterns
  if (lower.includes('debug') || lower.includes('trace')) {
    return 'debug';
  }

  return 'info';
}

/**
 * Get CSS class for log level styling
 */
export function getLogLevelClass(line: string): string {
  const level = getLogLevel(line);

  switch (level) {
    case 'error':
      return 'text-status-error';
    case 'warn':
      return 'text-status-warn';
    case 'debug':
      return 'text-text-dim';
    default:
      return 'text-text-muted';
  }
}

/**
 * Get badge info for log level
 */
export function getLogLevelBadge(line: string): { text: string; class: string } | null {
  const level = getLogLevel(line);

  switch (level) {
    case 'error':
      return {
        text: 'ERR',
        class: 'bg-red-500/20 text-red-400 border-red-500/30',
      };
    case 'warn':
      return {
        text: 'WARN',
        class: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      };
    case 'debug':
      return {
        text: 'DBG',
        class: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
      };
    default:
      return null; // No badge for info level
  }
}

/**
 * Get color for log level (used in visualizations)
 */
export function getLogLevelColor(line: string): string {
  const level = getLogLevel(line);

  switch (level) {
    case 'error':
      return '#ef4444'; // red-500
    case 'warn':
      return '#f59e0b'; // amber-500
    case 'debug':
      return '#6b7280'; // gray-500
    default:
      return '#00f0ff'; // neon-cyan
  }
}
