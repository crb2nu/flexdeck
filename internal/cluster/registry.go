package cluster

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/google/uuid"
)

// Registry manages cluster registration with JSON file persistence.
type Registry struct {
	mu       sync.RWMutex
	clusters map[string]*ClusterInfo
	filePath string
}

// NewRegistry creates a new cluster registry. If the registry file is empty,
// auto-registers the current K8s config as the default cluster.
func NewRegistry(cfg config.MultiClusterConfig, defaultK8s config.K8sConfig) (*Registry, error) {
	r := &Registry{
		clusters: make(map[string]*ClusterInfo),
		filePath: cfg.RegistryPath,
	}

	if err := r.load(); err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to load cluster registry: %w", err)
	}

	// Auto-register current cluster as default if registry is empty
	if len(r.clusters) == 0 && !defaultK8s.Disabled {
		c := &ClusterInfo{
			ID:            uuid.New().String(),
			Name:          "default",
			Host:          defaultK8s.Host,
			Token:         defaultK8s.Token,
			CAFile:        defaultK8s.CAFile,
			SkipTLSVerify: defaultK8s.SkipTLSVerify,
			Namespace:     defaultK8s.Namespace,
			ReadOnly:      defaultK8s.ReadOnly,
			IsDefault:     true,
			Status:        "connected",
			CreatedAt:     time.Now(),
		}
		r.clusters[c.ID] = c
		if err := r.save(); err != nil {
			slog.Warn("cluster: failed to persist default cluster", "error", err)
		}
		slog.Info("cluster: auto-registered default cluster", "id", c.ID)
	}

	return r, nil
}

// List returns all clusters with tokens redacted.
func (r *Registry) List() []*ClusterInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()

	list := make([]*ClusterInfo, 0, len(r.clusters))
	for _, c := range r.clusters {
		redacted := c.Redacted()
		list = append(list, &redacted)
	}
	return list
}

// Get returns a cluster by ID (token redacted).
func (r *Registry) Get(id string) (*ClusterInfo, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	c, ok := r.clusters[id]
	if !ok {
		return nil, fmt.Errorf("cluster not found: %s", id)
	}
	redacted := c.Redacted()
	return &redacted, nil
}

// GetRaw returns a cluster by ID with the full token (for K8s client creation).
func (r *Registry) GetRaw(id string) (*ClusterInfo, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	c, ok := r.clusters[id]
	if !ok {
		return nil, fmt.Errorf("cluster not found: %s", id)
	}
	cp := *c
	return &cp, nil
}

// Create adds a new cluster.
func (r *Registry) Create(c *ClusterInfo) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	c.ID = uuid.New().String()
	c.CreatedAt = time.Now()
	if c.Status == "" {
		c.Status = "unknown"
	}

	r.clusters[c.ID] = c
	return r.save()
}

// Update modifies a cluster.
func (r *Registry) Update(c *ClusterInfo) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	existing, ok := r.clusters[c.ID]
	if !ok {
		return fmt.Errorf("cluster not found: %s", c.ID)
	}

	c.CreatedAt = existing.CreatedAt
	r.clusters[c.ID] = c
	return r.save()
}

// Delete removes a cluster.
func (r *Registry) Delete(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.clusters[id]; !ok {
		return fmt.Errorf("cluster not found: %s", id)
	}
	delete(r.clusters, id)
	return r.save()
}

// GetDefault returns the default cluster.
func (r *Registry) GetDefault() *ClusterInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, c := range r.clusters {
		if c.IsDefault {
			cp := *c
			return &cp
		}
	}
	return nil
}

// SetDefault marks a cluster as the default.
func (r *Registry) SetDefault(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.clusters[id]; !ok {
		return fmt.Errorf("cluster not found: %s", id)
	}

	for _, c := range r.clusters {
		c.IsDefault = (c.ID == id)
	}
	return r.save()
}

// UpdateStatus changes a cluster's status.
func (r *Registry) UpdateStatus(id, status string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if c, ok := r.clusters[id]; ok {
		c.Status = status
	}
}

func (r *Registry) load() error {
	data, err := os.ReadFile(r.filePath)
	if err != nil {
		return err
	}

	var clusters []*ClusterInfo
	if err := json.Unmarshal(data, &clusters); err != nil {
		return fmt.Errorf("failed to parse cluster registry: %w", err)
	}

	r.clusters = make(map[string]*ClusterInfo, len(clusters))
	for _, c := range clusters {
		r.clusters[c.ID] = c
	}
	return nil
}

func (r *Registry) save() error {
	clusters := make([]*ClusterInfo, 0, len(r.clusters))
	for _, c := range r.clusters {
		clusters = append(clusters, c)
	}

	data, err := json.MarshalIndent(clusters, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal cluster registry: %w", err)
	}

	dir := filepath.Dir(r.filePath)
	if dir != "" && dir != "." {
		os.MkdirAll(dir, 0755)
	}
	return os.WriteFile(r.filePath, data, 0644)
}
