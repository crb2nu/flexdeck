import { describe, expect, it } from 'vitest';
import {
  clearAsyncValueState,
  completeAsyncValueState,
  createAsyncStatusController,
  createAsyncValueState,
  failAsyncValueState,
  resetAsyncValueState,
  startAsyncValueState,
} from './asyncState';

describe('asyncState', () => {
  it('manages async value state transitions', () => {
    const state = createAsyncValueState<string | null>(null);

    startAsyncValueState(state);
    expect(state.loading()).toBe(true);

    completeAsyncValueState(state, 'ready');
    expect(state.value()).toBe('ready');
    expect(state.loading()).toBe(false);
    expect(state.error()).toBe('');
    expect(state.updatedAt()).toBeGreaterThan(0);

    failAsyncValueState(state, 'offline');
    expect(state.error()).toBe('offline');
    expect(state.loading()).toBe(false);

    clearAsyncValueState(state, null);
    expect(state.value()).toBeNull();
    expect(state.loading()).toBe(false);
    expect(state.error()).toBe('');
    expect(state.updatedAt()).toBe(0);

    resetAsyncValueState(state, 'seed');
    expect(state.value()).toBe('seed');
    expect(state.loading()).toBe(true);
    expect(state.error()).toBe('');
    expect(state.updatedAt()).toBe(0);
  });

  it('manages shared async status controller transitions', () => {
    const controller = createAsyncStatusController({
      workflowAction: null as string | null,
      now: 0,
    });

    expect(controller.start()).toBe(true);
    controller.succeed({ now: 10 });
    expect(controller.state.loading).toBe(false);
    expect(controller.state.refreshing).toBe(false);
    expect(controller.state.now).toBe(10);

    expect(controller.start()).toBe(false);
    expect(controller.state.refreshing).toBe(true);

    controller.fail('broken', { workflowAction: 'retry' });
    expect(controller.state.error).toBe('broken');
    expect(controller.state.loading).toBe(false);
    expect(controller.state.refreshing).toBe(false);
    expect(controller.state.workflowAction).toBe('retry');
  });
});
