import { createMemo, createSignal, type Accessor } from 'solid-js';
import { createPolling } from '../../../hooks/createPolling';
import { k8s as k8sApi, modelsApi } from '../../../lib/api';
import type { FlexInferModel, GamingSession, K8sNode } from '../../../lib/types';
import { buildFleet, summarizeFleet, type FleetNode, type FleetSummary } from './fleet';

const POLL_MS = 15_000;

export interface GpuFleetState {
  fleet: Accessor<FleetNode[]>;
  summary: Accessor<FleetSummary>;
  error: Accessor<string>;
  loaded: Accessor<boolean>;
  now: Accessor<number>;
}

/**
 * Owns the GPU fleet's live data (node roster, gaming sessions) and derives the
 * mode-classified fleet + summary. Called once at the Workbench level so the
 * nav chip and the board render from a single source of truth.
 */
export function useGpuFleet(models: Accessor<FlexInferModel[]>): GpuFleetState {
  const [nodes, setNodes] = createSignal<K8sNode[]>([]);
  const [sessions, setSessions] = createSignal<GamingSession[]>([]);
  const [error, setError] = createSignal('');
  const [loaded, setLoaded] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());

  const fetchNodes = async () => {
    try {
      const resp = await k8sApi.getNodes();
      setNodes((resp?.items as K8sNode[]) || []);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load nodes');
    } finally {
      setLoaded(true);
    }
  };

  const fetchSessions = async () => {
    try {
      const resp = await modelsApi.gamingSessions();
      setSessions(resp?.sessions || []);
    } catch {
      // GamingSession access is best-effort — a 403 or absent CRD just means no
      // gaming nodes surface; the rest of the fleet still renders.
      setSessions([]);
    }
  };

  createPolling('gpu-fleet-nodes', fetchNodes, POLL_MS, true, true);
  createPolling('gpu-fleet-gaming', fetchSessions, POLL_MS, true, true);
  createPolling('gpu-fleet-clock', () => {
    setNow(Date.now());
  }, 30_000, true, false);

  const fleet = createMemo(() => buildFleet(nodes(), models(), sessions()));
  const summary = createMemo(() => summarizeFleet(fleet()));

  return { fleet, summary, error, loaded, now };
}
