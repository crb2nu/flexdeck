package api

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/flexinfer/flexdeck/internal/api/handlers"
	apimiddleware "github.com/flexinfer/flexdeck/internal/api/middleware"
	"github.com/flexinfer/flexdeck/internal/auth"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/k8s"
	"github.com/flexinfer/flexdeck/internal/litellm"
	"github.com/flexinfer/flexdeck/internal/metrics"
)

func NewRouter(cfg *config.Config, k8sClient *k8s.Client, litellmClient *litellm.Client, metricsStore *metrics.Store) chi.Router {
	return NewRouterWithDeps(cfg, k8sClient, litellmClient, metricsStore, nil)
}

func NewRouterWithDeps(cfg *config.Config, k8sClient *k8s.Client, litellmClient *litellm.Client, metricsStore *metrics.Store, deps *handlers.HandlerDeps) chi.Router {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))

	// CORS Middleware
	r.Use(corsMiddleware(cfg.AllowedOrigins))

	authMiddleware := auth.NewMiddleware(cfg)

	h := handlers.NewWithDeps(cfg, k8sClient, litellmClient, metricsStore, deps)

	// Auto-discover models from K8s on startup (non-blocking)
	if k8sClient != nil && deps != nil && deps.ModelsRegistry != nil {
		go func() {
			// Wait a bit for the server to fully start
			time.Sleep(2 * time.Second)

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			// Discover models from the configured AI namespace (default: ai).
			aiNS := strings.TrimSpace(cfg.Models.AINamespace)
			if aiNS == "" {
				aiNS = "ai"
			}

			discovered, err := h.SyncModelsFromK8s(ctx, aiNS)
			if err != nil {
				slog.Warn("auto-discovery: failed to sync models from K8s", "error", err)
			} else if discovered > 0 {
				slog.Info("auto-discovery: synced models from K8s", "count", discovered, "namespace", aiNS)
			}
		}()
	}

	r.Get("/api/health", h.Health)

	// Public API routes - no auth required, sanitized read-only data
	// These are exposed for the public portfolio site (flexinfer.ai)
	r.Route("/api/public", func(r chi.Router) {
		r.Get("/topology", h.PublicTopology)
		r.Get("/ci/status", h.PublicCIStatus)
		r.Get("/metrics/summary", h.PublicMetricsSummary)
		r.Get("/models/status", h.PublicModelsStatus)
	})

	r.Group(func(r chi.Router) {
		if cfg.Token != "" {
			r.Use(authMiddleware.Handler)
		}

		r.Get("/api/ui/config", h.UIConfig)
		r.Get("/api/ci/repos", h.ListRepositories)
		r.Get("/api/ci/pipeline/{id}", h.GetRepoPipeline)
		r.Get("/api/ci/projects/{projectId}/jobs/{jobId}/trace", h.GetJobTrace)
		r.Get("/api/ci/projects/{projectId}/jobs/{jobId}", h.GetJobInfo)
		r.With(apimiddleware.LogFunc("ci.retry")).Post("/api/ci/projects/{projectId}/jobs/{jobId}/retry", h.RetryJob)
		r.With(apimiddleware.LogFunc("ci.cancel")).Post("/api/ci/projects/{projectId}/jobs/{jobId}/cancel", h.CancelJob)
		r.With(apimiddleware.LogFunc("ci.play")).Post("/api/ci/projects/{projectId}/jobs/{jobId}/play", h.PlayJob)

		// Pipeline trends & history
		r.Get("/api/ci/trends", h.GetAllPipelineTrends)
		r.Get("/api/ci/projects/{id}/trends", h.GetPipelineTrends)
		r.Get("/api/ci/projects/{id}/history", h.GetPipelineHistory)

		// Pipeline-level actions
		r.Get("/api/ci/projects/{id}/pipelines", h.ListProjectPipelines)
		r.With(apimiddleware.LogFunc("ci.pipeline.retry")).Post("/api/ci/projects/{id}/pipelines/{pid}/retry", h.RetryPipeline)
		r.With(apimiddleware.LogFunc("ci.pipeline.cancel")).Post("/api/ci/projects/{id}/pipelines/{pid}/cancel", h.CancelPipeline)
		r.With(apimiddleware.LogFunc("ci.pipeline.trigger")).Post("/api/ci/projects/{id}/pipelines", h.TriggerPipeline)

		r.Route("/api/grafana", func(r chi.Router) {
			r.Get("/dashboards", h.GrafanaDashboards)
			r.Get("/dashboards/{uid}", h.GrafanaDashboardDetail)
			r.Get("/datasources", h.GrafanaDatasources)
		})

		r.Route("/api/k8s", func(r chi.Router) {
			r.Get("/services", h.K8sServices)
			r.Get("/nodes", h.K8sNodes)
			r.Get("/deployments", h.K8sDeployments)
			r.Get("/pods", h.K8sPods)
			r.Get("/ingresses", h.K8sIngresses)
			r.Get("/statefulsets", h.K8sStatefulSets)
			r.Get("/daemonsets", h.K8sDaemonSets)
			r.Get("/jobs", h.K8sJobs)
			r.Get("/cronjobs", h.K8sCronJobs)
			r.Get("/events", h.K8sEvents)
			r.Get("/events/stream", h.K8sEventsSSE)
			r.Get("/pods/{ns}/{name}/logs", h.K8sPodLogs)
			r.Get("/pods/{ns}/{name}/logs/stream", h.K8sPodLogsSSE)
			r.Get("/metrics/nodes", h.K8sNodeMetrics)
			r.Get("/metrics/pods", h.K8sPodMetrics)
			r.Get("/metrics/gpu/models", h.K8sGPUByModel)
			r.Get("/watch-sse", h.K8sWatchSSE)

			if !cfg.K8s.ReadOnly {
				r.With(apimiddleware.LogFunc("k8s.scale")).Post("/deployments/{ns}/{name}/scale", h.K8sScale)
				r.With(apimiddleware.LogFunc("k8s.restart")).Post("/deployments/{ns}/{name}/restart", h.K8sRestart)
			}
		})

		r.Route("/api/prom", func(r chi.Router) {
			r.Get("/health", h.PromHealth)
			r.Get("/query", h.PromQuery)
			r.Get("/query_range", h.PromQueryRange)
			r.Get("/alerts", h.PromAlerts)
			r.Get("/rules", h.PromRules)
		})

		r.Route("/api/loki", func(r chi.Router) {
			r.Get("/labels", h.LokiLabels)
			r.Get("/label/{name}/values", h.LokiLabelValues)
			r.Get("/query", h.LokiQuery)
			r.Get("/query_range", h.LokiQueryRange)
			r.Get("/tail-sse", h.LokiTailSSE)
			r.Get("/export", h.LokiExport)
		})

		r.Route("/api/vllm", func(r chi.Router) {
			r.Get("/health", h.VLLMHealth)
			r.Get("/models", h.VLLMListModels)
			r.Get("/models/{model}", h.VLLMGetModel)
			r.Post("/v1/chat/completions", h.VLLMChatCompletions)
			r.Post("/v1/completions", h.VLLMCompletions)
		})

		r.Route("/api/flux", func(r chi.Router) {
			r.Get("/kustomizations", h.FluxListKustomizations)
			r.Get("/helmreleases", h.FluxListHelmReleases)
			r.Get("/sources", h.FluxListSources)
			r.With(apimiddleware.LogFunc("flux.reconcile")).Post("/reconcile/{kind}/{namespace}/{name}", h.FluxReconcile)
			if !cfg.K8s.ReadOnly {
				r.With(apimiddleware.LogFunc("flux.suspend")).Post("/suspend/{kind}/{namespace}/{name}", h.FluxSuspend)
			}
		})

		r.Route("/api/litellm", func(r chi.Router) {
			r.Get("/health", h.LiteLLMHealth)
			r.Get("/metrics", h.LiteLLMMetrics)
			r.Get("/metrics/{model}", h.LiteLLMModelMetrics)
		})

		r.Route("/api/langfuse", func(r chi.Router) {
			r.Get("/health", h.LangfuseHealth)
			r.Get("/metrics", h.LangfuseMetrics)
			r.Get("/traces", h.LangfuseTraces)
			r.Get("/scores", h.LangfuseScores)
			r.Get("/models", h.LangfuseModels)
		})

		r.Route("/api/models", func(r chi.Router) {
			r.Get("/", h.ModelsList)
			r.Post("/register", h.ModelsRegister)
			r.Post("/discover", h.ModelsDiscoverK8s) // Discover models from K8s deployments
			r.Get("/crd", h.ModelsCRD)               // Query flexinfer.ai/v1alpha2 Model CRDs directly
			r.Get("/crd/watch-sse", h.ModelsCRDWatchSSE)
			r.Get("/search/huggingface", h.ModelsSearchHuggingFace)
			r.Get("/search/civitai", h.ModelsSearchCivitAI)

			if !cfg.K8s.ReadOnly {
				r.With(apimiddleware.LogFunc("models.crd.scale")).Post("/crd/{namespace}/{name}/scale", h.ModelsCRDScale)
				r.With(apimiddleware.LogFunc("models.crd.activate")).Post("/crd/{namespace}/{name}/activate", h.ModelsCRDActivate)
				r.With(apimiddleware.LogFunc("models.crd.restart")).Post("/crd/{namespace}/{name}/restart", h.ModelsCRDRestart)
			}

			r.Get("/{id}", h.ModelsGet)
			r.Delete("/{id}", h.ModelsDelete)
			r.Post("/{id}/download", h.ModelsStartDownload)
			r.Get("/{id}/download/progress", h.ModelsDownloadProgress)
			r.Delete("/{id}/download", h.ModelsCancelDownload)
			r.Post("/{id}/deploy", h.ModelsDeploy)
			r.Post("/{id}/scale", h.ModelsScale)
		})

		r.Route("/api/agents", func(r chi.Router) {
			r.Get("/", h.AgentsList)
			r.Post("/", h.AgentsCreate)
			r.Get("/health", h.AgentsHealth)
			r.Get("/graph", h.AgentsGraph)

			// Built-in Agent Builder
			r.Get("/builder", h.AgentBuilderInfo)
			r.Post("/builder/chat", h.AgentBuilderChat)

			// External Agent Frameworks
			r.Get("/frameworks", h.ExternalAgentsFrameworks)

			// Dify integration
			r.Post("/dify/chat", h.DifyChat)

			// LangGraph integration
			r.Get("/langgraph/assistants", h.LangGraphListAssistants)
			r.Post("/langgraph/run", h.LangGraphRun)

			r.Get("/{id}", h.AgentsGet)
			r.Put("/{id}", h.AgentsUpdate)
			r.Delete("/{id}", h.AgentsDelete)
			r.Get("/{id}/health", h.AgentsCheckHealth)
			r.Get("/{id}/sessions", h.HUDAgentSessions)
			r.Post("/{id}/test", h.AgentsTest)
			r.Post("/{id}/invoke", h.AgentsInvoke)
			r.Post("/{id}/stream", h.AgentsStream)
			r.Get("/{id}/usage", h.AgentsUsage)
		})
	})

	fileServer(r, "/", cfg.StaticDir)

	return r
}

func fileServer(r chi.Router, path string, root string) {
	if strings.ContainsAny(path, "{}*") {
		panic("FileServer does not permit URL parameters")
	}

	fs := http.StripPrefix(path, http.FileServer(http.Dir(root)))

	if path != "/" && path[len(path)-1] != '/' {
		r.Get(path, http.RedirectHandler(path+"/", http.StatusMovedPermanently).ServeHTTP)
		path += "/"
	}
	path += "*"

	r.Get(path, func(w http.ResponseWriter, r *http.Request) {
		filePath := filepath.Join(root, strings.TrimPrefix(r.URL.Path, "/"))

		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			http.ServeFile(w, r, filepath.Join(root, "index.html"))
			return
		}

		fs.ServeHTTP(w, r)
	})
}
