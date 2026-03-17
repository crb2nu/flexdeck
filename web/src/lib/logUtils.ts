/**
 * Shared log level detection and styling utilities
 */

import { detectLogLevel } from './fiAccel';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export function getLogLevelClassForLevel(level: LogLevel): string {
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

export function getLogLevelBadgeForLevel(level: LogLevel): { text: string; class: string } | null {
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
      return null;
  }
}

export function getLogLevelColorForLevel(level: LogLevel): string {
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

/**
 * Detect log level from a log line
 */
export function getLogLevel(line: string): LogLevel {
  return detectLogLevel(line);
}

/**
 * Get CSS class for log level styling
 */
export function getLogLevelClass(line: string): string {
  return getLogLevelClassForLevel(getLogLevel(line));
}

/**
 * Get badge info for log level
 */
export function getLogLevelBadge(line: string): { text: string; class: string } | null {
  return getLogLevelBadgeForLevel(getLogLevel(line));
}

/**
 * Get color for log level (used in visualizations)
 */
export function getLogLevelColor(line: string): string {
  return getLogLevelColorForLevel(getLogLevel(line));
}
