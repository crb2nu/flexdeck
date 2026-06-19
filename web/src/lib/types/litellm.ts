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

// LiteLLM Router (Step 2)
export interface LiteLLMModelEntry {
  model_name: string;
  litellm_params: { model?: string; api_base?: string; rpm?: number; tpm?: number; max_tokens?: number };
  model_info: { id?: string; mode?: string; max_tokens?: number };
}

export interface LiteLLMRouterResponse {
  healthy: boolean;
  models: string[];
  modelInfo: LiteLLMModelEntry[];
}
