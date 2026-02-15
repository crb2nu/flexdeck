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
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/k8s"
	"github.com/flexinfer/flexdeck/internal/litellm"
	"github.com/flexinfer/flexdeck/internal/metrics"
	"github.com/flexinfer/flexdeck/internal/models"
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

	// Initialize LiteLLM client and metrics store
	var litellmClient *litellm.Client
	var metricsStore *metrics.Store
	var metricsScraper *metrics.Scraper

	if !cfg.LiteLLM.Disabled && cfg.LiteLLM.URL != "" {
		litellmClient = litellm.NewClient(cfg.LiteLLM.URL, cfg.LiteLLM.APIKey)
		slog.Info("litellm client initialized", "url", cfg.LiteLLM.URL)

		// Initialize Redis store for metrics if configured
		if !cfg.Redis.Disabled && cfg.Redis.URL != "" {
			metricsStore, err = metrics.NewStore(cfg.Redis)
			if err != nil {
				slog.Warn("failed to create metrics store, metrics buffering disabled", "error", err)
			} else {
				slog.Info("redis metrics store initialized")

				// Start the metrics scraper
				metricsScraper = metrics.NewScraper(cfg.LiteLLM, metricsStore)
				go metricsScraper.Start(context.Background())
			}
		} else {
			slog.Info("redis disabled, metrics buffering unavailable")
		}
	} else {
		slog.Info("litellm client disabled")
	}

	// Initialize models subsystem
	var handlerDeps *handlers.HandlerDeps
	if !cfg.Models.Disabled {
		handlerDeps = &handlers.HandlerDeps{}

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

	// Initialize HUD client (independent of agents registry)
	if !cfg.LoomHUD.Disabled && cfg.LoomHUD.URL != "" {
		if handlerDeps == nil {
			handlerDeps = &handlers.HandlerDeps{}
		}
		handlerDeps.HUDClient = agents.NewHUDClient(cfg.LoomHUD.URL)
		slog.Info("loom HUD client initialized", "url", cfg.LoomHUD.URL)
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

	// Stop the metrics scraper
	if metricsScraper != nil {
		slog.Info("stopping metrics scraper")
		metricsScraper.Stop()
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
