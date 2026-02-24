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
  id: string,
  task: () => Promise<void> | void,
  interval: number | (() => number),
  enabled: boolean | (() => boolean) = true
) {
  createEffect(() => {
    const isEnabled = typeof enabled === 'function' ? enabled() : enabled;
    const intervalMs = typeof interval === 'function' ? interval() : interval;

    if (isEnabled) {
      pollingScheduler.register(id, task, intervalMs);
    } else {
      pollingScheduler.unregister(id);
    }
  });

  onCleanup(() => {
    pollingScheduler.unregister(id);
  });

  return {
    trigger: () => pollingScheduler.trigger(id)
  };
}
