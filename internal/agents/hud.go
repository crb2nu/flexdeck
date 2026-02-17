package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// AgentTypeCLI represents a CLI dev agent (Claude Code, Gemini, Codex)
const AgentTypeCLI AgentType = "cli-agent"

// HUDClient is a thin HTTP client for the loom-core HUD REST API.
// When a push store is attached, GetPresence/GetSessions check it first
// and fall through to HTTP pull only if the push data is stale or absent.
type HUDClient struct {
	url        string
	httpClient *http.Client
	pushStore  *HUDPushStore
}

// NewHUDClient creates a new HUD client
func NewHUDClient(url string) *HUDClient {
	return &HUDClient{
		url: strings.TrimRight(url, "/"),
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

// PresenceInfo represents a single agent presence entry from the HUD API
type PresenceInfo struct {
	AgentID       string   `json:"agent_id"`
	AgentType     string   `json:"agent_type"`
	Status        string   `json:"status"` // active, idle, offline
	CurrentTask   string   `json:"current_task,omitempty"`
	ActiveFiles   []string `json:"active_files,omitempty"`
	Branch        string   `json:"branch,omitempty"`
	PRURL         string   `json:"pr_url,omitempty"`
	LastHeartbeat string   `json:"last_heartbeat,omitempty"`
	SessionID     string   `json:"session_id,omitempty"`
	Namespace     string   `json:"namespace,omitempty"`
}

// PresenceResponse is the response from GET /api/presence
type PresenceResponse struct {
	Agents []PresenceInfo `json:"agents"`
}

// SessionInfo represents a session entry from the HUD API
type SessionInfo struct {
	ID          string `json:"id"`
	AgentID     string `json:"agent_id"`
	Namespace   string `json:"namespace,omitempty"`
	StartedAt   string `json:"started_at"`
	EndedAt     string `json:"ended_at,omitempty"`
	Status      string `json:"status"`
	Description string `json:"description,omitempty"`
	EntryCount  int    `json:"entry_count,omitempty"`
	TotalTokens int64  `json:"total_tokens,omitempty"`
}

// SessionsResponse is the response from GET /api/sessions
type SessionsResponse struct {
	Sessions []SessionInfo `json:"sessions"`
}

// ToAgent converts a HUD PresenceInfo to a unified Agent struct
func (p *PresenceInfo) ToAgent() *Agent {
	now := time.Now()

	status := AgentStatusUnknown
	switch p.Status {
	case "active", "idle":
		status = AgentStatusHealthy
	case "offline":
		status = AgentStatusUnhealthy
	}

	tags := []string{"hud", "cli"}
	if p.AgentType != "" {
		tags = append(tags, p.AgentType)
	}

	name := formatAgentName(p.AgentType, p.AgentID)

	metadata := map[string]any{
		"source":     "hud",
		"agent_type": p.AgentType,
	}
	if p.SessionID != "" {
		metadata["session_id"] = p.SessionID
	}
	if p.CurrentTask != "" {
		metadata["current_task"] = p.CurrentTask
	}
	if p.ActiveFiles != nil {
		metadata["active_files"] = p.ActiveFiles
	}
	if p.Branch != "" {
		metadata["branch"] = p.Branch
	}
	if p.PRURL != "" {
		metadata["pr_url"] = p.PRURL
	}
	if p.LastHeartbeat != "" {
		metadata["last_heartbeat"] = p.LastHeartbeat
	}
	if p.Namespace != "" {
		metadata["namespace"] = p.Namespace
	}
	metadata["presence_status"] = p.Status

	return &Agent{
		ID:          "hud-" + p.AgentID,
		Name:        name,
		Description: buildDescription(p),
		Type:        AgentTypeCLI,
		Tags:        tags,
		Metadata:    metadata,
		Status:      status,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

// SetPushStore attaches a push store for receiving data from the local HUD webhook.
func (c *HUDClient) SetPushStore(store *HUDPushStore) {
	c.pushStore = store
}

// GetPresence returns agent presence. It checks the push store first and
// falls through to an HTTP pull if no fresh pushed data is available.
func (c *HUDClient) GetPresence(ctx context.Context) (*PresenceResponse, error) {
	if c.pushStore != nil {
		if resp, ok := c.pushStore.GetPresence(); ok {
			return resp, nil
		}
	}
	if c.url == "" {
		return nil, fmt.Errorf("HUD pull URL not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url+"/api/presence", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HUD returned status %d", resp.StatusCode)
	}

	var result PresenceResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}

// GetSessions returns session data. It checks the push store first and
// falls through to an HTTP pull if no fresh pushed data is available.
func (c *HUDClient) GetSessions(ctx context.Context) (*SessionsResponse, error) {
	if c.pushStore != nil {
		if resp, ok := c.pushStore.GetSessions(); ok {
			return resp, nil
		}
	}
	if c.url == "" {
		return nil, fmt.Errorf("HUD pull URL not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url+"/api/sessions", nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HUD returned status %d", resp.StatusCode)
	}

	var result SessionsResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}

// GetSessionsByAgent fetches sessions for a specific agent from the HUD API
func (c *HUDClient) GetSessionsByAgent(ctx context.Context, agentID string) ([]SessionInfo, error) {
	sessions, err := c.GetSessions(ctx)
	if err != nil {
		return nil, err
	}

	var filtered []SessionInfo
	for _, s := range sessions.Sessions {
		if s.AgentID == agentID {
			filtered = append(filtered, s)
		}
	}
	return filtered, nil
}

// GetAgents returns agents from both presence and recent sessions.
// Active agents (from presence) take priority; agents with only session
// history appear as offline with their last session metadata.
func (c *HUDClient) GetAgents(ctx context.Context) ([]*Agent, error) {
	// Fetch presence (active/idle agents)
	presence, presenceErr := c.GetPresence(ctx)

	// Fetch sessions (all agents with history)
	sessions, sessionsErr := c.GetSessions(ctx)

	// If both fail, return error
	if presenceErr != nil && sessionsErr != nil {
		return nil, fmt.Errorf("presence: %w; sessions: %v", presenceErr, sessionsErr)
	}

	agentMap := make(map[string]*Agent)

	// Add presence agents first (they have the richest data)
	if presence != nil {
		for i := range presence.Agents {
			a := presence.Agents[i].ToAgent()
			agentMap[a.ID] = a
		}
	}

	// Add agents from sessions that aren't already in presence
	if sessions != nil {
		// Group sessions by agent_id, keep most recent
		latestSession := make(map[string]*SessionInfo)
		for i := range sessions.Sessions {
			s := &sessions.Sessions[i]
			existing, ok := latestSession[s.AgentID]
			if !ok || s.StartedAt > existing.StartedAt {
				latestSession[s.AgentID] = s
			}
		}

		// Count sessions per agent
		sessionCounts := make(map[string]int)
		for _, s := range sessions.Sessions {
			sessionCounts[s.AgentID]++
		}

		for agentID, session := range latestSession {
			hudID := "hud-" + agentID
			if _, exists := agentMap[hudID]; exists {
				// Already have this agent from presence, just add session count
				agentMap[hudID].Metadata["session_count"] = sessionCounts[agentID]
				continue
			}

			// Determine status from session
			presenceStatus := "offline"
			agentStatus := AgentStatusUnhealthy
			if session.Status == "active" {
				presenceStatus = "idle"
				agentStatus = AgentStatusHealthy
			}

			// Infer agent type from agent ID
			agentType := inferAgentType(agentID)
			name := formatAgentName(agentType, agentID)

			tags := []string{"hud", "cli"}
			if agentType != "" {
				tags = append(tags, agentType)
			}

			metadata := map[string]any{
				"source":          "hud",
				"agent_type":      agentType,
				"presence_status": presenceStatus,
				"session_count":   sessionCounts[agentID],
				"last_session_id": session.ID,
			}
			if session.Namespace != "" {
				metadata["namespace"] = session.Namespace
			}
			if session.Description != "" && session.Description != "Heartbeat bootstrap session" {
				metadata["current_task"] = session.Description
			}
			if session.StartedAt != "" {
				metadata["last_heartbeat"] = session.StartedAt
			}

			now := time.Now()
			agentMap[hudID] = &Agent{
				ID:          hudID,
				Name:        name,
				Description: sessionDescription(session),
				Type:        AgentTypeCLI,
				Tags:        tags,
				Metadata:    metadata,
				Status:      agentStatus,
				CreatedAt:   now,
				UpdatedAt:   now,
			}
		}
	}

	agents := make([]*Agent, 0, len(agentMap))
	for _, a := range agentMap {
		agents = append(agents, a)
	}
	return agents, nil
}

func inferAgentType(agentID string) string {
	switch {
	case strings.HasPrefix(agentID, "claude"):
		return "claude-code"
	case strings.HasPrefix(agentID, "codex"):
		return "codex"
	case strings.HasPrefix(agentID, "gemini"):
		return "gemini"
	default:
		return ""
	}
}

func sessionDescription(s *SessionInfo) string {
	if s.Description != "" && s.Description != "Heartbeat bootstrap session" {
		return s.Description
	}
	if s.Status == "active" {
		return "Active session"
	}
	return "Last seen " + s.StartedAt
}

func formatAgentName(agentType, agentID string) string {
	switch agentType {
	case "claude-code":
		return "Claude Code"
	case "gemini":
		return "Gemini CLI"
	case "codex":
		return "Codex"
	default:
		if agentType != "" {
			return agentType
		}
		return agentID
	}
}

func buildDescription(p *PresenceInfo) string {
	parts := []string{}
	if p.CurrentTask != "" {
		parts = append(parts, p.CurrentTask)
	}
	if p.Branch != "" {
		parts = append(parts, "on "+p.Branch)
	}
	if len(parts) == 0 {
		return fmt.Sprintf("CLI agent (%s)", p.Status)
	}
	return strings.Join(parts, " ")
}
