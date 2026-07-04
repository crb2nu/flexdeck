import { api } from './client';

// --- Backend JSON contract (frozen) ---------------------------------------
// GET /api/projects -> { projects: ProjectSummary[] }
// GET /api/projects/{id} (id = url-encoded path_with_namespace) -> ProjectDetail
//
// The backend is a sibling slice; this module is driven by the frozen contract
// below and verified against a fixture (projects.fixture.ts).

export interface ProjectSummary {
  project: string;
  open_tasks: number;
  open_issues: number;
  milestones_at_risk: number;
  open_risks: number;
  open_plans: number;
}

export interface ProjectsList {
  projects: ProjectSummary[];
}

export type TaskStatus = string;

export interface ProjectTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: string;
  session_id: string;
}

export interface ProjectIssue {
  iid: number;
  title: string;
  state: string;
  labels: string[];
  web_url: string;
}

export interface ProjectMilestone {
  id: string;
  title: string;
  state: string;
  due_date: string;
  web_url: string;
}

export type RiskLevel = string;

export interface ProjectRisk {
  id: string;
  title: string;
  likelihood: RiskLevel;
  impact: RiskLevel;
  status: string;
}

export interface ProjectDecision {
  id: string;
  title: string;
  decided_at: string;
}

// ProjectPlan mirrors a plan from the agent-context Plan store. Phase is the
// lifecycle stage; management (create/advance) lives in the loom-hud, so this
// lane is read-only with a deep link out. kill_test_status and the born-linked
// issue (issue_iid/issue_url) carry loom-core's S7b planning contract;
// issue_url is "" when the plan has no linked GitLab issue.
export interface ProjectPlan {
  id: string;
  slug: string;
  title: string;
  phase: string;
  mr_refs: number;
  kill_test_status: string;
  riskiest_assumption: string;
  issue_iid: number;
  issue_url: string;
  // Slice progress: total slices and how many have landed (integrated/merged).
  slice_total: number;
  slice_done: number;
  // Per-slice detail for the drill-in, ordered by slice order.
  slices: ProjectPlanSlice[];
}

export interface ProjectPlanSlice {
  order: number;
  name: string;
  phase: string;
  mr_ref: string;
}

export interface ProjectDetail {
  project: string;
  partial: boolean;
  tasks: ProjectTask[];
  issues: ProjectIssue[];
  milestones: ProjectMilestone[];
  risks: ProjectRisk[];
  decisions: ProjectDecision[];
  plans: ProjectPlan[];
}

// CreateProjectRiskInput is the POST /api/projects/{id}/risks request body.
// Only `title` is required; the backend defaults likelihood/impact to "medium"
// and status to "identified", and validates against its allowed ladders
// (likelihood/impact: low|medium|high; status: identified|mitigating|accepted|closed).
export interface CreateProjectRiskInput {
  title: string;
  likelihood?: string;
  impact?: string;
  status?: string;
  mitigation?: string;
  owner?: string;
}

export const projectsApi = {
  list: () => api<ProjectsList>('/projects'),
  // id is the project path_with_namespace (e.g. "services/flexdeck"); it is
  // url-encoded so the slash does not split the route.
  get: (id: string) => api<ProjectDetail>(`/projects/${encodeURIComponent(id)}`),
  // createRisk captures a new risk for the project in the pm_risks store and
  // returns the persisted risk (201). Backend invalidates the detail/rollup
  // caches, so a follow-up detail refresh surfaces the new row.
  createRisk: (id: string, input: CreateProjectRiskInput) =>
    api<ProjectRisk>(`/projects/${encodeURIComponent(id)}/risks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
