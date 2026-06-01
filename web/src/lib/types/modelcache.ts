import type { GPUSwapEvent } from "./flexinfer";

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
