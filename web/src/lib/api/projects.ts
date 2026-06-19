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

export interface ProjectDetail {
  project: string;
  partial: boolean;
  tasks: ProjectTask[];
  issues: ProjectIssue[];
  milestones: ProjectMilestone[];
  risks: ProjectRisk[];
  decisions: ProjectDecision[];
}

export const projectsApi = {
  list: () => api<ProjectsList>('/projects'),
  // id is the project path_with_namespace (e.g. "services/flexdeck"); it is
  // url-encoded so the slash does not split the route.
  get: (id: string) => api<ProjectDetail>(`/projects/${encodeURIComponent(id)}`),
};
