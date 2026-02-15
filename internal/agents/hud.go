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

// HUDClient is a thin HTTP client for the loom-core HUD REST API
type HUDClient struct {
	url        string
	httpClient *http.Client
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

// GetPresence fetches agent presence from the HUD API
func (c *HUDClient) GetPresence(ctx context.Context) (*PresenceResponse, error) {
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

// GetSessions fetches sessions from the HUD API
func (c *HUDClient) GetSessions(ctx context.Context) (*SessionsResponse, error) {
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
