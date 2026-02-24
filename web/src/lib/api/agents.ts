import { api } from "./client";

export const agentsApi = {
  list: () => api<any>("/agents/"),
  graph: () => api<{ nodes: any[]; edges: any[] }>("/agents/graph"),
  get: (id: string) => api<any>(`/agents/${encodeURIComponent(id)}`),
  create: (agent: any) =>
    api<any>("/agents/", {
      method: "POST",
      body: JSON.stringify(agent),
    }),
  update: (id: string, agent: any) =>
    api<any>(`/agents/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(agent),
    }),
  delete: (id: string) =>
    api<any>(`/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  health: () => api<any>("/agents/health"),
  checkHealth: (id: string) =>
    api<any>(`/agents/${encodeURIComponent(id)}/health`),
  test: (id: string, input: Record<string, any>) =>
    api<any>(`/agents/${encodeURIComponent(id)}/test`, {
      method: "POST",
      body: JSON.stringify({ input }),
    }),
  invoke: (id: string, request: any) =>
    api<any>(`/agents/${encodeURIComponent(id)}/invoke`, {
      method: "POST",
      body: JSON.stringify(request),
    }),
  usage: (id: string) => api<any>(`/agents/${encodeURIComponent(id)}/usage`),
  sessions: (id: string) => api<{ sessions: any[] }>(`/agents/${encodeURIComponent(id)}/sessions`),

  // Built-in Agent Builder
  builderInfo: () => api<any>("/agents/builder"),
  builderChat: (query: string, context?: Record<string, any>) =>
    api<any>("/agents/builder/chat", {
      method: "POST",
      body: JSON.stringify({ query, context }),
    }),

  // External Agent Frameworks
  frameworks: () => api<any>("/agents/frameworks"),

  // Dify integration
  difyChat: (
    query: string,
    conversationId?: string,
    inputs?: Record<string, string>,
  ) =>
    api<any>("/agents/dify/chat", {
      method: "POST",
      body: JSON.stringify({
        query,
        conversation_id: conversationId,
        inputs,
        response_mode: "blocking",
      }),
    }),

  // LangGraph integration
  langGraphAssistants: () => api<any>("/agents/langgraph/assistants"),
  langGraphRun: (
    graphId: string,
    input: Record<string, any>,
    threadId?: string,
  ) =>
    api<any>("/agents/langgraph/run", {
      method: "POST",
      body: JSON.stringify({ graph_id: graphId, input, thread_id: threadId }),
    }),
};
