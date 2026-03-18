import { Component, createSignal, createEffect, createMemo, For, Show, onMount, onCleanup } from 'solid-js';
import type { ModelCache, ModelCachePhase, MCPhaseStatus } from '../../lib/types';
import { modelsApi } from '../../lib/api';

// Pipeline phase ordering for the stepper
const PHASE_ORDER: ModelCachePhase[] = [
  'Provisioning', 'Abliterating', 'Finetuning', 'Quantizing', 'Publishing', 'Ready',
];

const PipelinesTab: Component = () => {
  const [caches, setCaches] = createSignal<ModelCache[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal('');
  const [expandedRow, setExpandedRow] = createSignal<string | null>(null);

  const fetchCaches = async () => {
    try {
      const data = await modelsApi.cacheList();
      setCaches(data.caches || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pipelines');
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void fetchCaches();
  });

  // SSE live updates
  createEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(modelsApi.cacheWatchSSEUrl());
      es.addEventListener('modelcache', (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data);
          if (!event?.modelCache) return;
          const incoming = event.modelCache as ModelCache;
          setCaches((prev) => {
            const idx = prev.findIndex((c) => c.name === incoming.name && c.namespace === incoming.namespace);
            if (event.type === 'DELETED') {
              return idx >= 0 ? [...prev.slice(0, idx), ...prev.slice(idx + 1)] : prev;
            }
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = incoming;
              return updated;
            }
            return [...prev, incoming];
          });
        } catch {
          // ignore parse errors
        }
      });
      es.onerror = () => {
        es?.close();
      };
    } catch {
      // EventSource not supported
    }

    onCleanup(() => es?.close());
  });

  const summary = createMemo(() => {
    const counts = { total: 0, active: 0, ready: 0, failed: 0 };
    for (const c of caches()) {
      counts.total++;
      const phase = c.status?.phase;
      if (phase === 'Ready') counts.ready++;
      else if (phase === 'Failed') counts.failed++;
      else if (phase && phase !== 'Pending') counts.active++;
    }
    return counts;
  });

  const cacheKey = (c: ModelCache) => `${c.namespace}/${c.name}`;

  return (
    <div class="flex flex-col gap-4">
      <Show when={error()}>
        <div class="glass-panel p-4 text-sm text-status-error">{error()}</div>
      </Show>

      <Show when={loading() && caches().length === 0}>
        <div class="glass-panel flex items-center justify-center py-12">
          <div class="text-center">
            <div class="mb-4 text-4xl animate-pulse text-neon-purple">&#x2B21;</div>
            <p class="text-text-dim">Loading pipelines...</p>
          </div>
        </div>
      </Show>

      <Show when={!loading() && caches().length === 0 && !error()}>
        <div class="glass-panel flex items-center justify-center py-16">
          <div class="text-center">
            <div class="mb-4 text-6xl text-neon-purple/30">&#x2699;</div>
            <h3 class="mb-2 text-xl font-medium text-text-main">No Pipelines Found</h3>
            <p class="text-text-dim">Apply ModelCache CRDs to start processing pipelines.</p>
          </div>
        </div>
      </Show>

      <Show when={caches().length > 0}>
        {/* Summary Cards */}
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <SummaryCard label="Total" value={String(summary().total)} color="text-text-main" />
          <SummaryCard label="Active" value={String(summary().active)} color="text-neon-cyan" />
          <SummaryCard label="Ready" value={String(summary().ready)} color="text-status-ok" />
          <SummaryCard label="Failed" value={String(summary().failed)} color="text-status-error" />
        </div>

        {/* Pipeline Table */}
        <div class="glass-panel overflow-hidden">
          <div class="px-4 py-3 border-b border-white/5">
            <h3 class="text-sm font-medium text-text-main">Model Pipelines</h3>
          </div>
          <div class="divide-y divide-white/5">
            <For each={caches()}>
              {(cache) => (
                <PipelineRow
                  cache={cache}
                  expanded={expandedRow() === cacheKey(cache)}
                  onToggle={() => setExpandedRow(expandedRow() === cacheKey(cache) ? null : cacheKey(cache))}
                />
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};

// ─── Summary Card ───

const SummaryCard: Component<{ label: string; value: string; color: string }> = (props) => (
  <div class="glass-panel p-3">
    <div class="text-[10px] font-medium uppercase tracking-wider text-text-dim">{props.label}</div>
    <div class={`mt-1 text-xl font-mono font-medium ${props.color}`}>{props.value}</div>
  </div>
);

// ─── Pipeline Row ───

const PipelineRow: Component<{
  cache: ModelCache;
  expanded: boolean;
  onToggle: () => void;
}> = (props) => {
  const phase = () => props.cache.status?.phase || 'Pending';
  const activeProgress = () => getActivePhaseProgress(props.cache);
  const source = () => {
    const s = props.cache.spec.source;
    // Truncate long HuggingFace source URIs for display
    if (s.length > 50) return '...' + s.slice(-47);
    return s;
  };

  return (
    <div>
      {/* Main row */}
      <button
        class="w-full px-4 py-3 text-left hover:bg-white/5 transition-colors flex items-center gap-3"
        onClick={() => props.onToggle()}
      >
        {/* Expand indicator */}
        <span class={`text-text-dim text-xs transition-transform ${props.expanded ? 'rotate-90' : ''}`}>&#x25B6;</span>

        {/* Name + Namespace */}
        <div class="min-w-0 flex-1">
          <div class="font-medium text-sm text-text-main truncate">{props.cache.name}</div>
          <div class="text-[10px] font-mono text-text-dim">{props.cache.namespace}</div>
        </div>

        {/* Source */}
        <div class="hidden sm:block min-w-0 flex-1">
          <div class="text-xs font-mono text-text-dim truncate" title={props.cache.spec.source}>{source()}</div>
        </div>

        {/* Phase badge */}
        <div class={`rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap ${getPhaseClasses(phase())}`}>
          <span class={isActivePhase(phase()) ? 'animate-pulse' : ''}>{getPhaseIcon(phase())}</span>
          {' '}{phase()}
        </div>

        {/* Pipeline dots */}
        <div class="hidden md:flex items-center gap-1">
          <PipelineDots cache={props.cache} />
        </div>

        {/* Progress bar */}
        <div class="w-24 hidden lg:block">
          <Show when={activeProgress() !== null} fallback={
            <div class="h-1.5 rounded-full bg-white/5" />
          }>
            <div class="flex items-center gap-2">
              <div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  class={`h-full rounded-full transition-all duration-500 ${phase() === 'Failed' ? 'bg-status-error' : 'bg-neon-cyan'}`}
                  style={{ width: `${activeProgress()}%` }}
                />
              </div>
              <span class="text-[10px] font-mono text-text-dim w-8 text-right">{activeProgress()}%</span>
            </div>
          </Show>
        </div>
      </button>

      {/* Expanded detail */}
      <Show when={props.expanded}>
        <PipelineDetail cache={props.cache} />
      </Show>
    </div>
  );
};

// ─── Pipeline Dots (visual stepper) ───

const PipelineDots: Component<{ cache: ModelCache }> = (props) => {
  const steps = createMemo(() => getConfiguredSteps(props.cache));
  const currentPhase = () => props.cache.status?.phase || 'Pending';

  return (
    <div class="flex items-center gap-0.5">
      <For each={steps()}>
        {(step, i) => {
          const stepState = () => getStepState(step, currentPhase(), props.cache);
          return (
            <>
              <Show when={i() > 0}>
                <span class={`w-2 h-px ${stepState() === 'done' ? 'bg-status-ok/40' : 'bg-white/10'}`} />
              </Show>
              <span
                class={`w-2 h-2 rounded-full ${
                  stepState() === 'done' ? 'bg-status-ok' :
                  stepState() === 'active' ? 'bg-neon-cyan animate-pulse' :
                  stepState() === 'failed' ? 'bg-status-error' :
                  'bg-white/20'
                }`}
                title={step}
              />
            </>
          );
        }}
      </For>
    </div>
  );
};

// ─── Pipeline Detail (expanded view) ───

const PipelineDetail: Component<{ cache: ModelCache }> = (props) => {
  const steps = createMemo(() => getConfiguredSteps(props.cache));
  const currentPhase = () => props.cache.status?.phase || 'Pending';

  return (
    <div class="px-4 pb-4 pl-10 space-y-3">
      {/* Phase stepper */}
      <div class="glass-panel p-3">
        <div class="text-[10px] font-medium uppercase tracking-wider text-text-dim mb-2">Pipeline Progress</div>
        <div class="flex items-center gap-1 flex-wrap">
          <For each={steps()}>
            {(step, i) => {
              const state = () => getStepState(step, currentPhase(), props.cache);
              return (
                <>
                  <Show when={i() > 0}>
                    <span class={`w-4 h-px ${state() === 'done' ? 'bg-status-ok/40' : 'bg-white/10'}`} />
                  </Show>
                  <div class={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    state() === 'done' ? 'bg-status-ok/20 text-status-ok' :
                    state() === 'active' ? 'bg-neon-cyan/20 text-neon-cyan' :
                    state() === 'failed' ? 'bg-status-error/20 text-status-error' :
                    'bg-white/10 text-text-dim'
                  }`}>
                    <span>
                      {state() === 'done' ? '✓' : state() === 'active' ? '●' : state() === 'failed' ? '✕' : '○'}
                    </span>
                    {step}
                  </div>
                </>
              );
            }}
          </For>
        </div>
      </div>

      {/* Active phase progress */}
      <Show when={getActivePhaseStatus(props.cache)}>
        {(status) => (
          <div class="glass-panel p-3">
            <div class="text-[10px] font-medium uppercase tracking-wider text-neon-cyan mb-2">
              Current: {currentPhase()}
            </div>
            <Show when={status().progress != null}>
              <div class="flex items-center gap-3 mb-1">
                <div class="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                  <div
                    class="h-full rounded-full bg-neon-cyan transition-all duration-500"
                    style={{ width: `${status().progress}%` }}
                  />
                </div>
                <span class="text-sm font-mono text-neon-cyan">{status().progress}%</span>
              </div>
            </Show>
            <Show when={status().progressDetail}>
              <div class="text-xs text-text-muted font-mono">{status().progressDetail}</div>
            </Show>
            <Show when={status().startedAt}>
              <div class="text-[10px] text-text-dim mt-1">
                Started: {formatTimestamp(status().startedAt!)}
              </div>
            </Show>
          </div>
        )}
      </Show>

      {/* Failure message */}
      <Show when={currentPhase() === 'Failed'}>
        <div class="glass-panel p-3 border border-status-error/20">
          <div class="text-[10px] font-medium uppercase tracking-wider text-status-error mb-1">Failure</div>
          <div class="text-xs text-status-error font-mono">
            {getFailureMessage(props.cache) || 'Unknown error'}
          </div>
        </div>
      </Show>

      {/* Completed phase metrics */}
      <Show when={props.cache.status?.abliteration && hasCompletedMetrics(props.cache.status.abliteration)}>
        <PhaseMetricsCard
          title="Abliteration"
          entries={[
            { label: 'Layers Modified', value: String(props.cache.status!.abliteration!.layersModified ?? '-') },
            { label: 'Refusal Dir Norm', value: props.cache.status!.abliteration!.refusalDirNorm || '-' },
            { label: 'Duration', value: props.cache.status!.abliteration!.abliterationTime || '-' },
          ]}
        />
      </Show>

      <Show when={props.cache.status?.quantization && hasCompletedMetrics(props.cache.status.quantization)}>
        <PhaseMetricsCard
          title="Quantization"
          entries={[
            { label: 'Format', value: `${props.cache.status!.quantization!.format || '-'} ${props.cache.status!.quantization!.type || ''}`.trim() },
            { label: 'Compression', value: props.cache.status!.quantization!.compressionRatio ? `${props.cache.status!.quantization!.compressionRatio}x` : '-' },
            { label: 'Size', value: formatSizeDelta(props.cache.status!.quantization!.originalSizeBytes, props.cache.status!.quantization!.compressedSizeBytes) },
            { label: 'Duration', value: props.cache.status!.quantization!.quantizationTime || '-' },
          ]}
        />
      </Show>

      <Show when={props.cache.status?.finetune && hasCompletedMetrics(props.cache.status.finetune)}>
        <PhaseMetricsCard
          title="Finetune"
          entries={[
            { label: 'Train Loss', value: props.cache.status!.finetune!.trainLoss || '-' },
            { label: 'Throughput', value: props.cache.status!.finetune!.samplesPerSecond ? `${props.cache.status!.finetune!.samplesPerSecond} samples/s` : '-' },
            { label: 'Epochs', value: String(props.cache.status!.finetune!.epochsCompleted ?? '-') },
            { label: 'Duration', value: props.cache.status!.finetune!.finetuneTime || '-' },
          ]}
        />
      </Show>

      <Show when={props.cache.status?.publish && hasCompletedMetrics(props.cache.status.publish)}>
        <PhaseMetricsCard
          title="Publish"
          entries={[
            ...(props.cache.status!.publish!.ociDigest ? [{ label: 'OCI Digest', value: props.cache.status!.publish!.ociDigest.slice(0, 20) + '...' }] : []),
            ...(props.cache.status!.publish!.huggingFaceCommit ? [{ label: 'HF Commit', value: props.cache.status!.publish!.huggingFaceCommit.slice(0, 12) }] : []),
            ...(props.cache.status!.publish!.publishedAt ? [{ label: 'Published', value: formatTimestamp(props.cache.status!.publish!.publishedAt) }] : []),
          ]}
        />
      </Show>

      {/* Logs panel */}
      <Show when={isActivePhase(currentPhase())}>
        <LogsPanel namespace={props.cache.namespace} name={props.cache.name} />
      </Show>
    </div>
  );
};

// ─── Phase Metrics Card ───

const PhaseMetricsCard: Component<{
  title: string;
  entries: Array<{ label: string; value: string }>;
}> = (props) => (
  <div class="glass-panel p-3">
    <div class="text-[10px] font-medium uppercase tracking-wider text-status-ok mb-2">
      Completed: {props.title}
    </div>
    <div class="grid grid-cols-2 gap-x-4 gap-y-1">
      <For each={props.entries}>
        {(entry) => (
          <>
            <span class="text-xs text-text-dim">{entry.label}</span>
            <span class="text-xs font-mono text-text-muted text-right">{entry.value}</span>
          </>
        )}
      </For>
    </div>
  </div>
);

// ─── Logs Panel ───

const LogsPanel: Component<{ namespace: string; name: string }> = (props) => {
  const [logs, setLogs] = createSignal<string[]>([]);
  const [logError, setLogError] = createSignal('');
  const [connected, setConnected] = createSignal(false);
  let logContainerRef: HTMLDivElement | undefined;

  createEffect(() => {
    const url = modelsApi.cachePodLogsUrl(props.namespace, props.name);
    const es = new EventSource(url);

    es.addEventListener('ready', () => {
      setConnected(true);
    });

    es.addEventListener('log', (e: MessageEvent) => {
      setLogs((prev) => {
        const next = [...prev, e.data];
        // Keep last 500 lines
        return next.length > 500 ? next.slice(-500) : next;
      });
      // Auto-scroll
      requestAnimationFrame(() => {
        if (logContainerRef) {
          logContainerRef.scrollTop = logContainerRef.scrollHeight;
        }
      });
    });

    es.addEventListener('error', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setLogError(data.error || 'Log stream error');
      } catch {
        setLogError('Log stream disconnected');
      }
    });

    es.onerror = () => {
      es.close();
      if (!logError()) setLogError('Log stream disconnected');
    };

    onCleanup(() => es.close());
  });

  return (
    <div class="glass-panel overflow-hidden">
      <div class="px-3 py-2 border-b border-white/5 flex items-center justify-between">
        <div class="text-[10px] font-medium uppercase tracking-wider text-text-dim">Live Logs</div>
        <div class={`w-1.5 h-1.5 rounded-full ${connected() ? 'bg-status-ok' : 'bg-status-warn animate-pulse'}`} />
      </div>
      <Show when={logError()}>
        <div class="px-3 py-2 text-[10px] text-status-warn">{logError()}</div>
      </Show>
      <div
        ref={logContainerRef}
        class="max-h-48 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed text-text-muted bg-black/20"
      >
        <Show when={logs().length === 0 && !logError()}>
          <span class="text-text-dim">Waiting for logs...</span>
        </Show>
        <For each={logs()}>
          {(line) => <div class="whitespace-pre-wrap break-all">{line}</div>}
        </For>
      </div>
    </div>
  );
};

// ─── Helpers ───

function getConfiguredSteps(cache: ModelCache): string[] {
  const steps: string[] = ['Download'];
  if (cache.spec.abliteration) steps.push('Abliterate');
  if (cache.spec.finetune) steps.push('Finetune');
  if (cache.spec.quantization) steps.push('Quantize');
  if (cache.spec.publish) steps.push('Publish');
  steps.push('Ready');
  return steps;
}

type StepState = 'done' | 'active' | 'pending' | 'failed';

function getStepState(stepName: string, currentPhase: string, cache: ModelCache): StepState {
  const phaseMap: Record<string, ModelCachePhase> = {
    'Download': 'Provisioning',
    'Abliterate': 'Abliterating',
    'Finetune': 'Finetuning',
    'Quantize': 'Quantizing',
    'Publish': 'Publishing',
    'Ready': 'Ready',
  };

  const stepPhase = phaseMap[stepName];
  if (!stepPhase) return 'pending';

  if (currentPhase === 'Failed') {
    // Find which step failed — the step whose phase matches or comes after current
    const configuredSteps = getConfiguredSteps(cache);
    const stepIdx = configuredSteps.indexOf(stepName);
    const failedIdx = configuredSteps.findIndex((s) => phaseMap[s] === getLastActivePhase(cache));
    if (stepIdx < failedIdx) return 'done';
    if (stepIdx === failedIdx) return 'failed';
    return 'pending';
  }

  const stepOrder = PHASE_ORDER.indexOf(stepPhase);
  const currentOrder = PHASE_ORDER.indexOf(currentPhase as ModelCachePhase);

  if (currentPhase === 'Pending' || currentPhase === 'Initializing') return 'pending';
  if (stepPhase === currentPhase) return 'active';
  if (stepOrder < currentOrder) return 'done';
  return 'pending';
}

function getLastActivePhase(cache: ModelCache): ModelCachePhase {
  // Walk backward through status to find which phase has status data
  if (cache.status?.publish?.startedAt) return 'Publishing';
  if (cache.status?.quantization?.startedAt) return 'Quantizing';
  if (cache.status?.finetune?.startedAt) return 'Finetuning';
  if (cache.status?.abliteration?.startedAt) return 'Abliterating';
  return 'Provisioning';
}

function getActivePhaseStatus(cache: ModelCache): MCPhaseStatus | null {
  const phase = cache.status?.phase;
  if (phase === 'Abliterating') return cache.status?.abliteration || null;
  if (phase === 'Quantizing') return cache.status?.quantization || null;
  if (phase === 'Finetuning') return cache.status?.finetune || null;
  if (phase === 'Publishing') return cache.status?.publish || null;
  return null;
}

function getActivePhaseProgress(cache: ModelCache): number | null {
  const status = getActivePhaseStatus(cache);
  return status?.progress ?? null;
}

function getFailureMessage(cache: ModelCache): string | null {
  // Check each phase for failure messages in reverse pipeline order
  const phases = [cache.status?.publish, cache.status?.quantization, cache.status?.finetune, cache.status?.abliteration];
  for (const p of phases) {
    if (p?.failureMessage) return p.failureMessage;
  }
  // Check conditions
  const failedCondition = cache.status?.conditions?.find((c) => c.status === 'False' && c.message);
  return failedCondition?.message || null;
}

function hasCompletedMetrics(status: MCPhaseStatus | undefined): boolean {
  if (!status) return false;
  // Has at least some real data (not just progress tracking)
  return status.startedAt != null && status.progress == null;
}

function isActivePhase(phase: string): boolean {
  return ['Provisioning', 'Abliterating', 'Finetuning', 'Quantizing', 'Publishing', 'Initializing'].includes(phase);
}

function getPhaseClasses(phase: string): string {
  switch (phase) {
    case 'Ready': return 'bg-status-ok/20 text-status-ok';
    case 'Provisioning': case 'Abliterating': case 'Finetuning':
    case 'Quantizing': case 'Publishing': case 'Initializing':
      return 'bg-neon-cyan/20 text-neon-cyan';
    case 'Pending': return 'bg-status-warn/20 text-status-warn';
    case 'Failed': return 'bg-status-error/20 text-status-error';
    default: return 'bg-white/10 text-text-dim';
  }
}

function getPhaseIcon(phase: string): string {
  switch (phase) {
    case 'Ready': return '●';
    case 'Provisioning': case 'Abliterating': case 'Finetuning':
    case 'Quantizing': case 'Publishing': case 'Initializing':
      return '◐';
    case 'Pending': return '◔';
    case 'Failed': return '✕';
    default: return '?';
  }
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

function formatSizeDelta(original?: number, compressed?: number): string {
  if (!original || !compressed) return '-';
  const fmt = (b: number) => {
    if (b >= 1e9) return `${(b / 1e9).toFixed(1)}GB`;
    if (b >= 1e6) return `${(b / 1e6).toFixed(0)}MB`;
    return `${b}B`;
  };
  return `${fmt(original)} → ${fmt(compressed)}`;
}

export default PipelinesTab;
