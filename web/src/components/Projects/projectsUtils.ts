import type { BadgeTone } from '../shared';
import type {
  ProjectDecision,
  ProjectIssue,
  ProjectMilestone,
  ProjectRisk,
  ProjectSummary,
  ProjectTask,
} from '../../lib/api/projects';

// Risk likelihood/impact ladder -> badge tone. Higher severity = warmer tone.
export function riskLevelTone(level: string): BadgeTone {
  switch (level.toLowerCase()) {
    case 'high':
    case 'critical':
      return 'error';
    case 'medium':
    case 'moderate':
      return 'warn';
    case 'low':
    case 'minor':
      return 'ok';
    default:
      return 'default';
  }
}

export function riskStatusTone(status: string): BadgeTone {
  switch (status.toLowerCase()) {
    case 'open':
    case 'active':
      return 'error';
    case 'mitigating':
    case 'in_progress':
      return 'warn';
    case 'resolved':
    case 'closed':
    case 'mitigated':
      return 'ok';
    default:
      return 'default';
  }
}

export function taskStatusTone(status: string): BadgeTone {
  switch (status.toLowerCase()) {
    case 'completed':
    case 'done':
      return 'ok';
    case 'in_progress':
    case 'active':
      return 'info';
    case 'blocked':
      return 'error';
    default:
      return 'default';
  }
}

export function priorityTone(priority: string): BadgeTone {
  switch (priority.toLowerCase()) {
    case 'high':
    case 'urgent':
    case 'critical':
      return 'error';
    case 'medium':
      return 'warn';
    case 'low':
      return 'ok';
    default:
      return 'default';
  }
}

// The trailing path segment, e.g. "services/flexdeck" -> "flexdeck".
export function projectShortName(project: string): string {
  const parts = project.split('/');
  return parts[parts.length - 1] || project;
}

export function projectNamespace(project: string): string {
  const parts = project.split('/');
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
}

// Total open-work signal across all rollup dimensions, used for sorting and a
// quick "needs attention" cue.
export function summaryConcern(summary: ProjectSummary): number {
  return (
    summary.open_tasks +
    summary.open_issues +
    summary.milestones_at_risk +
    summary.open_risks
  );
}

// Structural signatures keep <For> from tearing down rows on each poll. Only
// fields that affect rendering are included.
export function summarySignature(summary: ProjectSummary): string {
  return [
    summary.project,
    summary.open_tasks,
    summary.open_issues,
    summary.milestones_at_risk,
    summary.open_risks,
  ].join('|');
}

export function taskSignature(task: ProjectTask): string {
  return [task.id, task.title, task.status, task.priority].join('|');
}

export function issueSignature(issue: ProjectIssue): string {
  return [issue.iid, issue.title, issue.state, issue.labels.join(','), issue.web_url].join('|');
}

export function milestoneSignature(milestone: ProjectMilestone): string {
  return [milestone.id, milestone.title, milestone.state, milestone.due_date, milestone.web_url].join('|');
}

export function riskSignature(risk: ProjectRisk): string {
  return [risk.id, risk.title, risk.likelihood, risk.impact, risk.status].join('|');
}

export function decisionSignature(decision: ProjectDecision): string {
  return [decision.id, decision.title, decision.decided_at].join('|');
}
