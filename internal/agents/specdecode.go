package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// AgentBuilderConfig configures the Agent Builder backed by flexinfer/LiteLLM
type AgentBuilderConfig struct {
	Model      string `json:"model"`       // Model to use via LiteLLM (auto-discovered from flexinfer)
	LiteLLMURL string `json:"-"`           // Base URL for LiteLLM
	LiteLLMKey string `json:"-"`           // API key for LiteLLM
}

// AgentBuilderResult is the output of an agent builder chat
type AgentBuilderResult struct {
	Result      string `json:"result"`
	Model       string `json:"model"`
	TotalTokens int64  `json:"total_tokens"`
	LatencyMs   int64  `json:"latency_ms"`
}

// chatRequest represents an OpenAI-compatible chat request
type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
	Temperature float64       `json:"temperature,omitempty"`
	Stream      bool          `json:"stream"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		TotalTokens int64 `json:"total_tokens"`
	} `json:"usage"`
}

// VectorDBConfig for RAG integration
type VectorDBConfig struct {
	QdrantURL   string `json:"qdrant_url,omitempty"`
	WeaviateURL string `json:"weaviate_url,omitempty"`
	Collection  string `json:"collection,omitempty"`
}

// AgentBuilderAgent is the built-in agent for creating and configuring agents.
// It uses models managed by the flexinfer controller via LiteLLM.
type AgentBuilderAgent struct {
	config   AgentBuilderConfig
	vectorDB VectorDBConfig
	client   *http.Client
}

// NewAgentBuilderAgent creates the agent builder agent
func NewAgentBuilderAgent(litellmURL, litellmKey string, vectorDB VectorDBConfig) *AgentBuilderAgent {
	cfg := AgentBuilderConfig{
		LiteLLMURL: litellmURL,
		LiteLLMKey: litellmKey,
	}
	return &AgentBuilderAgent{
		config:   cfg,
		vectorDB: vectorDB,
		client: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
}

// callLLM makes a chat completion request to LiteLLM
func (a *AgentBuilderAgent) callLLM(ctx context.Context, model string, messages []chatMessage) (string, int64, error) {
	reqBody := chatRequest{
		Model:       model,
		Messages:    messages,
		Temperature: 0.7,
		Stream:      false,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", 0, fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.config.LiteLLMURL+"/chat/completions", strings.NewReader(string(body)))
	if err != nil {
		return "", 0, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if a.config.LiteLLMKey != "" {
		req.Header.Set("Authorization", "Bearer "+a.config.LiteLLMKey)
	}

	resp, err := a.client.Do(req)
	if err != nil {
		return "", 0, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return "", 0, fmt.Errorf("LLM returned status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var chatResp chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return "", 0, fmt.Errorf("decode response: %w", err)
	}

	if len(chatResp.Choices) == 0 {
		return "", 0, fmt.Errorf("no choices in response")
	}

	return chatResp.Choices[0].Message.Content, chatResp.Usage.TotalTokens, nil
}

// AgentBuilderRequest is the input to the agent builder
type AgentBuilderRequest struct {
	Query    string         `json:"query"`
	Context  map[string]any `json:"context,omitempty"`
	Model    string         `json:"model,omitempty"` // Override model selection
	UseRAG   bool           `json:"use_rag,omitempty"`
	RAGQuery string         `json:"rag_query,omitempty"`
}

// AgentBuilderResponse is the output from the agent builder
type AgentBuilderResponse struct {
	Response    string           `json:"response"`
	AgentConfig *Agent           `json:"agent_config,omitempty"`
	RAGResults  []map[string]any `json:"rag_results,omitempty"`
	Metadata    map[string]any   `json:"metadata,omitempty"`
}

// Process handles a request to the agent builder
func (a *AgentBuilderAgent) Process(ctx context.Context, req *AgentBuilderRequest) (*AgentBuilderResponse, error) {
	systemPrompt := `You are an AI Agent Builder assistant for the FlexDeck platform. You help users:
1. Design and configure AI agents for various tasks
2. Choose appropriate models from the FlexInfer-managed deployment
3. Set up RAG pipelines using Qdrant or Weaviate vector databases
4. Integrate agents with Kubernetes-native workflows via FlexInfer CRDs

Models are managed by the FlexInfer controller (flexinfer.ai/v1alpha2 Model CRDs) and
served through LiteLLM as an OpenAI-compatible gateway. FlexInfer handles GPU scheduling,
shared GPU groups, serverless scaling, and model caching automatically.

Vector DBs available:
- Qdrant: Fast similarity search, good for embeddings
- Weaviate: Schema-based, good for structured data

When asked to create an agent, output a JSON configuration block.
Be helpful, technical, and specific.`

	// Select model: use request override, config default, or fallback
	model := req.Model
	if model == "" {
		model = a.config.Model
	}
	if model == "" {
		model = "default" // LiteLLM routes to the configured default
	}

	messages := []chatMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: req.Query},
	}

	start := time.Now()
	content, tokens, err := a.callLLM(ctx, model, messages)
	if err != nil {
		return nil, fmt.Errorf("agent builder chat failed: %w", err)
	}
	latency := time.Since(start).Milliseconds()

	response := &AgentBuilderResponse{
		Response: content,
		Metadata: map[string]any{
			"model":        model,
			"total_tokens": tokens,
			"latency_ms":   latency,
		},
	}

	// Try to extract agent config if present in response
	if strings.Contains(content, `"id"`) && strings.Contains(content, `"url"`) {
		start := strings.Index(content, "{")
		end := strings.LastIndex(content, "}")
		if start != -1 && end > start {
			jsonStr := content[start : end+1]
			var agentCfg Agent
			if err := json.Unmarshal([]byte(jsonStr), &agentCfg); err == nil {
				response.AgentConfig = &agentCfg
			}
		}
	}

	return response, nil
}

// GetDefaultAgentBuilder returns the default agent builder info
func GetDefaultAgentBuilder() *Agent {
	return &Agent{
		ID:          "agent-builder",
		Name:        "Agent Builder",
		Description: "AI-powered assistant for designing and configuring agents. Uses FlexInfer-managed models via LiteLLM for inference.",
		Type:        AgentTypeCustom,
		URL:         "internal://agent-builder",
		Tags:        []string{"built-in", "agent-design", "flexinfer"},
		Metadata: map[string]any{
			"backend":    "flexinfer",
			"gateway":    "litellm",
			"vector_dbs": []string{"qdrant", "weaviate"},
		},
		Status: AgentStatusHealthy,
	}
}
