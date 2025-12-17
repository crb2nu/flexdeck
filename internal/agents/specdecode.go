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

// SpecDecodeConfig configures the speculative decode workflow
type SpecDecodeConfig struct {
	DraftModel    string `json:"draft_model"`    // Fast model for drafting (e.g., qwen2.5-7b)
	VerifyModel   string `json:"verify_model"`   // Agent model for verification (e.g., nemotron-8b)
	MaxIterations int    `json:"max_iterations"` // Max revision cycles
	LiteLLMURL    string `json:"-"`              // Base URL for LiteLLM
	LiteLLMKey    string `json:"-"`              // API key for LiteLLM
}

// SpecDecodeState tracks the state of a speculative decode workflow
type SpecDecodeState struct {
	Task         string `json:"task"`
	SystemPrompt string `json:"system_prompt,omitempty"`
	Draft        string `json:"draft"`
	Feedback     string `json:"feedback"`
	Iteration    int    `json:"iteration"`
	Result       string `json:"result"`
	Approved     bool   `json:"approved"`
}

// SpecDecodeResult is the output of a speculative decode run
type SpecDecodeResult struct {
	Result       string `json:"result"`
	Iterations   int    `json:"iterations"`
	Approved     bool   `json:"approved"`
	TotalTokens  int64  `json:"total_tokens"`
	TotalLatency int64  `json:"total_latency_ms"`
}

// SpecDecodeExecutor runs speculative decode workflows
type SpecDecodeExecutor struct {
	config     SpecDecodeConfig
	httpClient *http.Client
}

// NewSpecDecodeExecutor creates a new executor
func NewSpecDecodeExecutor(cfg SpecDecodeConfig) *SpecDecodeExecutor {
	if cfg.MaxIterations <= 0 {
		cfg.MaxIterations = 2
	}
	if cfg.DraftModel == "" {
		cfg.DraftModel = "qwen2.5-7b"
	}
	if cfg.VerifyModel == "" {
		cfg.VerifyModel = "nemotron-8b"
	}
	return &SpecDecodeExecutor{
		config: cfg,
		httpClient: &http.Client{
			Timeout: 120 * time.Second,
		},
	}
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

// callLLM makes a chat completion request to LiteLLM
func (e *SpecDecodeExecutor) callLLM(ctx context.Context, model string, messages []chatMessage) (string, int64, error) {
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

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.config.LiteLLMURL+"/chat/completions", strings.NewReader(string(body)))
	if err != nil {
		return "", 0, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if e.config.LiteLLMKey != "" {
		req.Header.Set("Authorization", "Bearer "+e.config.LiteLLMKey)
	}

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return "", 0, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

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

// generateDraft creates or revises a draft using the fast model
func (e *SpecDecodeExecutor) generateDraft(ctx context.Context, state *SpecDecodeState) (string, int64, error) {
	systemPrompt := state.SystemPrompt
	if systemPrompt == "" {
		systemPrompt = "You are a helpful assistant. Provide clear, accurate, and well-structured responses."
	}

	var userContent string
	if state.Feedback != "" {
		// Revision mode
		userContent = fmt.Sprintf(
			"Original task: %s\n\nYour previous draft:\n%s\n\nFeedback from reviewer:\n%s\n\nPlease revise your response to address the feedback.",
			state.Task, state.Draft, state.Feedback,
		)
	} else {
		// Initial draft
		userContent = state.Task
	}

	messages := []chatMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userContent},
	}

	return e.callLLM(ctx, e.config.DraftModel, messages)
}

// verifyDraft checks the draft quality using the agent model
func (e *SpecDecodeExecutor) verifyDraft(ctx context.Context, state *SpecDecodeState) (bool, string, int64, error) {
	systemPrompt := `You are a quality reviewer. Evaluate the draft response for:
1. Accuracy and correctness
2. Completeness
3. Clarity and structure
4. Relevance to the task

If the draft is good quality, respond with exactly: APPROVED

If the draft needs improvement, respond with: REVISE: <your concise feedback>

Be constructive but concise.`

	userContent := fmt.Sprintf("Task: %s\n\nDraft Response:\n%s", state.Task, state.Draft)

	messages := []chatMessage{
		{Role: "system", Content: systemPrompt},
		{Role: "user", Content: userContent},
	}

	content, tokens, err := e.callLLM(ctx, e.config.VerifyModel, messages)
	if err != nil {
		return false, "", tokens, err
	}

	content = strings.TrimSpace(content)

	if strings.Contains(strings.ToUpper(content), "APPROVED") {
		return true, "", tokens, nil
	}

	// Extract feedback
	feedback := content
	if idx := strings.Index(strings.ToUpper(content), "REVISE:"); idx != -1 {
		feedback = strings.TrimSpace(content[idx+7:])
	}

	return false, feedback, tokens, nil
}

// Execute runs the speculative decode workflow
func (e *SpecDecodeExecutor) Execute(ctx context.Context, task string, systemPrompt string) (*SpecDecodeResult, error) {
	state := &SpecDecodeState{
		Task:         task,
		SystemPrompt: systemPrompt,
		Iteration:    0,
	}

	var totalTokens int64
	start := time.Now()

	for state.Iteration < e.config.MaxIterations {
		state.Iteration++

		// Generate draft
		draft, draftTokens, err := e.generateDraft(ctx, state)
		if err != nil {
			return nil, fmt.Errorf("draft generation failed (iteration %d): %w", state.Iteration, err)
		}
		state.Draft = draft
		totalTokens += draftTokens

		// Verify draft
		approved, feedback, verifyTokens, err := e.verifyDraft(ctx, state)
		if err != nil {
			// On verification error, accept current draft
			state.Approved = false
			state.Result = state.Draft
			break
		}
		totalTokens += verifyTokens

		if approved {
			state.Approved = true
			state.Result = state.Draft
			break
		}

		state.Feedback = feedback
	}

	// If we exhausted iterations without approval, use last draft
	if state.Result == "" {
		state.Result = state.Draft
	}

	return &SpecDecodeResult{
		Result:       state.Result,
		Iterations:   state.Iteration,
		Approved:     state.Approved,
		TotalTokens:  totalTokens,
		TotalLatency: time.Since(start).Milliseconds(),
	}, nil
}

// VectorDBConfig for RAG integration
type VectorDBConfig struct {
	QdrantURL   string `json:"qdrant_url,omitempty"`
	WeaviateURL string `json:"weaviate_url,omitempty"`
	Collection  string `json:"collection,omitempty"`
}

// BuiltInAgentConfig defines configuration for built-in agents
type BuiltInAgentConfig struct {
	SpecDecode SpecDecodeConfig `json:"spec_decode"`
	VectorDB   VectorDBConfig   `json:"vector_db"`
}

// AgentBuilderAgent is the built-in agent for creating and configuring agents
type AgentBuilderAgent struct {
	specDecoder *SpecDecodeExecutor
	vectorDB    VectorDBConfig
}

// NewAgentBuilderAgent creates the agent builder agent
func NewAgentBuilderAgent(litellmURL, litellmKey string, vectorDB VectorDBConfig) *AgentBuilderAgent {
	cfg := SpecDecodeConfig{
		DraftModel:    "qwen2.5-7b",
		VerifyModel:   "nemotron-8b",
		MaxIterations: 2,
		LiteLLMURL:    litellmURL,
		LiteLLMKey:    litellmKey,
	}
	return &AgentBuilderAgent{
		specDecoder: NewSpecDecodeExecutor(cfg),
		vectorDB:    vectorDB,
	}
}

// AgentBuilderRequest is the input to the agent builder
type AgentBuilderRequest struct {
	Query    string         `json:"query"`
	Context  map[string]any `json:"context,omitempty"`
	UseRAG   bool           `json:"use_rag,omitempty"`
	RAGQuery string         `json:"rag_query,omitempty"`
}

// AgentBuilderResponse is the output from the agent builder
type AgentBuilderResponse struct {
	Response       string            `json:"response"`
	AgentConfig    *Agent            `json:"agent_config,omitempty"`
	RAGResults     []map[string]any  `json:"rag_results,omitempty"`
	SpecDecodeInfo *SpecDecodeResult `json:"spec_decode_info,omitempty"`
	Metadata       map[string]any    `json:"metadata,omitempty"`
}

// Process handles a request to the agent builder
func (a *AgentBuilderAgent) Process(ctx context.Context, req *AgentBuilderRequest) (*AgentBuilderResponse, error) {
	systemPrompt := `You are an AI Agent Builder assistant. You help users:
1. Design and configure AI agents for various tasks
2. Choose appropriate models from the available LiteLLM deployment
3. Set up RAG pipelines using Qdrant or Weaviate vector databases
4. Configure speculative decoding for faster, high-quality responses
5. Integrate agents with Kubernetes-native workflows

Available models via LiteLLM:
- qwen2.5-7b: Fast general purpose (good for drafts)
- nemotron-8b: High quality reasoning (good for verification)
- llama3-70b: Large context, complex tasks
- mistral-7b: Efficient, multilingual

Vector DBs available:
- Qdrant: Fast similarity search, good for embeddings
- Weaviate: Schema-based, good for structured data

When asked to create an agent, output a JSON configuration block.
Be helpful, technical, and specific.`

	// Use speculative decoding for the response
	result, err := a.specDecoder.Execute(ctx, req.Query, systemPrompt)
	if err != nil {
		return nil, fmt.Errorf("spec decode failed: %w", err)
	}

	response := &AgentBuilderResponse{
		Response:       result.Result,
		SpecDecodeInfo: result,
		Metadata: map[string]any{
			"iterations":   result.Iterations,
			"approved":     result.Approved,
			"total_tokens": result.TotalTokens,
			"latency_ms":   result.TotalLatency,
		},
	}

	// Try to extract agent config if present in response
	if strings.Contains(result.Result, `"id"`) && strings.Contains(result.Result, `"url"`) {
		// Attempt to parse JSON from response
		start := strings.Index(result.Result, "{")
		end := strings.LastIndex(result.Result, "}")
		if start != -1 && end > start {
			jsonStr := result.Result[start : end+1]
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
		Description: "AI-powered assistant for designing and configuring agents. Uses speculative decoding with local LiteLLM models for fast, high-quality responses.",
		Type:        AgentTypeCustom,
		URL:         "internal://agent-builder",
		Tags:        []string{"built-in", "agent-design", "spec-decode"},
		Metadata: map[string]any{
			"spec_decode":  true,
			"draft_model":  "qwen2.5-7b",
			"verify_model": "nemotron-8b",
			"vector_dbs":   []string{"qdrant", "weaviate"},
		},
		Status: AgentStatusHealthy,
	}
}
