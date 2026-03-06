import { createEffect, onCleanup } from 'solid-js';
import { pollingScheduler } from '../lib/polling';

/**
 * SolidJS hook to register a polling task that automatically unregisters on cleanup.
 * Respects page visibility (pauses when tab is hidden).
 * 
 * @param id Unique identifier for the task
 * @param task Function to execute
 * @param interval Polling interval in milliseconds (accessor or constant)
 * @param enabled Whether polling is currently enabled (accessor or constant)
 */
export function createPolling(
  id: string | (() => string),
  task: () => Promise<void> | void,
  interval: number | (() => number),
  enabled: boolean | (() => boolean) = true
) {
  createEffect(() => {
    const taskId = typeof id === 'function' ? id() : id;
    const isEnabled = typeof enabled === 'function' ? enabled() : enabled;
    const intervalMs = typeof interval === 'function' ? interval() : interval;

    if (isEnabled) {
      pollingScheduler.register(taskId, task, intervalMs);
    } else {
      pollingScheduler.unregister(taskId);
    }

    onCleanup(() => {
      pollingScheduler.unregister(taskId);
    });
  });

  onCleanup(() => {
    const taskId = typeof id === 'function' ? id() : id;
    pollingScheduler.unregister(taskId);
  });

  return {
    trigger: () => {
      const taskId = typeof id === 'function' ? id() : id;
      pollingScheduler.trigger(taskId);
    }
  };
}
