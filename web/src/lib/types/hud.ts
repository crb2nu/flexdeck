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
  status: string;
  namespace: string;
  project?: string;
  description: string;
  startedAt: string;
  endedAt?: string;
  contextCount: number;
  totalTokens: number;
  taskCount: number;
  parentSessionId?: string;
  rootSessionId?: string;
}

// A single context entry within a session (the drill-in detail).
export interface HUDSessionEntry {
  id: string;
  entryType: string;
  agentId?: string;
  namespace?: string;
  title?: string;
  content?: string;
  timestamp: string;
  score?: number;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  tokenCount?: number;
}

export interface HUDSessionDetail {
  session?: HUDSession;
  entries: HUDSessionEntry[];
}

// A daemon audit tool-call trace associated with a session (the trace drill-in).
export interface HUDSessionTraceCall {
  timestamp: string;
  agentId?: string;
  agentType?: string;
  server: string;
  tool: string;
  status: string;
  error?: string;
  target?: string;
  cached?: boolean;
  pipelineStage?: string;
  durationMs?: number;
}

// An in-band partial-source failure reported by the trace endpoint, so the
// drill-in can show which upstream source was unavailable rather than blanking.
export interface HUDSessionTraceError {
  source: string;
  message: string;
}

// The trace timeline for a single session: lifecycle events plus tool-call
// traces. `events` reuses the timeline contract since the shapes are identical.
export interface HUDSessionTrace {
  session?: HUDSession;
  sessionId: string;
  agentId?: string;
  events: HUDTimelineEvent[];
  traces: HUDSessionTraceCall[];
  traceEnabled: boolean;
  tracePath?: string;
  errors: HUDSessionTraceError[];
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

// Inter-agent handoff (the handoff inbox). One agent packages context + an
// instruction and routes it to another agent, who accepts or rejects it.
export interface HUDHandoff {
  id: string;
  fromAgent: string;
  toAgent?: string;
  targetAgentId?: string;
  status: string;
  summary: string;
  context?: string;
  createdAt?: string;
  acceptedAt?: string;
}

export interface HUDCapabilitiesResponse {
  available: boolean;
  passthroughEnabled: boolean;
  directEntryEnabled: boolean;
  directUrl?: string;
  reason?: string;
}
