import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';

import {
  createSnapshotSurfaceController,
  resolveSnapshotSurfaceStatus,
  type SnapshotSurfaceState,
} from './snapshotSurface';

function state<T>(patch: Partial<SnapshotSurfaceState<T>>): SnapshotSurfaceState<T> {
  return {
    data: null,
    loading: false,
    refreshing: false,
    error: '',
    updatedAt: 0,
    sourceUpdatedAt: 0,
    ...patch,
  };
}

describe('resolveSnapshotSurfaceStatus', () => {
  it('distinguishes initial, ready, refreshing, stale, and stale-error states', () => {
    expect(resolveSnapshotSurfaceStatus(state({ loading: true }), 30_000, 100_000)).toBe('connecting');
    expect(resolveSnapshotSurfaceStatus(state({ data: { ok: true }, updatedAt: 90_000 }), 30_000, 100_000)).toBe('ready');
    expect(resolveSnapshotSurfaceStatus(state({ data: { ok: true }, updatedAt: 90_000, refreshing: true }), 30_000, 100_000)).toBe('partial');
    expect(resolveSnapshotSurfaceStatus(state({ data: { ok: true }, updatedAt: 10_000 }), 30_000, 100_000)).toBe('stale');
    expect(resolveSnapshotSurfaceStatus(state({ data: { ok: true }, updatedAt: 90_000, error: 'timeout' }), 30_000, 100_000)).toBe('stale');
  });

  it('uses source freshness when backend snapshots carry their own timestamp', () => {
    expect(
      resolveSnapshotSurfaceStatus(
        state({
          data: { ok: true },
          updatedAt: 100_000,
          sourceUpdatedAt: 50_000,
        }),
        30_000,
        100_000,
      ),
    ).toBe('stale');
  });
});

describe('createSnapshotSurfaceController', () => {
  it('keeps the last successful snapshot visible after refresh failures', () => {
    createRoot((dispose) => {
      const now = vi.fn(() => 100_000);
      const surface = createSnapshotSurfaceController<{ value: string }>({
        staleAfterMs: 30_000,
        now,
      });

      expect(surface.showBlockingLoading()).toBe(true);
      surface.succeed({ value: 'first' });
      expect(surface.data()).toEqual({ value: 'first' });
      expect(surface.status()).toBe('ready');

      surface.start();
      expect(surface.state.refreshing).toBe(true);
      expect(surface.showBlockingLoading()).toBe(false);

      surface.fail('upstream timeout');
      expect(surface.data()).toEqual({ value: 'first' });
      expect(surface.state.error).toBe('upstream timeout');
      expect(surface.status()).toBe('stale');
      expect(surface.showBlockingError()).toBe(false);

      dispose();
    });
  });

  it('reconciles nested lists so unchanged rows keep their identity across refreshes', () => {
    createRoot((dispose) => {
      interface Snap {
        nodes: { name: string; cpu: number }[];
      }
      const surface = createSnapshotSurfaceController<Snap>({
        staleAfterMs: 30_000,
        now: () => 100_000,
      });

      surface.succeed({ nodes: [{ name: 'a', cpu: 1 }, { name: 'b', cpu: 2 }] });
      const firstA = surface.data()!.nodes[0];
      const firstB = surface.data()!.nodes[1];

      // A brand-new fetched payload with identical structure; only b's cpu moved.
      surface.succeed({ nodes: [{ name: 'a', cpu: 1 }, { name: 'b', cpu: 9 }] });

      // Unchanged row 'a' must keep its object identity so <For> reuses its DOM
      // node instead of remounting (this is what stops the poll flicker). Before
      // the reconcile fix, replacing `data` wholesale made every row a new ref.
      expect(surface.data()!.nodes[0]).toBe(firstA);
      // Row 'b' changed, so its leaf updates in place (same proxy, new value).
      expect(surface.data()!.nodes[1]).toBe(firstB);
      expect(surface.data()!.nodes[1].cpu).toBe(9);

      dispose();
    });
  });
});
