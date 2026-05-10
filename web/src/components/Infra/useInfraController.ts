import { createPolling } from '../../hooks/createPolling';
import { api } from '../../lib/api/client';
import { createSnapshotSurfaceController } from '../../lib/snapshotSurface';
import type { InfraSnapshot } from './types';

const POLL_INTERVAL = 30_000;
const STALE_AFTER_MS = POLL_INTERVAL * 3;

export function useInfraController() {
  const surface = createSnapshotSurfaceController<InfraSnapshot>({
    staleAfterMs: STALE_AFTER_MS,
    statusDetail: (state, status) => {
      if (status === 'partial' && state.refreshing) return 'refreshing';
      if (status === 'stale' && state.error) return 'last good snapshot';
      return undefined;
    },
  });

  const fetchSnapshot = async () => {
    surface.start();
    try {
      const data = await api<InfraSnapshot>('/infra/snapshot');
      surface.succeed(data, { sourceUpdatedAt: data.lastUpdated });
      window.__FLEXDECK_INFRA__ = data;
    } catch (err) {
      surface.fail(err instanceof Error ? err.message : 'Failed to load infra snapshot');
    }
  };

  const { trigger } = createPolling('infra-snapshot', fetchSnapshot, POLL_INTERVAL);

  return {
    snapshot: surface.data,
    loading: () => surface.state.loading,
    refreshing: () => surface.state.refreshing,
    error: () => surface.state.error,
    lastUpdated: () => surface.state.updatedAt,
    status: surface.status,
    statusLabel: surface.statusLabel,
    statusClass: surface.statusClass,
    showBlockingLoading: surface.showBlockingLoading,
    showBlockingError: surface.showBlockingError,
    trigger,
  };
}
