package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/flexinfer/flexdeck/internal/agents"
	"github.com/flexinfer/flexdeck/internal/api"
	"github.com/flexinfer/flexdeck/internal/api/handlers"
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
	"github.com/redis/go-redis/v9"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: cfg.LogLevel,
	}))
	slog.SetDefault(logger)

	var k8sClient *k8s.Client
	if !cfg.K8s.Disabled {
		k8sClient, err = k8s.NewClient(cfg.K8s)
		if err != nil {
			slog.Error("failed to create k8s client", "error", err)
			os.Exit(1)
		}
		slog.Info("k8s client initialized", "host", cfg.K8s.Host)
	} else {
		slog.Info("k8s client disabled")
	}

	// Initialize shared Redis client, cache, and metrics store
	var redisClient *redis.Client
	var sharedCache *cache.Cache
	var litellmClient *litellm.Client
	var metricsStore *metrics.Store
	var metricsScraper *metrics.Scraper

	if !cfg.Redis.Disabled && cfg.Redis.URL != "" {
		redisClient, err = cache.NewRedisClient(cfg.Redis)
		if err != nil {
			slog.Warn("failed to create redis client, shared caching disabled", "error", err)
		} else {
			sharedCache = cache.New(redisClient, "flexdeck:")
			metricsStore = metrics.NewStoreWithClient(redisClient)
			slog.Info("redis client initialized")
		}
	} else {
		slog.Info("redis disabled, shared caching unavailable")
	}

	if !cfg.LiteLLM.Disabled && cfg.LiteLLM.URL != "" {
		litellmClient = litellm.NewClient(cfg.LiteLLM.URL, cfg.LiteLLM.APIKey)
		slog.Info("litellm client initialized", "url", cfg.LiteLLM.URL)

		if metricsStore != nil {
			metricsScraper = metrics.NewScraper(cfg.LiteLLM, metricsStore)
			go metricsScraper.Start(context.Background())
		} else {
			slog.Info("redis unavailable, metrics buffering unavailable")
		}
	} else {
		slog.Info("litellm client disabled")
	}

	// Initialize pipeline scraper if GitLab token is configured and Redis is available
	var pipelineScraper *metrics.PipelineScraper
	if cfg.GitLab.Token != "" && metricsStore != nil {
		pipelineScraper = metrics.NewPipelineScraper(cfg.GitLab, metricsStore)
		go pipelineScraper.Start(context.Background())
		slog.Info("pipeline scraper started")
	}

	// Background materializer keeps Redis summary keys warm
	var materializer *metrics.Materializer
	if metricsStore != nil {
		materializer = metrics.NewMaterializer(metricsStore, cfg.Prom.URL)
		go materializer.Start(context.Background())
	}

	// Initialize models subsystem
	var handlerDeps *handlers.HandlerDeps
	if sharedCache != nil {
		handlerDeps = &handlers.HandlerDeps{Cache: sharedCache}
	}
	if !cfg.Models.Disabled {
		if handlerDeps == nil {
			handlerDeps = &handlers.HandlerDeps{}
		}

		// Initialize model registry
		modelsRegistry, err := models.NewRegistry(cfg.Models)
		if err != nil {
			slog.Warn("failed to create models registry", "error", err)
		} else {
			handlerDeps.ModelsRegistry = modelsRegistry
			slog.Info("models registry initialized", "path", cfg.Models.RegistryPath)

			// Initialize downloader
			handlerDeps.ModelsDownloader = models.NewDownloader(
				cfg.Models.DownloadPath,
				cfg.Models.HFToken,
				cfg.Models.CivitAIKey,
				modelsRegistry,
			)
		}

		// Initialize HuggingFace client
		handlerDeps.HFClient = models.NewHuggingFaceClient(cfg.Models.HFToken)
		slog.Info("huggingface client initialized")

		// Initialize CivitAI client
		if cfg.Models.CivitAIKey != "" {
			handlerDeps.CivitClient = models.NewCivitAIClient(cfg.Models.CivitAIKey)
			slog.Info("civitai client initialized")
		}

		// Initialize GitOps generator
		if cfg.Models.GitOpsRepoPath != "" {
			handlerDeps.GitOpsGen = models.NewGitOpsGenerator(cfg.Models.GitOpsRepoPath, cfg.Models.AINamespace)
			slog.Info("gitops generator initialized", "path", cfg.Models.GitOpsRepoPath)
		}
	} else {
		slog.Info("models subsystem disabled")
	}

	// Initialize agents subsystem
	if !cfg.Agents.Disabled {
		if handlerDeps == nil {
			handlerDeps = &handlers.HandlerDeps{}
		}

		agentsRegistry, err := agents.NewRegistry(cfg.Agents)
		if err != nil {
			slog.Warn("failed to create agents registry", "error", err)
		} else {
			handlerDeps.AgentsRegistry = agentsRegistry
			handlerDeps.AgentsProxy = agents.NewProxy(agentsRegistry)
			slog.Info("agents registry initialized", "path", cfg.Agents.RegistryPath)
		}
	} else {
		slog.Info("agents subsystem disabled")
	}

	// Initialize RBAC subsystem
	if !cfg.RBAC.Disabled {
		if handlerDeps == nil {
			handlerDeps = &handlers.HandlerDeps{}
		}
		var rbacRegistry *rbac.Registry
		var err error
		if cfg.RBAC.RedisURL != "" {
			// Dedicated, durable Redis instance (AOF + PVC, no eviction) keeps the
			// user set persistent without giving the flexdeck pod a PVC startup
			// dependency. A connection failure here is fatal (fail closed).
			rbacRedis, cerr := cache.NewRedisClient(config.RedisConfig{URL: cfg.RBAC.RedisURL})
			if cerr != nil {
				slog.Error("RBAC enabled but dedicated Redis is unavailable; refusing to start", "error", cerr, "url", cfg.RBAC.RedisURL)
				os.Exit(1)
			}
			rbacRegistry, err = rbac.NewRedisRegistry(cfg.RBAC, rbacRedis)
		} else {
			rbacRegistry, err = rbac.NewRegistry(cfg.RBAC)
		}
		if err != nil {
			// RBAC was explicitly enabled but its registry could not be initialized.
			// Refuse to start rather than boot into a state where protected routes
			// would serve unauthenticated traffic (fail closed).
			slog.Error("RBAC enabled but registry initialization failed; refusing to start", "error", err, "path", cfg.RBAC.UsersPath, "redisURL", cfg.RBAC.RedisURL)
			os.Exit(1)
		}
		handlerDeps.RBACRegistry = rbacRegistry
		slog.Info("RBAC registry initialized", "usersPath", cfg.RBAC.UsersPath, "redisURL", cfg.RBAC.RedisURL)
	}

	// Initialize audit store (requires Redis)
	if !cfg.Audit.Disabled && redisClient != nil {
		if handlerDeps == nil {
			handlerDeps = &handlers.HandlerDeps{}
		}
		auditStore := audit.NewStore(redisClient, cfg.Audit.TTLDays)
		handlerDeps.AuditStore = auditStore
		slog.Info("audit store initialized", "ttl_days", cfg.Audit.TTLDays)
	}

	// Initialize multi-cluster subsystem
	if !cfg.MultiCluster.Disabled {
		if handlerDeps == nil {
			handlerDeps = &handlers.HandlerDeps{}
		}
		clusterReg, err := cluster.NewRegistry(cfg.MultiCluster, cfg.K8s)
		if err != nil {
			slog.Warn("failed to create cluster registry", "error", err)
		} else {
			handlerDeps.ClusterRegistry = clusterReg
			handlerDeps.ClusterManager = cluster.NewManager(clusterReg)
			slog.Info("multi-cluster initialized", "path", cfg.MultiCluster.RegistryPath)
		}
	}

	// Initialize HUD client and push store (independent of agents registry)
	if !cfg.LoomHUD.Disabled {
		if handlerDeps == nil {
			handlerDeps = &handlers.HandlerDeps{}
		}

		pushStore := agents.NewHUDPushStore(60 * time.Second)
		handlerDeps.HUDPushStore = pushStore
		hudClient := agents.NewHUDClient(cfg.LoomHUD.URL)
		hudClient.SetPushStore(pushStore)
		handlerDeps.HUDClient = hudClient
		if cfg.LoomHUD.URL != "" {
			slog.Info("loom HUD client initialized", "url", cfg.LoomHUD.URL, "push_store", true)
		} else {
			slog.Info("loom HUD push mode initialized (no pull URL)")
		}
	}

	// Initialize infra snapshot worker whenever Kubernetes is available.
	// Redis is optional: the worker can still serve live-built snapshots without cache backing.
	if k8sClient != nil {
		if handlerDeps == nil {
			handlerDeps = &handlers.HandlerDeps{}
		}
		handlerDeps.InfraWorker = infra.NewWorker(k8sClient, sharedCache, cfg)
		slog.Info("infra cache worker initialized")
	}

	// Start GPU swap observer (requires k8s + Redis)
	swapCtx, swapCancel := context.WithCancel(context.Background())
	defer swapCancel()
	if k8sClient != nil && metricsStore != nil {
		aiNS := cfg.Models.AINamespace
		if aiNS == "" {
			aiNS = "ai"
		}
		go metrics.StartSwapObserver(swapCtx, k8sClient, metricsStore, aiNS, logger)
		slog.Info("GPU swap observer started", "namespace", aiNS)
	}

	router := api.NewRouterWithDeps(cfg, k8sClient, litellmClient, metricsStore, handlerDeps)

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	done := make(chan os.Signal, 1)
	signal.Notify(done, os.Interrupt, syscall.SIGTERM)

	go func() {
		slog.Info("starting server", "port", cfg.Port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-done
	slog.Info("shutting down server")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}

	// Stop the swap observer
	swapCancel()

	// Stop the metrics scraper
	if metricsScraper != nil {
		slog.Info("stopping metrics scraper")
		metricsScraper.Stop()
	}

	// Stop the pipeline scraper
	if pipelineScraper != nil {
		slog.Info("stopping pipeline scraper")
		pipelineScraper.Stop()
	}

	// Stop the materializer
	if materializer != nil {
		slog.Info("stopping materializer")
		materializer.Stop()
	}

	// Close the metrics store
	if metricsStore != nil {
		slog.Info("closing metrics store")
		if err := metricsStore.Close(); err != nil {
			slog.Error("metrics store close error", "error", err)
		}
	}

	slog.Info("server stopped")
}
