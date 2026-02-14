package handlers

import (
	"github.com/flexinfer/flexdeck/internal/agents"
	"github.com/flexinfer/flexdeck/internal/cache"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/k8s"
	"github.com/flexinfer/flexdeck/internal/litellm"
	"github.com/flexinfer/flexdeck/internal/metrics"
	"github.com/flexinfer/flexdeck/internal/models"
)

type Handler struct {
	cfg          *config.Config
	k8s          *k8s.Client
	litellm      *litellm.Client
	metricsStore *metrics.Store
	cache        *cache.Cache

	// Models management
	modelsRegistry   *models.Registry
	modelsDownloader *models.Downloader
	hfClient         *models.HuggingFaceClient
	civitClient      *models.CivitAIClient
	gitopsGen        *models.GitOpsGenerator

	// Agents management
	agentsRegistry *agents.Registry
	agentsProxy    *agents.Proxy
}

// HandlerDeps contains optional dependencies for the handler
type HandlerDeps struct {
	ModelsRegistry   *models.Registry
	ModelsDownloader *models.Downloader
	HFClient         *models.HuggingFaceClient
	CivitClient      *models.CivitAIClient
	GitOpsGen        *models.GitOpsGenerator
	AgentsRegistry   *agents.Registry
	AgentsProxy      *agents.Proxy
}

func New(cfg *config.Config, k8sClient *k8s.Client, litellmClient *litellm.Client, metricsStore *metrics.Store) *Handler {
	return &Handler{
		cfg:          cfg,
		k8s:          k8sClient,
		litellm:      litellmClient,
		metricsStore: metricsStore,
	}
}

// NewWithDeps creates a handler with all dependencies
func NewWithDeps(cfg *config.Config, k8sClient *k8s.Client, litellmClient *litellm.Client, metricsStore *metrics.Store, deps *HandlerDeps) *Handler {
	h := &Handler{
		cfg:          cfg,
		k8s:          k8sClient,
		litellm:      litellmClient,
		metricsStore: metricsStore,
	}

	// Initialize Redis cache if metrics store has a Redis client
	if metricsStore != nil {
		h.cache = cache.New(metricsStore.RedisClient(), "flexdeck:")
	}

	if deps != nil {
		h.modelsRegistry = deps.ModelsRegistry
		h.modelsDownloader = deps.ModelsDownloader
		h.hfClient = deps.HFClient
		h.civitClient = deps.CivitClient
		h.gitopsGen = deps.GitOpsGen
		h.agentsRegistry = deps.AgentsRegistry
		h.agentsProxy = deps.AgentsProxy
	}

	return h
}
