package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// ExternalAgentType identifies the type of external agent framework
type ExternalAgentType string

const (
	ExternalAgentTypeDify       ExternalAgentType = "dify"
	ExternalAgentTypeLangGraph  ExternalAgentType = "langgraph"
	ExternalAgentTypeAgentScope ExternalAgentType = "agentscope"
)

// ExternalAgentConfig holds configuration for external agent frameworks
type ExternalAgentConfig struct {
	Type   ExternalAgentType `json:"type"`
	URL    string            `json:"url"`
	APIKey string            `json:"api_key,omitempty"`
}

// ExternalAgentClient provides a unified interface to external agent frameworks
type ExternalAgentClient struct {
	httpClient *http.Client
	configs    map[ExternalAgentType]ExternalAgentConfig
}

// NewExternalAgentClient creates a new client for external agent frameworks
func NewExternalAgentClient(difyURL, difyKey, langGraphURL, agentScopeURL string) *ExternalAgentClient {
	configs := make(map[ExternalAgentType]ExternalAgentConfig)

	if difyURL != "" {
		configs[ExternalAgentTypeDify] = ExternalAgentConfig{
			Type:   ExternalAgentTypeDify,
			URL:    difyURL,
			APIKey: difyKey,
		}
	}

	if langGraphURL != "" {
		configs[ExternalAgentTypeLangGraph] = ExternalAgentConfig{
			Type: ExternalAgentTypeLangGraph,
			URL:  langGraphURL,
		}
	}

	if agentScopeURL != "" {
		configs[ExternalAgentTypeAgentScope] = ExternalAgentConfig{
			Type: ExternalAgentTypeAgentScope,
			URL:  agentScopeURL,
		}
	}

	return &ExternalAgentClient{
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
		configs: configs,
	}
}

// AvailableFrameworks returns list of configured frameworks
func (c *ExternalAgentClient) AvailableFrameworks() []ExternalAgentType {
	result := make([]ExternalAgentType, 0, len(c.configs))
	for t := range c.configs {
		result = append(result, t)
	}
	return result
}

// DifyChatRequest represents a Dify chat API request
type DifyChatRequest struct {
	Query          string            `json:"query"`
	User           string            `json:"user"`
	ConversationID string            `json:"conversation_id,omitempty"`
	Inputs         map[string]string `json:"inputs,omitempty"`
	ResponseMode   string            `json:"response_mode"` // "blocking" or "streaming"
}

// DifyChatResponse represents a Dify chat API response
type DifyChatResponse struct {
	Answer         string `json:"answer"`
	ConversationID string `json:"conversation_id"`
	MessageID      string `json:"message_id"`
	CreatedAt      int64  `json:"created_at"`
	Metadata       struct {
		Usage struct {
			TotalTokens int `json:"total_tokens"`
		} `json:"usage"`
	} `json:"metadata"`
}

// DifyChat sends a chat request to a Dify app
func (c *ExternalAgentClient) DifyChat(ctx context.Context, appID string, req *DifyChatRequest) (*DifyChatResponse, error) {
	cfg, ok := c.configs[ExternalAgentTypeDify]
	if !ok {
		return nil, fmt.Errorf("dify not configured")
	}

	// Dify chat endpoint
	url := fmt.Sprintf("%s/v1/chat-messages", cfg.URL)

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if cfg.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("dify returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var result DifyChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}

// DifyListApps lists available Dify applications
func (c *ExternalAgentClient) DifyListApps(ctx context.Context) ([]map[string]any, error) {
	cfg, ok := c.configs[ExternalAgentTypeDify]
	if !ok {
		return nil, fmt.Errorf("dify not configured")
	}

	url := fmt.Sprintf("%s/apps", cfg.URL)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	if cfg.APIKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+cfg.APIKey)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("dify returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var result struct {
		Data []map[string]any `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return result.Data, nil
}

// LangGraphRunRequest represents a LangGraph run request
type LangGraphRunRequest struct {
	GraphID     string         `json:"graph_id"`
	Input       map[string]any `json:"input"`
	Config      map[string]any `json:"config,omitempty"`
	ThreadID    string         `json:"thread_id,omitempty"`
	Assistantid string         `json:"assistant_id,omitempty"`
}

// LangGraphRunResponse represents a LangGraph run response
type LangGraphRunResponse struct {
	RunID    string         `json:"run_id"`
	ThreadID string         `json:"thread_id"`
	Output   map[string]any `json:"output"`
	Status   string         `json:"status"`
}

// LangGraphRun executes a LangGraph workflow
func (c *ExternalAgentClient) LangGraphRun(ctx context.Context, req *LangGraphRunRequest) (*LangGraphRunResponse, error) {
	cfg, ok := c.configs[ExternalAgentTypeLangGraph]
	if !ok {
		return nil, fmt.Errorf("langgraph not configured")
	}

	// LangGraph API endpoint
	url := fmt.Sprintf("%s/runs", cfg.URL)

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("langgraph returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var result LangGraphRunResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return &result, nil
}

// LangGraphListGraphs lists available LangGraph workflows
func (c *ExternalAgentClient) LangGraphListGraphs(ctx context.Context) ([]map[string]any, error) {
	cfg, ok := c.configs[ExternalAgentTypeLangGraph]
	if !ok {
		return nil, fmt.Errorf("langgraph not configured")
	}

	url := fmt.Sprintf("%s/assistants", cfg.URL)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("langgraph returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var result []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	return result, nil
}

// HealthCheck checks health of an external agent framework
func (c *ExternalAgentClient) HealthCheck(ctx context.Context, agentType ExternalAgentType) (bool, error) {
	cfg, ok := c.configs[agentType]
	if !ok {
		return false, fmt.Errorf("%s not configured", agentType)
	}

	var healthURL string
	switch agentType {
	case ExternalAgentTypeDify:
		healthURL = cfg.URL + "/health"
	case ExternalAgentTypeLangGraph:
		healthURL = cfg.URL + "/health"
	case ExternalAgentTypeAgentScope:
		healthURL = cfg.URL + "/health"
	default:
		healthURL = cfg.URL + "/health"
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, healthURL, nil)
	if err != nil {
		return false, nil
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return false, nil
	}
	defer resp.Body.Close()

	return resp.StatusCode == http.StatusOK, nil
}

// GetBuiltInAgents returns Agent definitions for built-in external framework agents
func (c *ExternalAgentClient) GetBuiltInAgents() []*Agent {
	agents := []*Agent{}

	if _, ok := c.configs[ExternalAgentTypeDify]; ok {
		agents = append(agents, &Agent{
			ID:          "dify-workflows",
			Name:        "Dify Workflows",
			Description: "Visual AI workflow builder with agents, RAG, and tool integration. Create complex AI pipelines without code.",
			Type:        AgentTypeCustom,
			URL:         c.configs[ExternalAgentTypeDify].URL,
			Tags:        []string{"built-in", "workflows", "rag", "visual"},
			Metadata: map[string]any{
				"framework": "dify",
				"features":  []string{"visual-builder", "rag", "agents", "tools"},
			},
			Status: AgentStatusUnknown,
		})
	}

	if _, ok := c.configs[ExternalAgentTypeLangGraph]; ok {
		agents = append(agents, &Agent{
			ID:          "langgraph-agents",
			Name:        "LangGraph Agents",
			Description: "Stateful, graph-based agent workflows with persistence and human-in-the-loop support.",
			Type:        AgentTypeCustom,
			URL:         c.configs[ExternalAgentTypeLangGraph].URL,
			Tags:        []string{"built-in", "graphs", "stateful", "workflows"},
			Metadata: map[string]any{
				"framework": "langgraph",
				"features":  []string{"stateful", "graphs", "persistence", "human-in-loop"},
			},
			Status: AgentStatusUnknown,
		})
	}

	if _, ok := c.configs[ExternalAgentTypeAgentScope]; ok {
		agents = append(agents, &Agent{
			ID:          "agentscope-sandbox",
			Name:        "AgentScope Sandbox",
			Description: "Multi-agent sandbox for executing and testing AI agent workflows safely.",
			Type:        AgentTypeCustom,
			URL:         c.configs[ExternalAgentTypeAgentScope].URL,
			Tags:        []string{"built-in", "sandbox", "multi-agent"},
			Metadata: map[string]any{
				"framework": "agentscope",
				"features":  []string{"sandbox", "multi-agent", "safe-execution"},
			},
			Status: AgentStatusUnknown,
		})
	}

	return agents
}
