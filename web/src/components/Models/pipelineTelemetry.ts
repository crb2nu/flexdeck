export interface PipelineStructuredEvent {
  event: string;
  phase?: string;
  percent?: number;
  detail?: string;
  rss_mb?: number;
  gpu_mem_mb?: number;
  fla?: boolean;
  causal_conv1d?: boolean;
  psutil?: boolean;
  layers_modified?: number;
}

export interface PipelineCheckpointState {
  stage?: string;
  completedLayers?: number;
  notes: string[];
}

export interface PipelineTelemetryState {
  latestEvent: PipelineStructuredEvent | null;
  latestProgress: PipelineStructuredEvent | null;
  latestSnapshot: PipelineStructuredEvent | null;
  runtimeCapabilities: PipelineStructuredEvent | null;
  checkpoint: PipelineCheckpointState;
  observedStages: string[];
}

export interface PipelineTimelineStep {
  key: string;
  label: string;
  state: 'done' | 'active' | 'pending';
  detail?: string;
}

const ABLITERATION_STAGE_ORDER = [
  'starting',
  'loaded_model',
  'harmful_activations',
  'harmless_activations',
  'refusal_directions',
  'layers_abliterated',
  'validating',
  'saving',
  'complete',
] as const;

const QUANTIZATION_STAGE_ORDER = [
  'starting',
  'loaded_model',
  'calibration',
  'quantizing',
  'saving',
  'complete',
] as const;

type PipelineStageKey = (typeof ABLITERATION_STAGE_ORDER)[number] | (typeof QUANTIZATION_STAGE_ORDER)[number];

const STAGE_LABELS: Record<string, string> = {
  starting: 'Starting',
  loaded_model: 'Model loaded',
  harmful_activations: 'Harmful activations',
  harmless_activations: 'Harmless activations',
  refusal_directions: 'Refusal directions',
  layers_abliterated: 'Apply weights',
  validating: 'Validate',
  calibration: 'Calibration',
  quantizing: 'Quantize',
  saving: 'Save',
  complete: 'Complete',
};

export function createPipelineTelemetryState(): PipelineTelemetryState {
  return {
    latestEvent: null,
    latestProgress: null,
    latestSnapshot: null,
    runtimeCapabilities: null,
    checkpoint: { notes: [] },
    observedStages: [],
  };
}

export function applyPipelineLogLine(
  state: PipelineTelemetryState,
  line: string,
): PipelineTelemetryState {
  const next: PipelineTelemetryState = {
    latestEvent: state.latestEvent,
    latestProgress: state.latestProgress,
    latestSnapshot: state.latestSnapshot,
    runtimeCapabilities: state.runtimeCapabilities,
    checkpoint: {
      stage: state.checkpoint.stage,
      completedLayers: state.checkpoint.completedLayers,
      notes: [...state.checkpoint.notes],
    },
    observedStages: [...state.observedStages],
  };

  const structured = parseStructuredPipelineEvent(line);
  if (structured) {
    next.latestEvent = structured;
    if (structured.event === 'progress' || structured.event === 'start' || structured.event === 'complete' || structured.event === 'error') {
      next.latestProgress = structured;
    }
    if (structured.event === 'snapshot') {
      next.latestSnapshot = structured;
      if (structured.phase && structured.phase.includes('resumed')) {
        next.checkpoint.notes = appendUniqueNote(
          next.checkpoint.notes,
          humanizePhase(structured.phase),
        );
      }
    }
    if (structured.event === 'runtime_capabilities') {
      next.runtimeCapabilities = structured;
    }
    const structuredStage = recordStructuredStage(next, structured);
    if (structuredStage) {
      next.checkpoint.stage = structuredStage;
    }
    return next;
  }

  const quantCheckpoint = parseQuantCheckpointState(line);
  if (quantCheckpoint) {
    next.checkpoint.stage = quantCheckpoint.stage;
    next.checkpoint.completedLayers = quantCheckpoint.completedLayers;
    recordStage(next, quantCheckpoint.stage);
    return next;
  }

  const resumeNote = parseResumeCheckpointNote(line);
  if (resumeNote) {
    next.checkpoint.notes = appendUniqueNote(next.checkpoint.notes, resumeNote);
  }

  return next;
}

export function hasPipelineTelemetry(
  state: PipelineTelemetryState,
): boolean {
  return (
    state.latestEvent != null ||
    state.latestSnapshot != null ||
    state.runtimeCapabilities != null ||
    state.checkpoint.stage != null ||
    state.checkpoint.notes.length > 0
  );
}

export function humanizePhase(value: string): string {
  return value.replace(/[_-]+/g, ' ').trim();
}

export function getPipelineTimeline(
  state: PipelineTelemetryState,
  phase: string,
): PipelineTimelineStep[] {
  const stageOrder: readonly PipelineStageKey[] =
    phase === 'Abliterating' ? ABLITERATION_STAGE_ORDER :
    phase === 'Quantizing' ? QUANTIZATION_STAGE_ORDER :
    [];
  if (stageOrder.length === 0) return [];

  const currentStage = inferCurrentStage(state, phase);
  const currentIndex = currentStage ? stageOrder.indexOf(currentStage) : -1;
  const observedStages = new Set(state.observedStages);
  const activeDetail = currentStage ? getActiveStageDetail(state, currentStage) : undefined;

  return stageOrder.map((stageKey, index) => {
    let stepState: PipelineTimelineStep['state'] = 'pending';

    if (currentIndex >= 0) {
      if (index < currentIndex || observedStages.has(stageKey) && stageKey === 'complete') {
        stepState = 'done';
      }
      if (index === currentIndex) {
        stepState = currentStage === 'complete' ? 'done' : 'active';
      }
    } else if (observedStages.has(stageKey)) {
      stepState = 'done';
    }

    return {
      key: stageKey,
      label: STAGE_LABELS[stageKey] || humanizePhase(stageKey),
      state: stepState,
      detail: stepState === 'active' ? activeDetail : undefined,
    };
  });
}

function parseStructuredPipelineEvent(
  line: string,
): PipelineStructuredEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(trimmed) as PipelineStructuredEvent;
    if (!parsed || typeof parsed.event !== 'string' || parsed.event.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseQuantCheckpointState(
  line: string,
): { stage: string; completedLayers?: number } | null {
  const match = line.match(
    /Loaded quantization checkpoint state:\s+stage=([a-zA-Z0-9_-]+)\s+completed_layers=(\d+)/,
  );
  if (!match) return null;

  return {
    stage: match[1],
    completedLayers: Number.parseInt(match[2], 10),
  };
}

function parseResumeCheckpointNote(line: string): string | null {
  const match = line.match(/Resumed (.+) from checkpoint/i);
  if (!match) return null;
  return match[1].trim();
}

function appendUniqueNote(notes: string[], value: string): string[] {
  if (!value) return notes;
  if (notes.includes(value)) return notes;
  const next = [...notes, value];
  return next.slice(-4);
}

function recordStructuredStage(
  state: PipelineTelemetryState,
  event: PipelineStructuredEvent,
): PipelineStageKey | null {
  const stage = inferStructuredStage(event);
  if (stage) {
    recordStage(state, stage);
  }
  return stage;
}

function recordStage(state: PipelineTelemetryState, rawStage: string): void {
  const stage = normalizeStage(rawStage);
  if (!stage) return;
  if (state.observedStages.includes(stage)) return;
  state.observedStages = [...state.observedStages, stage];
}

function inferStructuredStage(event: PipelineStructuredEvent): PipelineStageKey | null {
  if (event.event === 'runtime_capabilities') return 'starting';
  if (event.event === 'complete') return 'complete';

  const detailStage = inferStageFromDetail(event.detail);
  if (detailStage) return detailStage;

  const normalizedPhase = normalizeStage(event.phase);
  if (normalizedPhase) return normalizedPhase;
  return null;
}

function inferCurrentStage(
  state: PipelineTelemetryState,
  phase: string,
): PipelineStageKey | null {
  const candidates: Array<PipelineStageKey | null> = [
    normalizeStage(state.checkpoint.stage),
    normalizeStage(state.latestSnapshot?.phase),
    state.latestProgress ? inferStructuredStage(state.latestProgress) : null,
    phase === 'Abliterating' ? 'starting' : null,
    phase === 'Quantizing' ? 'starting' : null,
  ];

  for (const candidate of candidates) {
    if (candidate) return candidate;
  }

  return null;
}

function getActiveStageDetail(
  state: PipelineTelemetryState,
  stage: string,
): string | undefined {
  const detail = state.latestProgress?.detail?.trim();
  if (!detail) return undefined;

  const detailStage = inferStageFromDetail(detail);
  if (!detailStage || detailStage === stage) {
    return detail;
  }
  if (stage === 'saving' && state.latestProgress?.phase === 'saving') {
    return detail;
  }

  return undefined;
}

function normalizeStage(value: string | null | undefined): PipelineStageKey | null {
  if (!value) return null;

  switch (value) {
    case 'quantizing':
    case 'saving':
    case 'validating':
    case 'starting':
    case 'loaded_model':
    case 'layers_abliterated':
    case 'complete':
    case 'calibration_ready':
      return value === 'calibration_ready' ? 'calibration' : value;
    case 'abliterating':
      return null;
    case 'harmful_activations':
    case 'harmful_activations_complete':
    case 'harmful_activations_resumed':
      return 'harmful_activations';
    case 'harmless_activations':
    case 'harmless_activations_complete':
    case 'harmless_activations_resumed':
      return 'harmless_activations';
    case 'refusal_directions_ready':
    case 'refusal_directions_computed':
    case 'refusal_directions_resumed':
      return 'refusal_directions';
    case 'saving_prepare':
    case 'saving_inplace_prepare':
    case 'saving_state_dict_materialized':
    case 'saving_stream_complete':
    case 'saving_stream_shard_written':
    case 'saved_staging':
      return 'saving';
    case 'loaded_cached_calibration_data':
      return 'calibration';
    default:
      return inferStageFromDetail(value);
  }
}

function inferStageFromDetail(detail: string | null | undefined): PipelineStageKey | null {
  const value = detail?.trim().toLowerCase();
  if (!value) return null;
  if (value.includes('model loaded') || value.includes('loading shard')) return 'loaded_model';
  if (value.includes('harmful activations')) return 'harmful_activations';
  if (value.includes('harmless activations')) return 'harmless_activations';
  if (value.includes('refusal directions')) return 'refusal_directions';
  if (value.includes('orthogonalizing weights')) return 'layers_abliterated';
  if (value.includes('perplexity')) return 'validating';
  if (value.includes('calibration data') || value.includes('calibration')) return 'calibration';
  if (value.includes('layer ') || value.includes('completed layer')) return 'quantizing';
  if (value.includes('saving') || value.includes('promoting output directory') || value.includes('save policy')) {
    return 'saving';
  }
  return null;
}
