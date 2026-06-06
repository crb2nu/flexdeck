package handlers

import (
	"crypto/tls"
	"net"
	"net/http"
	"time"

	"github.com/flexinfer/flexdeck/internal/agents"
	"github.com/flexinfer/flexdeck/internal/audit"
	"github.com/flexinfer/flexdeck/internal/cache"
	"github.com/flexinfer/flexdeck/internal/cluster"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/infra"
	"github.com/flexinfer/flexdeck/internal/k8s"
	"github.com/flexinfer/flexdeck/internal/litellm"
	"github.com/flexinfer/flexdeck/internal/metrics"
	"github.com/flexinfer/flexdeck/internal/models"
	"github.com/flexinfer/flexdeck/internal/rbac"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
)

// newGitLabClient creates a shared HTTP client for GitLab API requests
// with connection pooling and sensible timeouts.
func newGitLabClient() *http.Client {
	return &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			MaxIdleConnsPerHost: 10,
			IdleConnTimeout:     90 * time.Second,
			TLSHandshakeTimeout: 10 * time.Second,
			DialContext: (&net.Dialer{
				Timeout:   5 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12},
		},
	}
}

type Handler struct {
	cfg                    *config.Config
	k8s                    *k8s.Client
	litellm                *litellm.Client
	metricsStore           *metrics.Store
	cache                  *cache.Cache
	gitlabClient           *http.Client
	dynamicClientForConfig func(*rest.Config) (dynamic.Interface, error)

	// Infrastructure cache worker
	infraWorker *infra.Worker

	// Models management
	modelsRegistry   *models.Registry
	modelsDownloader *models.Downloader
	hfClient         *models.HuggingFaceClient
	civitClient      *models.CivitAIClient
	gitopsGen        *models.GitOpsGenerator

	// Agents management
	agentsRegistry *agents.Registry
	agentsProxy    *agents.Proxy
	hudClient      *agents.HUDClient
	hudPushStore   *agents.HUDPushStore

	// RBAC
	rbacRegistry *rbac.Registry

	// Audit
	auditStore *audit.Store

	// Multi-Cluster
	clusterManager  *cluster.Manager
	clusterRegistry *cluster.Registry
}

func (h *Handler) newDynamicClient(config *rest.Config) (dynamic.Interface, error) {
	if h.dynamicClientForConfig != nil {
		return h.dynamicClientForConfig(config)
	}
	return dynamic.NewForConfig(config)
}

// HandlerDeps contains optional dependencies for the handler
type HandlerDeps struct {
	ModelsRegistry   *models.Registry
	ModelsDownloader *models.Downloader
	HFClient         *models.HuggingFaceClient
	CivitClient      *models.CivitAIClient
	GitOpsGen        *models.GitOpsGenerator
	Cache            *cache.Cache
	InfraWorker      *infra.Worker
	AgentsRegistry   *agents.Registry
	AgentsProxy      *agents.Proxy
	HUDClient        *agents.HUDClient
	HUDPushStore     *agents.HUDPushStore
	RBACRegistry     *rbac.Registry
	AuditStore       *audit.Store
	ClusterManager   *cluster.Manager
	ClusterRegistry  *cluster.Registry
}

func New(cfg *config.Config, k8sClient *k8s.Client, litellmClient *litellm.Client, metricsStore *metrics.Store) *Handler {
	h := &Handler{
		cfg:          cfg,
		k8s:          k8sClient,
		litellm:      litellmClient,
		metricsStore: metricsStore,
		gitlabClient: newGitLabClient(),
	}
	if metricsStore != nil {
		h.cache = cache.New(metricsStore.RedisClient(), "flexdeck:")
	}
	return h
}

// NewWithDeps creates a handler with all dependencies
func NewWithDeps(cfg *config.Config, k8sClient *k8s.Client, litellmClient *litellm.Client, metricsStore *metrics.Store, deps *HandlerDeps) *Handler {
	h := &Handler{
		cfg:          cfg,
		k8s:          k8sClient,
		litellm:      litellmClient,
		metricsStore: metricsStore,
		gitlabClient: newGitLabClient(),
	}

	if deps != nil && deps.Cache != nil {
		h.cache = deps.Cache
	} else if metricsStore != nil {
		// Backward-compatible fallback for callers that only pass a metrics store.
		h.cache = cache.New(metricsStore.RedisClient(), "flexdeck:")
	}

	if deps != nil {
		h.infraWorker = deps.InfraWorker
		h.modelsRegistry = deps.ModelsRegistry
		h.modelsDownloader = deps.ModelsDownloader
		h.hfClient = deps.HFClient
		h.civitClient = deps.CivitClient
		h.gitopsGen = deps.GitOpsGen
		h.agentsRegistry = deps.AgentsRegistry
		h.agentsProxy = deps.AgentsProxy
		h.hudClient = deps.HUDClient
		h.hudPushStore = deps.HUDPushStore
		h.rbacRegistry = deps.RBACRegistry
		h.auditStore = deps.AuditStore
		h.clusterManager = deps.ClusterManager
		h.clusterRegistry = deps.ClusterRegistry
	}

	return h
}

// k8sForRequest returns the K8s client for the requested cluster.
// Falls back to the default single-cluster client when multi-cluster is disabled.
func (h *Handler) k8sForRequest(r *http.Request) *k8s.Client {
	if h.clusterManager == nil {
		return h.k8s
	}
	clusterID := cluster.ClusterIDFromRequest(r)
	if clusterID == "" {
		client, _ := h.clusterManager.GetDefaultClient()
		if client != nil {
			return client
		}
		return h.k8s
	}
	client, err := h.clusterManager.GetClient(clusterID)
	if err == nil && client != nil {
		return client
	}

	// Fall back to the configured default managed cluster before the legacy single-cluster client.
	if defaultClient, defaultErr := h.clusterManager.GetDefaultClient(); defaultErr == nil && defaultClient != nil {
		return defaultClient
	}
	return h.k8s
}
