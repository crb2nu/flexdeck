/* @vitest-environment jsdom */

import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture registered poll tasks instead of running the real scheduler; ticks
// are driven manually via runTask below.
const polling = vi.hoisted(() => ({
  tasks: new Map<string, () => Promise<void> | void>(),
}));

vi.mock('./createPolling', () => ({
  createPolling: (id: string, task: () => Promise<void> | void) => {
    polling.tasks.set(id, task);
  },
}));

import { createPolledResource } from './createPolledResource';

const runTask = async (id: string) => {
  const task = polling.tasks.get(id);
  if (!task) throw new Error(`no poll task registered for ${id}`);
  await task();
};

describe('createPolledResource', () => {
  beforeEach(() => {
    polling.tasks.clear();
  });

  it('loads data, flips loaded, and clears error on success', async () => {
    await createRoot(async (dispose) => {
      const res = createPolledResource('t-load', async () => ({ n: 1 }));
      expect(res.data()).toBeNull();
      expect(res.loaded()).toBe(false);

      await runTask('t-load');

      expect(res.data()).toEqual({ n: 1 });
      expect(res.loaded()).toBe(true);
      expect(res.error()).toBeNull();
      dispose();
    });
  });

  it('keeps the last good payload and sets error on failure', async () => {
    await createRoot(async (dispose) => {
      let fail = false;
      const res = createPolledResource('t-err', async () => {
        if (fail) throw new Error('boom');
        return [{ id: 'a' }];
      });

      await runTask('t-err');
      expect(res.data()).toEqual([{ id: 'a' }]);

      fail = true;
      await runTask('t-err');
      expect(res.error()).toBe('boom');
      expect(res.data()).toEqual([{ id: 'a' }]); // stale-on-error
      expect(res.degraded()).toMatchObject({ stale: true, error: 'boom' });
      expect(res.degraded()?.updatedAt).toBeGreaterThan(0);

      fail = false;
      await runTask('t-err');
      expect(res.error()).toBeNull();
      expect(res.degraded()).toBeNull();
      dispose();
    });
  });

  it('does not report retained stale data before the first successful load', async () => {
    await createRoot(async (dispose) => {
      const res = createPolledResource('t-initial-err', async () => {
        throw new Error('offline');
      });

      await runTask('t-initial-err');

      expect(res.loaded()).toBe(true);
      expect(res.error()).toBe('offline');
      expect(res.data()).toBeNull();
      expect(res.degraded()).toBeNull();
      dispose();
    });
  });

  it('preserves item references across polls for unchanged keyed rows', async () => {
    await createRoot(async (dispose) => {
      // Fresh deep-equal objects each poll, as JSON.parse produces.
      const res = createPolledResource('t-stable', async () => [
        { id: 'a', state: 'running' },
        { id: 'b', state: 'queued' },
      ]);

      await runTask('t-stable');
      const firstA = res.data()![0];
      const firstB = res.data()![1];

      await runTask('t-stable');
      expect(res.data()![0]).toBe(firstA);
      expect(res.data()![1]).toBe(firstB);
      dispose();
    });
  });

  it('updates changed rows in place while keeping unchanged siblings stable', async () => {
    await createRoot(async (dispose) => {
      let stateB = 'queued';
      const res = createPolledResource('t-diff', async () => [
        { id: 'a', state: 'running' },
        { id: 'b', state: stateB },
      ]);

      await runTask('t-diff');
      const firstA = res.data()![0];

      stateB = 'done';
      await runTask('t-diff');
      expect(res.data()![0]).toBe(firstA);
      expect(res.data()![1].state).toBe('done');
      dispose();
    });
  });

  it('honors a custom reconcile key (Go-JSON PascalCase payloads)', async () => {
    await createRoot(async (dispose) => {
      const res = createPolledResource(
        't-key',
        async () => [{ ID: 'run-1', State: 'ci' }],
        { key: 'ID' },
      );

      await runTask('t-key');
      const first = res.data()![0];
      await runTask('t-key');
      expect(res.data()![0]).toBe(first);
      dispose();
    });
  });

  it('refresh() fetches immediately outside the poll schedule', async () => {
    await createRoot(async (dispose) => {
      let n = 0;
      const res = createPolledResource('t-refresh', async () => ({ n: ++n }));

      await res.refresh();
      expect(res.data()).toEqual({ n: 1 });
      expect(res.loaded()).toBe(true);
      dispose();
    });
  });
});
