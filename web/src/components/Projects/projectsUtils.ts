import type { BadgeTone } from '../shared';
import type {
  ProjectDecision,
  ProjectIssue,
  ProjectMilestone,
  ProjectPlan,
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
    summary.open_risks +
    summary.open_plans
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
    summary.open_plans,
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

// Plan lifecycle phase -> badge tone. Early phases are neutral/info, review/
// merging warm, merged/deployed/done positive, abandoned muted.
export function planPhaseTone(phase: string): BadgeTone {
  switch (phase.toLowerCase()) {
    case 'in_review':
    case 'merging':
      return 'warn';
    case 'merged':
    case 'deployed':
    case 'done':
      return 'ok';
    case 'in_progress':
    case 'planned':
      return 'info';
    default:
      return 'default';
  }
}

// Kill-test status is free-form prose in practice — e.g.
// "passed 2026-06-21 (live proxy + cross-process integration test)" or
// "legs 0+a+b+c ALL PASS (...). Follow-ups: ...". Rendering it raw blows up the
// compact lane, so derive a one-word verdict + tone for the badge and keep the
// full text as a tooltip. Detection anchors on the leading verdict (the
// riskiest-assumption template writes "passed …" / "FAILED …" / "not run") with
// a substring fallback for "ALL PASS"-style summaries.
export function killTestSummary(status: string): { label: string; tone: BadgeTone } {
  const s = status.trim().toLowerCase();
  if (!s) return { label: '', tone: 'default' };
  if (/^(not[\s-]?run|pending|todo|n\/a)/.test(s)) {
    return { label: 'not run', tone: 'default' };
  }
  const passed = /\bpass(ed)?\b/.test(s) || /all[\s-]*pass/.test(s);
  const failed = /\bfail(ed|s)?\b/.test(s) || /^killed/.test(s);
  if (failed && passed) return { label: 'mixed', tone: 'warn' };
  if (failed) return { label: 'failed', tone: 'error' };
  if (passed) return { label: 'passed', tone: 'ok' };
  if (/\b(running|in[\s_]?progress)\b/.test(s)) return { label: 'running', tone: 'warn' };
  return { label: 'recorded', tone: 'default' };
}

// Slice lifecycle phase -> badge tone. landed (integrated/merged) positive,
// implemented/in_review warm, claimed/implementing in-flight, pending neutral.
export function slicePhaseTone(phase: string): BadgeTone {
  switch (phase.toLowerCase()) {
    case 'merged':
    case 'integrated':
      return 'ok';
    case 'implemented':
    case 'in_review':
      return 'warn';
    case 'claimed':
    case 'implementing':
      return 'info';
    default:
      return 'default';
  }
}

export function planSignature(plan: ProjectPlan): string {
  return [
    plan.id,
    plan.title,
    plan.phase,
    String(plan.mr_refs),
    plan.kill_test_status,
    plan.riskiest_assumption,
    String(plan.issue_iid),
    `${plan.slice_done}/${plan.slice_total}`,
    plan.slices.map((s) => `${s.order}:${s.phase}`).join(','),
  ].join('|');
}
