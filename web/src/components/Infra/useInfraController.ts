import { createSignal } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { api } from '../../lib/api/client';
import type { InfraSnapshot } from './types';

const POLL_INTERVAL = 30_000;

export function useInfraController() {
  const [snapshot, setSnapshot] = createSignal<InfraSnapshot | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [lastUpdated, setLastUpdated] = createSignal(0);

  const fetchSnapshot = async () => {
    try {
      const data = await api<InfraSnapshot>('/infra/snapshot');
      setSnapshot(data);
      setLastUpdated(Date.now());
      setError('');
      window.__FLEXDECK_INFRA__ = data;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load infra snapshot');
    } finally {
      setLoading(false);
    }
  };

  const { trigger } = createPolling('infra-snapshot', fetchSnapshot, POLL_INTERVAL);

  return { snapshot, loading, error, lastUpdated, trigger };
}
