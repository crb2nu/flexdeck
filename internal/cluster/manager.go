package cluster

import (
	"context"
	"fmt"
	"sync"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/k8s"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Manager handles lazy creation and caching of K8s clients for multiple clusters.
type Manager struct {
	mu       sync.RWMutex
	clients  map[string]*k8s.Client
	registry *Registry
}

// NewManager creates a new cluster manager.
func NewManager(registry *Registry) *Manager {
	return &Manager{
		clients:  make(map[string]*k8s.Client),
		registry: registry,
	}
}

// GetClient returns the cached K8s client for the given cluster, creating it on first access.
func (m *Manager) GetClient(id string) (*k8s.Client, error) {
	m.mu.RLock()
	if client, ok := m.clients[id]; ok {
		m.mu.RUnlock()
		return client, nil
	}
	m.mu.RUnlock()

	m.mu.Lock()
	defer m.mu.Unlock()

	// Double-check after acquiring write lock
	if client, ok := m.clients[id]; ok {
		return client, nil
	}

	info, err := m.registry.GetRaw(id)
	if err != nil {
		return nil, err
	}

	client, err := k8s.NewClient(config.K8sConfig{
		Host:          info.Host,
		Token:         info.Token,
		CAFile:        info.CAFile,
		SkipTLSVerify: info.SkipTLSVerify,
		Namespace:     info.Namespace,
		ReadOnly:      info.ReadOnly,
	})
	if err != nil {
		m.registry.UpdateStatus(id, "disconnected")
		return nil, fmt.Errorf("failed to create k8s client for cluster %s: %w", id, err)
	}

	m.registry.UpdateStatus(id, "connected")
	m.clients[id] = client
	return client, nil
}

// GetDefaultClient returns the K8s client for the default cluster.
func (m *Manager) GetDefaultClient() (*k8s.Client, error) {
	def := m.registry.GetDefault()
	if def == nil {
		return nil, fmt.Errorf("no default cluster configured")
	}
	return m.GetClient(def.ID)
}

// RemoveClient evicts a cluster's cached client.
func (m *Manager) RemoveClient(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.clients, id)
}

// TestConnection verifies connectivity to a cluster by listing namespaces.
func (m *Manager) TestConnection(ctx context.Context, info *ClusterInfo) error {
	client, err := k8s.NewClient(config.K8sConfig{
		Host:          info.Host,
		Token:         info.Token,
		CAFile:        info.CAFile,
		SkipTLSVerify: info.SkipTLSVerify,
		Namespace:     info.Namespace,
	})
	if err != nil {
		return fmt.Errorf("failed to create client: %w", err)
	}

	_, err = client.Clientset().CoreV1().Namespaces().List(ctx, metav1.ListOptions{Limit: 1})
	if err != nil {
		return fmt.Errorf("connectivity check failed: %w", err)
	}
	return nil
}
