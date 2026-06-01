// Loom Agent HUD (Phase 3)
export interface HUDFleetResponse {
  sessions: HUDSession[];
  agents: HUDAgentPresence[];
  claims?: HUDClaim[];
  tasks: HUDTask[];
  kpis: Record<string, number>;
}

export interface HUDSession {
  id: string;
  agentId: string;
  agentType: string;
  namespace: string;
  description: string;
  startedAt: string;
  contextCount: number;
  taskCount: number;
}

export interface HUDAgentPresence {
  agentId: string;
  agentType: string;
  status: "active" | "idle" | "offline";
  activeFiles: string[];
  conflicts: string[];
  lastHeartbeat: string;
  currentTask?: string;
  description?: string;
  branch?: string;
  sessionId?: string;
}

export interface HUDTask {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  priority: number;
  agentId?: string;
  filePath?: string;
  tags: string[];
  sessionId?: string;
  namespace?: string;
  context?: string;
  workflowId?: string;
  project?: string;
}

export interface HUDWorkflow {
  id: string;
  definitionId: string;
  status: string;
  currentStep: number;
  steps: Array<{
    name: string;
    status: string;
    requiresApproval: boolean;
  }>;
  startedAt: string;
}

export interface HUDTimelineEvent {
  timestamp: string;
  type: string;
  agentId: string;
  summary: string;
  data?: Record<string, any>;
}

export interface HUDClaim {
  agentId?: string;
  filePath?: string;
  claimType?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  ttlSeconds?: number;
  stale?: boolean;
}

export interface HUDCapabilitiesResponse {
  available: boolean;
  passthroughEnabled: boolean;
  directEntryEnabled: boolean;
  directUrl?: string;
  reason?: string;
}
