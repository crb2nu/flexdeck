package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/flexinfer/flexdeck/internal/agents"
)

// AgentsList returns all registered agents
func (h *Handler) AgentsList(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Agents.Disabled || h.agentsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agents feature disabled",
		})
		return
	}

	agentList := h.agentsRegistry.List()
	respondJSON(w, http.StatusOK, map[string]any{
		"agents": agentList,
	})
}

// AgentsGet returns a specific agent
func (h *Handler) AgentsGet(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Agents.Disabled || h.agentsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agents feature disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")
	agent, err := h.agentsRegistry.Get(id)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, agent)
}

// AgentsCreate registers a new agent
func (h *Handler) AgentsCreate(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Agents.Disabled || h.agentsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agents feature disabled",
		})
		return
	}

	var agent agents.Agent
	if err := json.NewDecoder(r.Body).Decode(&agent); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid request body",
		})
		return
	}

	if agent.ID == "" || agent.Name == "" || agent.URL == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{
			"error": "id, name, and url are required",
		})
		return
	}

	if agent.Type == "" {
		agent.Type = agents.AgentTypeLangGraph
	}

	if err := h.agentsRegistry.Register(&agent); err != nil {
		respondJSON(w, http.StatusConflict, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusCreated, agent)
}

// AgentsUpdate updates an existing agent
func (h *Handler) AgentsUpdate(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Agents.Disabled || h.agentsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agents feature disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")

	var agent agents.Agent
	if err := json.NewDecoder(r.Body).Decode(&agent); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid request body",
		})
		return
	}

	agent.ID = id

	if err := h.agentsRegistry.Update(&agent); err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, agent)
}

// AgentsDelete removes an agent
func (h *Handler) AgentsDelete(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Agents.Disabled || h.agentsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agents feature disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")
	if err := h.agentsRegistry.Delete(id); err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"deleted": id,
	})
}

// AgentsHealth checks health of all agents
func (h *Handler) AgentsHealth(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Agents.Disabled || h.agentsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agents feature disabled",
		})
		return
	}

	results := h.agentsRegistry.CheckAllHealth(r.Context())
	respondJSON(w, http.StatusOK, map[string]any{
		"health": results,
	})
}

// AgentsCheckHealth checks health of a specific agent
func (h *Handler) AgentsCheckHealth(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Agents.Disabled || h.agentsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agents feature disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")
	status, err := h.agentsRegistry.CheckHealth(r.Context(), id)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"id":     id,
		"status": status,
	})
}

// AgentsTest tests an agent with sample input
func (h *Handler) AgentsTest(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Agents.Disabled || h.agentsProxy == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agents feature disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")

	var req struct {
		Input map[string]any `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid request body",
		})
		return
	}

	resp, err := h.agentsProxy.Test(r.Context(), id, req.Input)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, resp)
}

// AgentsInvoke proxies a request to an agent
func (h *Handler) AgentsInvoke(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Agents.Disabled || h.agentsProxy == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agents feature disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")

	var req agents.InvokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid request body",
		})
		return
	}

	resp, latencyMs, err := h.agentsProxy.Invoke(r.Context(), id, &req)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"output":     resp.Output,
		"metadata":   resp.Metadata,
		"latency_ms": latencyMs,
	})
}

// AgentsStream proxies a streaming request to an agent
func (h *Handler) AgentsStream(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Agents.Disabled || h.agentsProxy == nil {
		http.Error(w, "agents feature disabled", http.StatusServiceUnavailable)
		return
	}

	id := chi.URLParam(r, "id")

	var req agents.InvokeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if err := h.agentsProxy.Stream(r.Context(), id, &req, w); err != nil {
		// Can't send error response if we've already started streaming
		return
	}
}

// AgentsUsage returns usage statistics for an agent
func (h *Handler) AgentsUsage(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Agents.Disabled || h.agentsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agents feature disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")
	usage, err := h.agentsRegistry.GetUsage(id)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, usage)
}
