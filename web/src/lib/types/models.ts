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
