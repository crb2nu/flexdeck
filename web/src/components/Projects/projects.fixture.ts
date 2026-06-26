import type { ProjectDetail, ProjectsList } from '../../lib/api/projects';

// Sample payloads matching the frozen GET /api/projects[/{id}] contract.
// Used by the dev-mode mock and component tests so the page can be exercised
// without a live backend.

export const projectsListFixture: ProjectsList = {
  projects: [
    {
      project: 'services/flexdeck',
      open_tasks: 2,
      open_issues: 1,
      milestones_at_risk: 0,
      open_risks: 2,
      open_plans: 1,
    },
    {
      project: 'services/flexinfer',
      open_tasks: 0,
      open_issues: 3,
      milestones_at_risk: 1,
      open_risks: 0,
      open_plans: 0,
    },
  ],
};

export const projectDetailFixture: ProjectDetail = {
  project: 'services/flexdeck',
  partial: false,
  tasks: [
    {
      id: 'task-1',
      title: 'Wire /projects page to backend rollup',
      status: 'in_progress',
      priority: 'high',
      session_id: 'sess-abc',
    },
    {
      id: 'task-2',
      title: 'Add fixture-backed component test',
      status: 'open',
      priority: 'medium',
      session_id: 'sess-def',
    },
  ],
  issues: [
    {
      iid: 42,
      title: 'Stack page latency spikes on cold cache',
      state: 'opened',
      labels: ['bug', 'performance'],
      web_url: 'https://gitlab.example.com/services/flexdeck/-/issues/42',
    },
  ],
  milestones: [
    {
      id: 'ms-1',
      title: 'Unified Project Tracking',
      state: 'active',
      due_date: '2026-07-01',
      web_url: 'https://gitlab.example.com/services/flexdeck/-/milestones/1',
    },
  ],
  risks: [
    {
      id: 'risk-1',
      title: 'Backend contract may drift before integration',
      likelihood: 'medium',
      impact: 'high',
      status: 'open',
    },
    {
      id: 'risk-2',
      title: 'Polling flicker on detail lanes',
      likelihood: 'low',
      impact: 'medium',
      status: 'mitigating',
    },
  ],
  decisions: [
    {
      id: 'dec-1',
      title: 'Milestones source from GitLab native, risks from mcp-pm',
      decided_at: '2026-06-19',
    },
  ],
  plans: [
    {
      id: 'plan-unified-tracking-ab12cd',
      slug: 'unified-tracking',
      title: 'Unified project tracking',
      phase: 'in_progress',
      mr_refs: 2,
      kill_test_status: 'passed',
      issue_iid: 17,
      issue_url: 'https://gitlab.example.com/services/flexdeck/-/issues/17',
      slice_total: 4,
      slice_done: 3,
    },
  ],
};

const partialProject: ProjectDetail = {
  project: 'services/flexinfer',
  partial: true,
  tasks: [],
  issues: projectDetailFixture.issues,
  milestones: projectDetailFixture.milestones,
  risks: [],
  decisions: [],
  plans: [],
};

// Keyed by project id for the dev-mode mock lookup.
export const projectDetailFixtures: Record<string, ProjectDetail> = {
  'services/flexdeck': projectDetailFixture,
  'services/flexinfer': partialProject,
};
