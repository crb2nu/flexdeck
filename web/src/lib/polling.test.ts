/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollingScheduler } from './polling';

describe('pollingScheduler', () => {
  let hidden = false;
  const defineHidden = (value: boolean) => {
    hidden = value;
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    defineHidden(false);
  });

  afterEach(() => {
    pollingScheduler.unregister('polling-immediate-default');
    pollingScheduler.unregister('polling-immediate-disabled');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fires the initial run when immediate polling is enabled', () => {
    const task = vi.fn();

    pollingScheduler.register('polling-immediate-default', task, 10_000);

    vi.advanceTimersByTime(40);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it('defers the initial run and resume fire when immediate polling is disabled', () => {
    const task = vi.fn();

    pollingScheduler.register('polling-immediate-disabled', task, 10_000, false);

    expect(task).not.toHaveBeenCalled();

    defineHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));
    defineHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(task).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);

    expect(task).toHaveBeenCalledTimes(1);
  });
});
