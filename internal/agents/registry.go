package agents

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
)

// AgentType represents the type of agent
type AgentType string

const (
	AgentTypeLangGraph AgentType = "langgraph"
	AgentTypeCustom    AgentType = "custom"
)

// AgentStatus represents the health status of an agent
type AgentStatus string

const (
	AgentStatusUnknown   AgentStatus = "unknown"
	AgentStatusHealthy   AgentStatus = "healthy"
	AgentStatusUnhealthy AgentStatus = "unhealthy"
)

// Agent represents a registered agent
type Agent struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Type        AgentType      `json:"type"`
	URL         string         `json:"url"`
	APIKey      string         `json:"api_key,omitempty"`
	Model       string         `json:"model,omitempty"`
	Tags        []string       `json:"tags"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	Status      AgentStatus    `json:"status"`
	LastChecked *time.Time     `json:"last_checked,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

// AgentUsage tracks usage statistics for an agent
type AgentUsage struct {
	AgentID        string    `json:"agent_id"`
	RequestCount   int64     `json:"request_count"`
	TotalTokens    int64     `json:"total_tokens"`
	TotalLatencyMs int64     `json:"total_latency_ms"`
	LastUsed       time.Time `json:"last_used"`
}

// Registry manages agent registration and storage
type Registry struct {
	mu         sync.RWMutex
	agents     map[string]*Agent
	usage      map[string]*AgentUsage
	path       string
	httpClient *http.Client
}

// NewRegistry creates a new agent registry
func NewRegistry(cfg config.AgentsConfig) (*Registry, error) {
	r := &Registry{
		agents: make(map[string]*Agent),
		usage:  make(map[string]*AgentUsage),
		path:   cfg.RegistryPath,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}

	if err := r.ensureDir(); err != nil {
		return nil, err
	}

	if err := r.load(); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("load registry: %w", err)
	}

	return r, nil
}

func (r *Registry) ensureDir() error {
	dir := filepath.Dir(r.path)
	return os.MkdirAll(dir, 0755)
}

func (r *Registry) load() error {
	data, err := os.ReadFile(r.path)
	if err != nil {
		return err
	}

	var agents []*Agent
	if err := json.Unmarshal(data, &agents); err != nil {
		return fmt.Errorf("unmarshal agents: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	for _, a := range agents {
		r.agents[a.ID] = a
	}

	return nil
}

// save writes the registry to disk
// Note: caller must hold the lock (read or write)
func (r *Registry) save() error {
	agents := make([]*Agent, 0, len(r.agents))
	for _, a := range r.agents {
		agents = append(agents, a)
	}

	data, err := json.MarshalIndent(agents, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal agents: %w", err)
	}

	return os.WriteFile(r.path, data, 0644)
}

// List returns all registered agents
func (r *Registry) List() []*Agent {
	r.mu.RLock()
	defer r.mu.RUnlock()

	agents := make([]*Agent, 0, len(r.agents))
	for _, a := range r.agents {
		agents = append(agents, a)
	}
	return agents
}

// Get returns an agent by ID
func (r *Registry) Get(id string) (*Agent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	agent, ok := r.agents[id]
	if !ok {
		return nil, fmt.Errorf("agent not found: %s", id)
	}
	return agent, nil
}

// Register adds a new agent to the registry
func (r *Registry) Register(agent *Agent) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.agents[agent.ID]; exists {
		return fmt.Errorf("agent already exists: %s", agent.ID)
	}

	now := time.Now()
	agent.CreatedAt = now
	agent.UpdatedAt = now
	agent.Status = AgentStatusUnknown

	r.agents[agent.ID] = agent

	return r.save()
}

// Update updates an existing agent
func (r *Registry) Update(agent *Agent) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	existing, ok := r.agents[agent.ID]
	if !ok {
		return fmt.Errorf("agent not found: %s", agent.ID)
	}

	agent.CreatedAt = existing.CreatedAt
	agent.UpdatedAt = time.Now()
	r.agents[agent.ID] = agent

	return r.save()
}

// Delete removes an agent from the registry
func (r *Registry) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.agents[id]; !ok {
		return fmt.Errorf("agent not found: %s", id)
	}

	delete(r.agents, id)
	delete(r.usage, id)

	return r.save()
}

// CheckHealth checks the health of an agent
func (r *Registry) CheckHealth(ctx context.Context, id string) (AgentStatus, error) {
	agent, err := r.Get(id)
	if err != nil {
		return AgentStatusUnknown, err
	}

	// Try to hit the health endpoint
	healthURL := agent.URL + "/health"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, healthURL, nil)
	if err != nil {
		return AgentStatusUnhealthy, nil
	}

	if agent.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+agent.APIKey)
	}

	resp, err := r.httpClient.Do(req)
	if err != nil {
		r.updateStatus(id, AgentStatusUnhealthy)
		return AgentStatusUnhealthy, nil
	}
	defer func() { _ = resp.Body.Close() }()

	status := AgentStatusUnhealthy
	if resp.StatusCode == http.StatusOK {
		status = AgentStatusHealthy
	}

	r.updateStatus(id, status)
	return status, nil
}

func (r *Registry) updateStatus(id string, status AgentStatus) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if agent, ok := r.agents[id]; ok {
		now := time.Now()
		agent.Status = status
		agent.LastChecked = &now
	}
}

// CheckAllHealth checks health of all agents
func (r *Registry) CheckAllHealth(ctx context.Context) map[string]AgentStatus {
	agents := r.List()
	results := make(map[string]AgentStatus)

	for _, agent := range agents {
		status, _ := r.CheckHealth(ctx, agent.ID)
		results[agent.ID] = status
	}

	return results
}

// RecordUsage records usage for an agent
func (r *Registry) RecordUsage(id string, tokens int64, latencyMs int64) {
	r.mu.Lock()
	defer r.mu.Unlock()

	usage, ok := r.usage[id]
	if !ok {
		usage = &AgentUsage{AgentID: id}
		r.usage[id] = usage
	}

	usage.RequestCount++
	usage.TotalTokens += tokens
	usage.TotalLatencyMs += latencyMs
	usage.LastUsed = time.Now()
}

// GetUsage returns usage statistics for an agent
func (r *Registry) GetUsage(id string) (*AgentUsage, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	usage, ok := r.usage[id]
	if !ok {
		return &AgentUsage{AgentID: id}, nil
	}
	return usage, nil
}
