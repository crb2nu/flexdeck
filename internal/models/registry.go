package models

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
)

// ModelSource represents where the model comes from
type ModelSource string

const (
	SourceHuggingFace ModelSource = "huggingface"
	SourceCivitAI     ModelSource = "civitai"
	SourceLocal       ModelSource = "local"
)

// ModelType categorizes the model
type ModelType string

const (
	TypeLLM       ModelType = "llm"
	TypeDiffusion ModelType = "diffusion"
	TypeEmbedding ModelType = "embedding"
	TypeOther     ModelType = "other"
)

// DownloadStatus tracks download progress
type DownloadStatus string

const (
	StatusPending     DownloadStatus = "pending"
	StatusDownloading DownloadStatus = "downloading"
	StatusCompleted   DownloadStatus = "completed"
	StatusFailed      DownloadStatus = "failed"
)

// DeploymentStatus tracks deployment state
type DeploymentStatus string

const (
	DeploymentNone     DeploymentStatus = "none"
	DeploymentPending  DeploymentStatus = "pending"
	DeploymentDeployed DeploymentStatus = "deployed"
	DeploymentStopped  DeploymentStatus = "stopped"
	DeploymentFailed   DeploymentStatus = "failed"
)

// Model represents a registered model
type Model struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	Source      ModelSource `json:"source"`
	SourceID    string      `json:"source_id"`  // HF repo ID or CivitAI model ID
	SourceURL   string      `json:"source_url"` // Original URL
	Type        ModelType   `json:"type"`
	Description string      `json:"description"`
	Tags        []string    `json:"tags"`
	Size        int64       `json:"size"`       // Size in bytes
	LocalPath   string      `json:"local_path"` // Path to downloaded files

	// Download tracking
	DownloadStatus   DownloadStatus `json:"download_status"`
	DownloadProgress float64        `json:"download_progress"` // 0-100
	DownloadError    string         `json:"download_error,omitempty"`
	DownloadedAt     *time.Time     `json:"downloaded_at,omitempty"`

	// Deployment tracking
	DeploymentStatus DeploymentStatus `json:"deployment_status"`
	DeploymentName   string           `json:"deployment_name,omitempty"`
	DeploymentNS     string           `json:"deployment_ns,omitempty"`
	Replicas         int              `json:"replicas"`

	// Metadata
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Source-specific metadata
	Metadata map[string]any `json:"metadata,omitempty"`
}

// Registry manages model registration and persistence
type Registry struct {
	mu       sync.RWMutex
	models   map[string]*Model
	filePath string
}

// NewRegistry creates a new model registry
func NewRegistry(cfg config.ModelsConfig) (*Registry, error) {
	r := &Registry{
		models:   make(map[string]*Model),
		filePath: cfg.RegistryPath,
	}

	// Load existing registry if it exists
	if err := r.load(); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to load registry: %w", err)
	}

	return r, nil
}

// load reads the registry from disk
func (r *Registry) load() error {
	data, err := os.ReadFile(r.filePath)
	if err != nil {
		return err
	}

	var models []*Model
	if err := json.Unmarshal(data, &models); err != nil {
		return fmt.Errorf("failed to parse registry: %w", err)
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	r.models = make(map[string]*Model)
	for _, m := range models {
		r.models[m.ID] = m
	}

	return nil
}

// save writes the registry to disk
// Note: caller must hold the lock (read or write)
func (r *Registry) save() error {
	models := make([]*Model, 0, len(r.models))
	for _, m := range r.models {
		models = append(models, m)
	}

	data, err := json.MarshalIndent(models, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal registry: %w", err)
	}

	// Ensure directory exists
	dir := filepath.Dir(r.filePath)
	if dir != "" && dir != "." {
		os.MkdirAll(dir, 0755)
	}

	return os.WriteFile(r.filePath, data, 0644)
}

// List returns all registered models
func (r *Registry) List() []*Model {
	r.mu.RLock()
	defer r.mu.RUnlock()

	models := make([]*Model, 0, len(r.models))
	for _, m := range r.models {
		models = append(models, m)
	}
	return models
}

// Get retrieves a model by ID
func (r *Registry) Get(id string) (*Model, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	m, ok := r.models[id]
	if !ok {
		return nil, fmt.Errorf("model not found: %s", id)
	}
	return m, nil
}

// Register adds a new model to the registry
func (r *Registry) Register(m *Model) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.models[m.ID]; exists {
		return fmt.Errorf("model already exists: %s", m.ID)
	}

	now := time.Now()
	m.CreatedAt = now
	m.UpdatedAt = now

	if m.DownloadStatus == "" {
		m.DownloadStatus = StatusPending
	}
	if m.DeploymentStatus == "" {
		m.DeploymentStatus = DeploymentNone
	}

	r.models[m.ID] = m

	// Persist to disk (best effort - don't fail if persistence unavailable)
	// This allows K8s-discovered models to be available in memory even without storage
	if err := r.save(); err != nil {
		// Keep model in memory; it will be available until restart.
		slog.Warn("models registry: failed to persist (continuing with in-memory registry)",
			"error", err,
			"model_id", m.ID,
		)
	}

	return nil
}

// Update modifies an existing model
func (r *Registry) Update(m *Model) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.models[m.ID]; !exists {
		return fmt.Errorf("model not found: %s", m.ID)
	}

	m.UpdatedAt = time.Now()
	r.models[m.ID] = m

	return r.save()
}

// Delete removes a model from the registry
func (r *Registry) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.models[id]; !exists {
		return fmt.Errorf("model not found: %s", id)
	}

	delete(r.models, id)
	return r.save()
}

// UpdateDownloadStatus updates download progress for a model
func (r *Registry) UpdateDownloadStatus(id string, status DownloadStatus, progress float64, errMsg string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	m, ok := r.models[id]
	if !ok {
		return fmt.Errorf("model not found: %s", id)
	}

	m.DownloadStatus = status
	m.DownloadProgress = progress
	m.DownloadError = errMsg
	m.UpdatedAt = time.Now()

	if status == StatusCompleted {
		now := time.Now()
		m.DownloadedAt = &now
	}

	return r.save()
}

// UpdateDeploymentStatus updates deployment status for a model
func (r *Registry) UpdateDeploymentStatus(id string, status DeploymentStatus, deploymentName, ns string, replicas int) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	m, ok := r.models[id]
	if !ok {
		return fmt.Errorf("model not found: %s", id)
	}

	m.DeploymentStatus = status
	m.DeploymentName = deploymentName
	m.DeploymentNS = ns
	m.Replicas = replicas
	m.UpdatedAt = time.Now()

	return r.save()
}

// FindBySource finds models by source type
func (r *Registry) FindBySource(source ModelSource) []*Model {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var models []*Model
	for _, m := range r.models {
		if m.Source == source {
			models = append(models, m)
		}
	}
	return models
}

// FindByType finds models by type
func (r *Registry) FindByType(modelType ModelType) []*Model {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var models []*Model
	for _, m := range r.models {
		if m.Type == modelType {
			models = append(models, m)
		}
	}
	return models
}
