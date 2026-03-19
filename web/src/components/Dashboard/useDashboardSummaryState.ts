import { createEffect, createMemo, createSignal } from 'solid-js';
import { createPolling } from '../../hooks/createPolling';
import { modelsApi, flexinferProxyApi, hudApi, agentsApi } from '../../lib/api';
import type { FlexInferProxyMetricsResponse } from '../../lib/types';
import { healthStore } from '../../stores/health';
import { metricsStore } from '../../stores/metrics';
import { buildInferenceHealthSummary } from './inferenceHealth';
import { resolveDashboardDataState } from './statusSemantics';

class RingBuffer {
  private buf: number[];
  private pos = 0;
  private full = false;
  constructor(private cap: number) {
    this.buf = new Array(cap);
  }
  push(val: number) {
    this.buf[this.pos] = val;
    this.pos = (this.pos + 1) % this.cap;
    if (!this.full && this.pos === 0) this.full = true;
  }
  toArray(): number[] {
    if (!this.full) return this.buf.slice(0, this.pos);
    return [...this.buf.slice(this.pos), ...this.buf.slice(0, this.pos)];
  }
}

export interface ModelCountState {
  deployed: number;
  total: number;
  loading: boolean;
  error: string;
}

export interface InferenceHealthState {
  totalTps: number;
  modelCount: number;
  queueDepth: number;
  loading: boolean;
  error: string;
}

export interface AgentActivityState {
  activeAgents: number;
  totalTasks: number;
  pendingApprovals: number;
  loading: boolean;
  error: string;
}

interface UseDashboardSummaryStateInput {
  metricsRefreshInterval: number;
  staleAfterMs: number;
}

export function useDashboardSummaryState(input: UseDashboardSummaryStateInput) {
  const { metricsRefreshInterval, staleAfterMs } = input;

  const cpuPercent = () => metricsStore.clusterCpu;
  const memUsed = () => metricsStore.clusterMemory;
  const resourceLoading = () => metricsStore.loading;

  const cpuRing = new RingBuffer(20);
  const memRing = new RingBuffer(20);
  const [cpuHistoryVersion, setCpuHistoryVersion] = createSignal(0);
  const [memHistoryVersion, setMemHistoryVersion] = createSignal(0);

  createEffect(() => {
    const cpu = cpuPercent();
    const mem = memUsed();
    if (cpu > 0) { cpuRing.push(cpu); setCpuHistoryVersion((v) => v + 1); }
    if (mem > 0) { memRing.push(mem); setMemHistoryVersion((v) => v + 1); }
  });

  const cpuHistory = createMemo(() => { cpuHistoryVersion(); return cpuRing.toArray(); });
  const memHistory = createMemo(() => { memHistoryVersion(); return memRing.toArray(); });

  const [modelCount, setModelCount] = createSignal<ModelCountState>({
    deployed: 0,
    total: 0,
    loading: true,
    error: '',
  });
  const [modelLastUpdateMs, setModelLastUpdateMs] = createSignal(0);

  const fetchModelCount = async () => {
    try {
      const result = await modelsApi.list();
      const models = result?.models || [];
      const deployed = models.filter(
        (model: { deployment_status?: string }) => model.deployment_status === 'deployed',
      ).length;
      setModelCount({ deployed, total: models.length, loading: false, error: '' });
      setModelLastUpdateMs(Date.now());
    } catch {
      setModelCount((prev) => ({ ...prev, loading: false, error: 'offline' }));
    }
  };

  const [inferenceHealth, setInferenceHealth] = createSignal<InferenceHealthState>({
    totalTps: 0,
    modelCount: 0,
    queueDepth: 0,
    loading: true,
    error: '',
  });
  const [inferenceLastUpdateMs, setInferenceLastUpdateMs] = createSignal(0);
  const tpsRing = new RingBuffer(20);
  const [tpsHistoryVersion, setTpsHistoryVersion] = createSignal(0);
  const tpsHistory = createMemo(() => { tpsHistoryVersion(); return tpsRing.toArray(); });

  const fetchInferenceHealth = async () => {
    if (!healthStore.features.flexinfer_proxy?.enabled) return;
    try {
      const data: FlexInferProxyMetricsResponse = await flexinferProxyApi.metrics();
      const summary = buildInferenceHealthSummary(data);

      setInferenceHealth({
        totalTps: summary.totalTps,
        modelCount: summary.modelCount,
        queueDepth: summary.queueDepth,
        loading: false,
        error: summary.error,
      });
      setInferenceLastUpdateMs(Date.now());
      if (summary.totalTps > 0) {
        tpsRing.push(summary.totalTps);
        setTpsHistoryVersion((v) => v + 1);
      }
    } catch {
      setInferenceHealth((prev) => ({ ...prev, loading: false, error: 'offline' }));
    }
  };

  const [agentActivity, setAgentActivity] = createSignal<AgentActivityState>({
    activeAgents: 0,
    totalTasks: 0,
    pendingApprovals: 0,
    loading: true,
    error: '',
  });
  const [agentLastUpdateMs, setAgentLastUpdateMs] = createSignal(0);

  const loomHUDPullEnabled = () => healthStore.features.loom_hud?.enabled ?? false;
  const loomHUDPushEnabled = () => healthStore.features.loom_hud_push?.enabled ?? false;
  const loomHUDAvailable = () => loomHUDPullEnabled() || loomHUDPushEnabled();

  const fetchAgentActivity = async () => {
    if (!loomHUDAvailable()) return;
    try {
      if (loomHUDPullEnabled()) {
        const data = await hudApi.fleet();
        const agents = data?.agents || [];
        const tasks = data?.tasks || [];
        const activeAgents = agents.filter((agent: any) => agent.status === 'active').length;
        const completedTasks = tasks.filter((task: any) => task.status === 'completed').length;
        const pendingApprovals = data?.kpis?.pending_approvals || 0;
        setAgentActivity({
          activeAgents,
          totalTasks: completedTasks,
          pendingApprovals,
          loading: false,
          error: '',
        });
        setAgentLastUpdateMs(Date.now());
        return;
      }

      const list = await agentsApi.list();
      const allAgents = list?.agents || [];
      const hudAgents = allAgents.filter(
        (agent: any) => agent?.metadata?.source === 'hud' || agent?.type === 'cli-agent',
      );
      const activeAgents = hudAgents.filter((agent: any) => {
        const presenceStatus = agent?.metadata?.presence_status;
        if (presenceStatus === 'active') return true;
        if (presenceStatus === 'idle' || presenceStatus === 'offline') return false;
        return agent?.status === 'healthy';
      }).length;
      const sessionsSeen = hudAgents.reduce((sum: number, agent: any) => {
        const count = Number(agent?.metadata?.session_count || 0);
        return Number.isFinite(count) ? sum + count : sum;
      }, 0);
      setAgentActivity({
        activeAgents,
        totalTasks: sessionsSeen,
        pendingApprovals: 0,
        loading: false,
        error: '',
      });
      setAgentLastUpdateMs(Date.now());
    } catch {
      setAgentActivity((prev) => ({ ...prev, loading: false, error: 'offline' }));
    }
  };

  createEffect(() => {
    if (loomHUDAvailable()) void fetchAgentActivity();
  });

  createPolling('dash-models', fetchModelCount, metricsRefreshInterval);
  createPolling(
    'dash-inference',
    fetchInferenceHealth,
    metricsRefreshInterval,
    () => healthStore.features.flexinfer_proxy?.enabled ?? false,
  );
  createPolling('dash-agents', fetchAgentActivity, metricsRefreshInterval, loomHUDAvailable);

  const resourceDataState = createMemo(() =>
    resolveDashboardDataState({
      loading: resourceLoading(),
      error: metricsStore.error || '',
      lastUpdateMs: metricsStore.lastUpdate,
      staleAfterMs,
    }),
  );
  const resourceCardError = createMemo(() =>
    resourceDataState() === 'offline' ? (metricsStore.error || 'offline') : '',
  );

  const modelDataState = createMemo(() =>
    resolveDashboardDataState({
      loading: modelCount().loading,
      error: modelCount().error,
      lastUpdateMs: modelLastUpdateMs(),
      staleAfterMs,
    }),
  );
  const modelCardError = createMemo(() =>
    modelDataState() === 'offline' ? (modelCount().error || 'offline') : '',
  );

  const inferenceFeatureEnabled = createMemo(
    () => healthStore.features.flexinfer_proxy?.enabled ?? false,
  );
  const inferenceDataState = createMemo(() => {
    if (!inferenceFeatureEnabled()) return 'offline' as const;
    return resolveDashboardDataState({
      loading: inferenceHealth().loading,
      error: inferenceHealth().error,
      lastUpdateMs: inferenceLastUpdateMs(),
      staleAfterMs,
    });
  });
  const inferenceCardError = createMemo(() => {
    if (!inferenceFeatureEnabled()) return '';
    return inferenceDataState() === 'offline'
      ? (inferenceHealth().error || 'offline')
      : '';
  });

  const agentFeatureEnabled = createMemo(() => loomHUDAvailable());
  const agentDataState = createMemo(() => {
    if (!agentFeatureEnabled()) return 'offline' as const;
    const resolved = resolveDashboardDataState({
      loading: agentActivity().loading,
      error: agentActivity().error,
      lastUpdateMs: agentLastUpdateMs(),
      staleAfterMs,
    });
    if (resolved === 'ready' && loomHUDPushEnabled() && !loomHUDPullEnabled()) {
      return 'partial' as const;
    }
    return resolved;
  });
  const agentCardError = createMemo(() => {
    if (!agentFeatureEnabled()) return '';
    return agentDataState() === 'offline' ? (agentActivity().error || 'offline') : '';
  });

  return {
    agentActivity,
    agentCardError,
    agentDataState,
    agentFeatureEnabled,
    cpuHistory,
    cpuPercent,
    inferenceCardError,
    inferenceDataState,
    inferenceFeatureEnabled,
    inferenceHealth,
    loomHUDPullEnabled,
    loomHUDPushEnabled,
    memHistory,
    memUsed,
    modelCardError,
    modelCount,
    modelDataState,
    resourceCardError,
    resourceDataState,
    resourceLoading,
    tpsHistory,
  };
}
