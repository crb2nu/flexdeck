import { api } from './client';

// --- Backend JSON contract (slice 3) --------------------------------------
// Read-only proxy to loom-mills-operator (/api/loom/mills/*). The operator
// returns Go-struct JSON: backlog / pipeline / council / stage records use
// PascalCase field names; /status uses snake_case. Shapes verified against
// loom-core pkg/mills/store/types.go.

export interface MillsCapability {
  id: string;
  status: string;
  mode?: string;
  message?: string;
  required_for_autonomy?: boolean;
}

export interface MillsStatus {
  active_pipeline_runs?: number;
  autonomy_ready?: boolean;
  autonomy_blockers?: string[] | null;
  capabilities?: MillsCapability[];
}

export interface MillsBacklogItem {
  ID: string;
  Title: string;
  State: string;
  Priority: string;
  Labels: string[] | null;
  PlanID: string;
  GitLabIssueIID: number | null;
  CreatedAt: string;
  UpdatedAt: string;
}

export interface MillsPipelineRun {
  ID: string;
  BacklogID: string;
  Template: string;
  State: string;
  CurrentStage: string;
  Attempts: number;
  CostUSD: number;
  StartedAt: string;
  EndedAt: string | null;
  Depth: number;
}

export interface MillsStageResult {
  ID: number;
  PipelineRunID: string;
  Stage: string;
  Attempt: number;
  StartedAt: string;
  EndedAt: string | null;
  Outcome: string | null;
  SpawnID: string;
  CostUSD: number;
  LogTail: string;
}

export interface MillsPipelineDetail {
  run: MillsPipelineRun;
  stages: MillsStageResult[] | null;
  gates: unknown[] | null;
}

export interface MillsCouncilRun {
  ID: string;
  Trigger: string;
  Outcome: string;
  StartedAt: string;
  EndedAt: string | null;
  CostFrontierUSD: number;
  CostLocalUSD: number;
  Notes: string;
}

export interface MillsDebateRound {
  ID: number;
  CouncilRunID: string;
  RoundIndex: number;
  Role: string;
  CostUSD: number;
  Summary: string;
  CreatedAt: string;
}

export const loomMillsApi = {
  status: () => api<MillsStatus>('/loom/mills/status'),
  backlog: () => api<MillsBacklogItem[]>('/loom/mills/backlog'),
  pipelineRuns: () => api<MillsPipelineRun[]>('/loom/mills/pipeline/runs'),
  pipelineRun: (id: string) => api<MillsPipelineDetail>(`/loom/mills/pipeline/runs/${encodeURIComponent(id)}`),
  councilRuns: () => api<MillsCouncilRun[]>('/loom/mills/council/runs'),
  councilDebate: (id: string) => api<MillsDebateRound[]>(`/loom/mills/council/runs/${encodeURIComponent(id)}/debate`),
  // Eval / squads / audit / policy proposals are proxied but rendered generically.
  raw: (path: string) => api<unknown>(`/loom/mills/${path}`),
};
