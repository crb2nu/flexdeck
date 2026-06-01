// Agent types
export type AgentType = "langgraph" | "custom" | "cli-agent";
export type AgentStatus = "unknown" | "healthy" | "unhealthy";

export interface Agent {
  id: string;
  name: string;
  description: string;
  type: AgentType;
  url: string;
  api_key?: string;
  model?: string;
  tags: string[];
  metadata?: Record<string, any>;
  status: AgentStatus;
  last_checked?: string;
  created_at: string;
  updated_at: string;
}

export interface AgentNode {
  id: string;
  name: string;
  type: AgentType;
  status: AgentStatus;
  tags: string[];
  metadata?: Record<string, any>;
}

export interface AgentEdge {
  source: string;
  target: string;
}

export interface AgentGraphResponse {
  nodes: AgentNode[];
  edges: AgentEdge[];
}

export interface AgentUsage {
  agent_id: string;
  request_count: number;
  total_tokens: number;
  total_latency_ms: number;
  last_used: string;
}

export interface AgentSession {
  id: string;
  agent_id: string;
  namespace?: string;
  started_at: string;
  ended_at?: string;
  status: string;
  description?: string;
  entry_count?: number;
  total_tokens?: number;
}

export interface InvokeRequest {
  input: Record<string, any>;
  config?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface InvokeResponse {
  output: Record<string, any>;
  metadata?: Record<string, any>;
  latency_ms?: number;
}
