// FlexInfer Model CRD types (flexinfer.ai/v1alpha2)
export type ModelPhase =
  | "Idle"
  | "Pending"
  | "Loading"
  | "Ready"
  | "Preempted"
  | "Failed";

export interface FlexInferModel {
  name: string;
  namespace: string;
  creationTimestamp: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  spec: FlexInferModelSpec;
  status: FlexInferModelStatus;
}

export interface FlexInferModelSpec {
  backend: string;
  source: string;
  gpu?: {
    vendor?: string;
    shared?: string;
    priority?: number;
    count?: number;
    vramEstimateMB?: number;
    swapCooldown?: string;
  };
  serverless?: {
    enabled?: boolean;
    minReplicas?: number;
    idleTimeout?: string;
    coldStartTimeout?: string;
  };
  config?: Record<string, unknown>;
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
  nodeSelector?: Record<string, string>;
  tolerations?: Array<{
    key?: string;
    operator?: string;
    value?: string;
    effect?: string;
    tolerationSeconds?: number;
  }>;
  cache?: {
    strategy?: string;
    pvcName?: string;
    storageClass?: string;
    size?: string;
    hostPath?: string;
    compilationCache?: {
      enabled?: boolean;
      hostPath?: string;
      sizeLimit?: string;
    };
    flashLoader?: {
      enabled?: boolean;
      concurrency?: number;
      tmpfsSizeLimit?: string;
      bufferSizeKB?: number;
      verifyIntegrity?: boolean;
      image?: string;
    };
  };
  litellm?: {
    enabled?: boolean;
    servedModelName?: string;
    aliases?: string[];
    copilotAlias?: string;
  };
  serviceLabels?: string[];
  kvCache?: {
    pressurePolicy?: string;
    highWatermark?: string;
    lowWatermark?: string;
    maxBlockSize?: number;
    swapSpace?: string;
    reconfigureCooldown?: string;
  };
  capabilities?: {
    toolCalling?: boolean;
    vision?: boolean;
    imageGeneration?: boolean;
  };
  quantize?: {
    format?: string;
    ggufType?: string;
    bits?: number;
    groupSize?: number;
    useGPU?: boolean;
    maxMemoryGB?: number;
    timeoutSeconds?: number;
    sym?: boolean;
    descAct?: boolean;
    calibration?: {
      maxSeqLen?: number;
      maxSamples?: number;
      nParallelCalibSamples?: number;
      dataset?: string;
    };
    gpuMemoryFraction?: string;
    dynamicExclusion?: string;
    nodeSelector?: Record<string, string>;
  };
}

export interface FlexInferModelStatus {
  phase?: ModelPhase;
  /**
   * Refines phase=Loading with granular progress:
   * ImagePulling / Initializing / LoadingWeights / Compiling / HealthCheckPending.
   * Empty outside of Loading.
   */
  loadingSubstage?:
    | 'ImagePulling'
    | 'Initializing'
    | 'LoadingWeights'
    | 'Compiling'
    | 'HealthCheckPending'
    | '';
  /**
   * One-line status summary. During Loading this carries the most informative
   * progress hint (e.g. "loading weights (31/34 shards, 141.75s/it)").
   */
  message?: string;
  /**
   * Wall-clock timestamp of the last substage/message change. Used by the
   * proxy to detect stalled loads; the UI reads it to color-code stalls.
   */
  loadingProgressAt?: string;
  conditions?: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
    lastTransitionTime?: string;
  }>;
  gpu?: {
    node?: string;
    device?: string;
    vendor?: string;
    architecture?: string;
    memoryMB?: number;
  };
  endpoint?: string;
  lastActiveTime?: string;
  metrics?: {
    tokensPerSecond?: string;
    loadTimeSeconds?: string;
    avgLatencyMs?: string;
  };
  sharedGroup?: {
    groupName?: string;
    state?: string;
    queuePosition?: number;
    preemptedBy?: string;
    preemptedAt?: string;
  };
  cache?: {
    strategy?: string;
    ready?: boolean;
    pvcName?: string;
    jobName?: string;
    jobPhase?: string;
    message?: string;
    sizeBytes?: number;
    quantization?: {
      format?: string;
      type?: string;
      originalSizeBytes?: number;
      compressedSizeBytes?: number;
      compressionRatio?: string;
      quantizationTime?: string;
      startedAt?: string;
      completedAt?: string;
      calibrationParams?: {
        maxSeqLen?: number;
        maxSamples?: number;
        nParallelCalibSamples?: number;
        dataset?: string;
      };
      progress?: number;
      progressDetail?: string;
      failureMessage?: string;
    };
  };
  kvCache?: {
    utilization?: string;
    pressure?: boolean;
    lastPressureTime?: string;
    lastAction?: string;
    reconfigured?: boolean;
    reconfiguredAt?: string;
    originalMaxNumSeqs?: number;
    reconfiguredMaxNumSeqs?: number;
    evicted?: boolean;
    evictedAt?: string;
  };
}

export interface FlexInferModelListResponse {
  models: FlexInferModel[];
  namespace: string;
  count: number;
}

// GPU Swap History types (Phase 3: GPU Sharing State / group contention)
export interface GPUSwapEvent {
  ts: string;
  model: string;
  ns: string;
  group: string;
  oldState: string;
  newState: string;
  preemptedBy?: string;
  durationSec?: number;
}

export interface SwapHistoryResponse {
  events: GPUSwapEvent[];
  model: string;
  namespace: string;
}

// FlexInfer Inference Metrics (Phase 3)
export interface InferenceMetrics {
  model: string;
  observed?: boolean;
  tps: number | null;
  requestsPerSec?: number | null;
  p95LatencyMs: number | null;
  queueDepth: number | null;
  activeConnections: number | null;
  errorRate: number | null;
  queueWaitP95Ms: number | null;
  rejectedRequestsPerSec: number | null;
  scaleUps5m: number | null;
  activationRetries5m: number | null;
  coldStartP95Ms: number | null;
  idleSeconds: number | null;
  partial?: boolean;
  missingMetrics?: string[];
}

export interface FlexInferProxyModelMetrics {
  requestsTotal: number;
  errorsTotal: number;
  queueDepth: number;
  activeConnections: number;
  scaleUps: number;
  queueRejectedTotal: number;
  queuedRequestsTotal: number;
  gpuGroupSwapSignalsTotal?: number;
  gpuGroupQueuedRequestsTotal?: number;
  endpointChangesTotal?: number;
  endpointCount?: number;
  routingDecisionsTotal?: number;
  routingTargetHitsTotal?: number;
  routingKeyCardinality?: number;
  routingKeyCardinalityOverflowTotal?: number;
  rateLimitedTotal?: number;
  activationRetriesTotal?: number;
  activationFailuresTotal?: number;
  // Latency percentiles derived from the proxy request-duration histogram.
  // Present only when the model has histogram data this scrape (ms).
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  latencyP99Ms?: number;
  latencyAvgMs?: number;
}

export interface FlexInferProxyTotals {
  modelCount: number;
  requestsTotal: number;
  errorsTotal: number;
  queueDepth: number;
  activeConnections: number;
  scaleUps: number;
  queueRejectedTotal: number;
  queuedRequestsTotal: number;
  gpuGroupSwapSignalsTotal?: number;
  gpuGroupQueuedRequestsTotal?: number;
  endpointChangesTotal?: number;
  endpointCount?: number;
  routingDecisionsTotal?: number;
  routingTargetHitsTotal?: number;
  routingKeyCardinality?: number;
  routingKeyCardinalityOverflowTotal?: number;
  rateLimitedTotal?: number;
  activationRetriesTotal?: number;
  activationFailuresTotal?: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  latencyP99Ms?: number;
  latencyAvgMs?: number;
  errorRate: number;
  parseErrors: number;
}

export interface FlexInferProxyMetricsResponse {
  // Legacy response keys retained for compatibility.
  requests: Record<string, number>;
  latency: Record<string, number>;
  queue_depth: Record<string, number>;
  active_conn: Record<string, number>;
  scale_ups: Record<string, number>;
  // Normalized keys.
  byModel: Record<string, FlexInferProxyModelMetrics>;
  totals: FlexInferProxyTotals;
  requestsByStatus: Record<string, Record<string, number>>;
  partial: boolean;
}

export interface LoRAAdapter {
  name: string;
  namespace: string;
  modelRef: string;
  state: "Pending" | "Loaded" | "Unloading";
  adapterSource: string;
}

export interface ModelCatalogEntry {
  name: string;
  namespace: string;
  source: string;
  models: Array<{ name: string; size?: string; tags?: string[] }>;
  lastSyncTime: string;
}
