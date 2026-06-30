import { api } from './client';

// --- Backend JSON contract (slice 2) --------------------------------------
// GET /api/loom/plans?project=&namespace=&phase= -> LoomPlansList
// GET /api/loom/plans/{id} -> LoomPlanDetail
//
// Reads the agent_plans_v1 / agent_plan_slices_v1 Qdrant collections (the same
// store the Projects drill-in federates). Phase is the lifecycle phase.

export interface LoomPlanSummary {
  id: string;
  slug: string;
  title: string;
  project: string;
  namespace: string;
  phase: string;
  kill_test_status: string;
  riskiest_assumption: string;
  mr_refs: number;
  issue_iid: number;
  issue_url: string;
  slice_total: number;
  slice_done: number;
  updated_at: string;
}

export interface LoomPlansList {
  plans: LoomPlanSummary[];
}

export interface LoomPlanSliceDetail {
  order: number;
  name: string;
  goal: string;
  phase: string;
  files: string[];
  acceptance_criteria: string;
  branch_name: string;
  mr_ref: string;
  depends_on: string[];
}

export interface LoomPlanPhaseTransition {
  from: string;
  to: string;
  at: string;
  actor?: string;
  note?: string;
}

export interface LoomPlanSuccess {
  tests?: string[];
  metrics?: string[];
  manual_check?: string;
}

export interface LoomPlanDetail extends LoomPlanSummary {
  kill_test: string;
  success?: LoomPlanSuccess;
  dependencies: string[];
  mr_ref_list: string[];
  pipeline_refs: string[];
  deploy_refs: string[];
  mills_backlog_id: string;
  mirror_path: string;
  created_by: string;
  created_at: string;
  phase_history: LoomPlanPhaseTransition[];
  slices: LoomPlanSliceDetail[];
}

export interface LoomPlansQuery {
  project?: string;
  namespace?: string;
  phase?: string;
}

export const loomPlansApi = {
  list: (params?: LoomPlansQuery) => {
    const q = new URLSearchParams();
    if (params?.project) q.set('project', params.project);
    if (params?.namespace) q.set('namespace', params.namespace);
    if (params?.phase) q.set('phase', params.phase);
    const qs = q.toString();
    return api<LoomPlansList>(`/loom/plans${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => api<LoomPlanDetail>(`/loom/plans/${encodeURIComponent(id)}`),
};
