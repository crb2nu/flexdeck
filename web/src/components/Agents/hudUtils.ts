import type { Agent, HUDAgentPresence, HUDClaim, HUDWorkflow } from '../../lib/types';

/** Check whether an agent is a HUD/CLI agent (vs registry agent). */
export function isHUDAgent(agent: Agent): boolean {
  return agent.type === 'cli-agent' || agent.metadata?.source === 'hud';
}

export function toErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function normalizePresenceFromPush(
  rawAgents: Array<Record<string, unknown>>
): HUDAgentPresence[] {
  return rawAgents
    .filter((agent) => {
      const metadata = (agent.metadata as Record<string, unknown>) || {};
      return metadata.source === 'hud' || agent.type === 'cli-agent';
    })
    .map((agent) => {
      const metadata = (agent.metadata as Record<string, unknown>) || {};
      const activeFiles = Array.isArray(metadata.active_files) ? metadata.active_files : [];
      const conflicts = Array.isArray(metadata.conflicts) ? metadata.conflicts : [];
      const status =
        (metadata.presence_status as string) ||
        ((agent.status as string) === 'healthy' ? 'active' : 'offline');
      return {
        agentId: String(agent.id || metadata.agent_id || 'unknown'),
        agentType: String(metadata.agent_type || agent.type || 'cli-agent'),
        status: status as HUDAgentPresence['status'],
        activeFiles: activeFiles.map((item) => String(item)),
        conflicts: conflicts.map((item) => String(item)),
        lastHeartbeat: String(metadata.last_heartbeat || ''),
      };
    });
}

export function extractItems<T>(value: unknown, key: string): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const wrapped = value as Record<string, unknown>;
    if (Array.isArray(wrapped[key])) return wrapped[key] as T[];
    if (Array.isArray(wrapped.items)) return wrapped.items as T[];
  }
  return [];
}

export function getClaimField(claim: HUDClaim, keys: string[], fallback: string): string {
  const raw = claim as Record<string, unknown>;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return fallback;
}

export function groupClaimsByAgent(claims: HUDClaim[]): Record<string, HUDClaim[]> {
  const grouped: Record<string, HUDClaim[]> = {};
  for (const claim of claims) {
    const agent = getClaimField(claim, ['agentId', 'agent_id'], 'unknown-agent');
    if (!grouped[agent]) grouped[agent] = [];
    grouped[agent].push(claim);
  }
  return grouped;
}

export function countClaimConflicts(claims: HUDClaim[]): number {
  const byFile: Record<string, Set<string>> = {};
  for (const claim of claims) {
    const file = getClaimField(claim, ['filePath', 'file_path'], '');
    if (!file) continue;
    const agent = getClaimField(claim, ['agentId', 'agent_id'], 'unknown-agent');
    if (!byFile[file]) byFile[file] = new Set<string>();
    byFile[file].add(agent);
  }
  return Object.values(byFile).filter((agents) => agents.size > 1).length;
}

export function applyWorkflowCancel(workflows: HUDWorkflow[], id: string): HUDWorkflow[] {
  return workflows.map((workflow) => (workflow.id === id ? { ...workflow, status: 'canceled' } : workflow));
}
