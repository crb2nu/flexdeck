// K8s types (simplified from full K8s API types)
export interface K8sMetadata {
  name: string;
  namespace?: string;
  uid?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
}

export interface K8sCondition {
  type: string;
  status: "True" | "False" | "Unknown";
  lastTransitionTime?: string;
  reason?: string;
  message?: string;
}

export interface K8sNode {
  metadata: K8sMetadata;
  status: {
    conditions: K8sCondition[];
    capacity?: Record<string, string>;
    allocatable?: Record<string, string>;
  };
}

export interface K8sPod {
  metadata: K8sMetadata;
  spec: {
    nodeName?: string;
    containers: Array<{
      name: string;
      image: string;
    }>;
  };
  status: {
    phase: "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";
    conditions?: K8sCondition[];
    containerStatuses?: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
    }>;
  };
}

export interface K8sService {
  metadata: K8sMetadata;
  spec: {
    type: "ClusterIP" | "NodePort" | "LoadBalancer" | "ExternalName";
    clusterIP?: string;
    ports?: Array<{
      name?: string;
      port: number;
      targetPort: number | string;
      protocol: string;
    }>;
    selector?: Record<string, string>;
  };
  status?: {
    loadBalancer?: {
      ingress?: Array<{ ip?: string; hostname?: string }>;
    };
  };
}

export interface K8sDeployment {
  metadata: K8sMetadata;
  spec: {
    replicas: number;
    selector: {
      matchLabels: Record<string, string>;
    };
    template: {
      spec: {
        containers: Array<{
          name: string;
          image: string;
        }>;
      };
    };
  };
  status: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    updatedReplicas?: number;
  };
}

export interface K8sIngress {
  metadata: K8sMetadata;
  spec: {
    ingressClassName?: string;
    tls?: Array<{
      hosts: string[];
      secretName: string;
    }>;
    rules?: Array<{
      host?: string;
      http?: {
        paths: Array<{
          path: string;
          pathType: string;
          backend: {
            service: {
              name: string;
              port: { number?: number; name?: string };
            };
          };
        }>;
      };
    }>;
  };
}

export interface K8sList<T> {
  items: T[];
  metadata?: {
    continue?: string;
    resourceVersion?: string;
  };
}

// StatefulSet type
export interface K8sStatefulSet {
  metadata: K8sMetadata;
  spec: {
    replicas: number;
    serviceName: string;
    selector: {
      matchLabels: Record<string, string>;
    };
    template: {
      spec: {
        containers: Array<{
          name: string;
          image: string;
        }>;
      };
    };
    volumeClaimTemplates?: Array<{
      metadata: { name: string };
      spec: {
        accessModes: string[];
        resources: { requests: { storage: string } };
      };
    }>;
  };
  status: {
    replicas?: number;
    readyReplicas?: number;
    currentReplicas?: number;
    updatedReplicas?: number;
    currentRevision?: string;
    updateRevision?: string;
  };
}

// DaemonSet type
export interface K8sDaemonSet {
  metadata: K8sMetadata;
  spec: {
    selector: {
      matchLabels: Record<string, string>;
    };
    template: {
      spec: {
        containers: Array<{
          name: string;
          image: string;
        }>;
      };
    };
    updateStrategy?: {
      type: "RollingUpdate" | "OnDelete";
      rollingUpdate?: {
        maxUnavailable?: number | string;
      };
    };
  };
  status: {
    currentNumberScheduled: number;
    desiredNumberScheduled: number;
    numberReady: number;
    numberAvailable?: number;
    numberMisscheduled?: number;
    updatedNumberScheduled?: number;
  };
}

// Job type
export interface K8sJob {
  metadata: K8sMetadata;
  spec: {
    parallelism?: number;
    completions?: number;
    backoffLimit?: number;
    activeDeadlineSeconds?: number;
    ttlSecondsAfterFinished?: number;
    template: {
      spec: {
        containers: Array<{
          name: string;
          image: string;
        }>;
        restartPolicy: "Never" | "OnFailure";
      };
    };
  };
  status: {
    conditions?: K8sCondition[];
    startTime?: string;
    completionTime?: string;
    active?: number;
    succeeded?: number;
    failed?: number;
  };
}

// CronJob type
export interface K8sCronJob {
  metadata: K8sMetadata;
  spec: {
    schedule: string;
    concurrencyPolicy?: "Allow" | "Forbid" | "Replace";
    suspend?: boolean;
    successfulJobsHistoryLimit?: number;
    failedJobsHistoryLimit?: number;
    jobTemplate: {
      spec: K8sJob["spec"];
    };
  };
  status: {
    active?: Array<{ name: string; namespace: string }>;
    lastScheduleTime?: string;
    lastSuccessfulTime?: string;
  };
}

// Dashboard types
export interface PulseData {
  loading: boolean;
  error: string;
}

export interface PodPulse extends PulseData {
  ready: number;
  total: number;
  namespaces: number;
}

export interface NodePulse extends PulseData {
  ready: number;
  total: number;
}

export interface ResourcePulse extends PulseData {
  cpuPercent: number;
  memUsed: number;
  memTotal: number;
}

// Topology graph types
export interface TopologyNode {
  id: string;
  type: "node" | "pod" | "service";
  label: string;
  status: "ok" | "warn" | "error";
  data: K8sNode | K8sPod | K8sService;
}

export interface TopologyLink {
  source: string;
  target: string;
  type: "hosts" | "selects";
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  links: TopologyLink[];
}

// LiteLLM Metrics types
export interface ModelThroughput {
  model: string;
  tok_per_sec_1m: number;
  tok_per_sec_5m: number;
  tok_per_sec_15m: number;
  output_tok_per_sec: number;
  requests_per_min: number;
  avg_latency_ms: number;
  sparkline: number[];
  trend: "up" | "down" | "stable";
  last_updated: string;
}

export interface LiteLLMMetricsResponse {
  models: ModelThroughput[];
}

export interface LiteLLMHealthResponse {
  healthy: boolean;
  disabled?: boolean;
  error?: string;
}

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

// ModelCache Pipeline types (ai.flexinfer/v1alpha1)
export type ModelCachePhase =
  | "Pending" | "Initializing" | "Provisioning"
  | "Abliterating" | "Finetuning" | "Quantizing"
  | "Publishing" | "Ready" | "Failed";

export interface ModelCache {
  name: string;
  namespace: string;
  creationTimestamp: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  spec: ModelCacheSpec;
  status: ModelCacheStatus;
}

export interface ModelCacheSpec {
  source: string;
  storageStrategy?: string;
  storageSize?: string;
  existingClaimName?: string;
  abliteration?: { targetLayers?: string; weightMatrices?: string[]; numSamples?: number; useGPU?: boolean; timeoutSeconds?: number };
  quantization?: { format: string; ggufType?: string; bits?: number; groupSize?: number; useGPU?: boolean; timeoutSeconds?: number };
  finetune?: { mode?: string; dataset: { huggingFace?: string; pvcName?: string; split?: string; maxSamples?: number }; lora?: { rank?: number; alpha?: number; dropout?: string }; epochs?: number; batchSize?: number; learningRate?: string; maxSeqLen?: number };
  publish?: { targets: string[]; ociRef?: string; huggingFaceRepo?: string };
  download?: { maxMemoryGB?: number; hfTransfer?: boolean; backoffLimit?: number };
}

export interface ModelCacheStatus {
  phase?: ModelCachePhase;
  path?: string;
  sizeBytes?: string;
  conditions?: Array<{ type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string }>;
  quantization?: MCPhaseStatus & { format?: string; type?: string; originalSizeBytes?: number; compressedSizeBytes?: number; compressionRatio?: string; quantizationTime?: string };
  abliteration?: MCPhaseStatus & { layersModified?: number; refusalDirNorm?: string; abliterationTime?: string };
  finetune?: MCPhaseStatus & { trainLoss?: string; samplesPerSecond?: string; epochsCompleted?: number; totalSteps?: number; finetuneTime?: string };
  publish?: MCPhaseStatus & { ociDigest?: string; huggingFaceCommit?: string; publishedAt?: string };
}

export interface MCPhaseStatus {
  progress?: number;
  progressDetail?: string;
  startedAt?: string;
  failureMessage?: string;
}

export interface ModelCacheListResponse {
  caches: ModelCache[];
  namespace: string;
  count: number;
}

export interface GroupSwapHistoryResponse {
  events: GPUSwapEvent[];
  group: string;
  models: string[];
  summary: GroupSwapSummary;
}

export interface GroupSwapSummary {
  totalSwaps: number;
  avgQueueWaitSec: number;
  modelStats: Record<string, ModelSwapStats>;
}

export interface ModelSwapStats {
  swapCount: number;
  totalActiveSec: number;
  totalQueuedSec: number;
}

// Model Management types
export type ModelSource = "huggingface" | "civitai" | "local";
export type ModelType = "llm" | "diffusion" | "embedding" | "other";
export type DownloadStatus = "pending" | "downloading" | "completed" | "failed";
export type DeploymentStatus =
  | "none"
  | "pending"
  | "deployed"
  | "stopped"
  | "failed";

export interface RegisteredModel {
  id: string;
  name: string;
  source: ModelSource;
  source_id: string;
  source_url: string;
  type: ModelType;
  description: string;
  tags: string[];
  size: number;
  local_path: string;

  // Download tracking
  download_status: DownloadStatus;
  download_progress: number;
  download_error?: string;
  downloaded_at?: string;

  // Deployment tracking
  deployment_status: DeploymentStatus;
  deployment_name?: string;
  deployment_ns?: string;
  replicas: number;

  // Metadata
  created_at: string;
  updated_at: string;
  metadata?: Record<string, any>;
}

export interface DownloadProgress {
  model_id: string;
  file_name: string;
  total_bytes: number;
  downloaded: number;
  percent: number;
  bytes_per_sec: number;
  status: "downloading" | "completed" | "failed";
  error?: string;
}

export interface DeploymentConfig {
  name: string;
  namespace: string;
  replicas: number;
  image: string;
  model_path: string;
  gpu_count: number;
  gpu_type: string;
  max_model_len: number;
  tensor_parallel: number;
  port: number;
  env?: Record<string, string>;
}

export interface ModelSearchResult {
  models: RegisteredModel[];
  count: number;
}

// Agent types
export type AgentType = "langgraph" | "custom" | "cli-agent";
export type AgentStatus = "unknown" | "healthy" | "unhealthy";

export interface Agent {
  id: string;
  name: string;
  description: string;
  type: AgentType;
  url: string;
  api_key?: string;
  model?: string;
  tags: string[];
  metadata?: Record<string, any>;
  status: AgentStatus;
  last_checked?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentNode {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  tags: string[];
  metadata?: Record<string, any>;
}

export interface AgentEdge {
  source: string;
  target: string;
}

export interface AgentGraphResponse {
  nodes: AgentNode[];
  edges: AgentEdge[];
}

export interface AgentUsage {
  agent_id: string;
  request_count: number;
  total_tokens: number;
  total_latency_ms: number;
  last_used: string;
}

export interface AgentSession {
  id: string;
  agent_id: string;
  namespace?: string;
  started_at: string;
  ended_at?: string;
  status: string;
  description?: string;
  entry_count?: number;
  total_tokens?: number;
}

export interface InvokeRequest {
  input: Record<string, any>;
  config?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface InvokeResponse {
  output: Record<string, any>;
  metadata?: Record<string, any>;
  latency_ms?: number;
}

// Model Events (Step 1)
export interface ModelEvent {
  type: "Normal" | "Warning";
  reason: string;
  message: string;
  firstTimestamp: string;
  lastTimestamp: string;
  count: number;
  source?: string;
}

// LiteLLM Router (Step 2)
export interface LiteLLMModelEntry {
  model_name: string;
  litellm_params: { model?: string; api_base?: string; rpm?: number; tpm?: number };
  model_info: { id?: string; mode?: string; max_tokens?: number };
}

export interface LiteLLMRouterResponse {
  healthy: boolean;
  models: string[];
  modelInfo: LiteLLMModelEntry[];
}

// Model Comparison (Step 3)
export interface ModelComparisonData {
  name: string;
  phase: string;
  throughput: number | null;
  latencyMs: number | null;
  gpuUtilization: number | null;
  vramPercent: number | null;
  vramMB: number | null;
  gpuNode: string | null;
}

// FlexInfer Inference Metrics (Phase 3)
export interface InferenceMetrics {
  model: string;
  observed?: boolean;
  tps: number | null;
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

// Loom Agent HUD (Phase 3)
export interface HUDFleetResponse {
  sessions: HUDSession[];
  agents: HUDAgentPresence[];
  tasks: HUDTask[];
  kpis: Record<string, number>;
}

export interface HUDSession {
  id: string;
  agentId: string;
  agentType: string;
  namespace: string;
  description: string;
  startedAt: string;
  contextCount: number;
  taskCount: number;
}

export interface HUDAgentPresence {
  agentId: string;
  agentType: string;
  status: "active" | "idle" | "offline";
  activeFiles: string[];
  conflicts: string[];
  lastHeartbeat: string;
  currentTask?: string;
  description?: string;
  branch?: string;
  sessionId?: string;
}

export interface HUDTask {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: number;
  agentId?: string;
  filePath?: string;
  tags: string[];
  sessionId?: string;
  namespace?: string;
  context?: string;
  workflowId?: string;
  project?: string;
}

export interface HUDWorkflow {
  id: string;
  definitionId: string;
  status: string;
  currentStep: number;
  steps: Array<{
    name: string;
    status: string;
    requiresApproval: boolean;
  }>;
  startedAt: string;
}

export interface HUDTimelineEvent {
  timestamp: string;
  type: string;
  agentId: string;
  summary: string;
  data?: Record<string, any>;
}

export interface HUDClaim {
  agentId?: string;
  filePath?: string;
  claimType?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  ttlSeconds?: number;
  stale?: boolean;
}

export interface HUDCapabilitiesResponse {
  available: boolean;
  passthroughEnabled: boolean;
  directEntryEnabled: boolean;
  directUrl?: string;
  reason?: string;
}

// Alertmanager (Step 4)
export interface AlertmanagerAlert {
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
  endsAt: string;
  fingerprint: string;
  status: { state: "active" | "suppressed" | "unprocessed"; silencedBy: string[]; inhibitedBy: string[] };
}

export interface AlertmanagerSilence {
  id: string;
  matchers: Array<{ name: string; value: string; isRegex: boolean; isEqual: boolean }>;
  startsAt: string;
  endsAt: string;
  createdBy: string;
  comment: string;
  status: { state: "active" | "pending" | "expired" };
}

// === Phase 4: RBAC ===
export interface RBACUser {
  id: string;
  username: string;
  role: "admin" | "editor" | "viewer";
  createdAt: string;
  updatedAt: string;
  lastLogin?: string;
  disabled: boolean;
}

export interface RBACRole {
  name: string;
  permissions: string[];
}

// === Phase 4: Audit Logs ===
export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  remoteAddr: string;
  userId?: string;
  username?: string;
  role?: string;
}

export interface AuditStats {
  total: number;
  byAction: Record<string, number>;
  byUser: Record<string, number>;
  perDay: Array<{ date: string; count: number }>;
}

// === Phase 4: Multi-Cluster ===
export interface ClusterInfo {
  id: string;
  name: string;
  host: string;
  namespace: string;
  readOnly: boolean;
  isDefault: boolean;
  status: "connected" | "disconnected" | "unknown";
  createdAt: string;
}
