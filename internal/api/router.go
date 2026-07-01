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
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/flexinfer/flexdeck/internal/api/handlers"
	apimiddleware "github.com/flexinfer/flexdeck/internal/api/middleware"
	"github.com/flexinfer/flexdeck/internal/auth"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/k8s"
	"github.com/flexinfer/flexdeck/internal/litellm"
	"github.com/flexinfer/flexdeck/internal/metrics"
	"github.com/flexinfer/flexdeck/internal/rbac"
)

func NewRouter(cfg *config.Config, k8sClient *k8s.Client, litellmClient *litellm.Client, metricsStore *metrics.Store) chi.Router {
	return NewRouterWithDeps(cfg, k8sClient, litellmClient, metricsStore, nil)
}

// rbacUnavailableHandler rejects every request with 503 Service Unavailable. It
// guards the protected route group when RBAC is enabled by configuration but its
// registry failed to initialize, ensuring the group never falls back to
// legacy-token or unauthenticated access (fail closed).
func rbacUnavailableHandler(http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "rbac enabled but unavailable", http.StatusServiceUnavailable)
	})
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

	// Create audit logger with optional Redis persistence
	var auditLogger *apimiddleware.AuditLogger
	if deps != nil && deps.AuditStore != nil {
		auditLogger = apimiddleware.NewAuditLogger(nil, deps.AuditStore)
	}

	// Create RBAC middleware when enabled
	var rbacMiddleware *rbac.Middleware
	if !cfg.RBAC.Disabled && deps != nil && deps.RBACRegistry != nil {
		rbacMiddleware = rbac.NewMiddleware(
			deps.RBACRegistry,
			cfg.TokenCookie,
			cfg.CookieSecure,
			cfg.TokenCookieTTL,
		)
	}

	h := handlers.NewWithDeps(cfg, k8sClient, litellmClient, metricsStore, deps)

	// Start infra cache worker on startup (non-blocking)
	if deps != nil && deps.InfraWorker != nil {
		go func() {
			time.Sleep(3 * time.Second)
			deps.InfraWorker.Start(context.Background())
		}()
	}

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

			discovered, err := h.SyncModelsFromK8s(ctx, k8sClient, aiNS)
			if err != nil {
				slog.Warn("auto-discovery: failed to sync models from K8s", "error", err)
			} else if discovered > 0 {
				slog.Info("auto-discovery: synced models from K8s", "count", discovered, "namespace", aiNS)
			}
		}()
	}

	r.Get("/api/health", h.Health)
	r.Handle("/metrics", promhttp.Handler())

	// Public API routes - no auth required, sanitized read-only data
	registerPublicRoutes(r, h)

	// Helper: audit-aware LogFunc — uses persistent audit logger when available
	logFunc := apimiddleware.LogFunc
	if auditLogger != nil {
		logFunc = auditLogger.Log
	}

	r.Group(func(r chi.Router) {
		switch {
		case rbacMiddleware != nil:
			r.Use(rbacMiddleware.Handler)
		case !cfg.RBAC.Disabled:
			// RBAC is enabled by configuration but its registry is unavailable.
			// Fail closed: never fall back to legacy-token or unauthenticated access
			// on the protected route group.
			r.Use(rbacUnavailableHandler)
		case cfg.Token != "":
			r.Use(authMiddleware.Handler)
		}

		r.Get("/api/ui/config", h.UIConfig)
		r.Get("/api/dashboard/summary", h.DashboardSummary)
		r.Get("/api/traffic/report", h.TrafficReport)

		registerCIRoutes(r, h, logFunc)
		registerProjectsRoutes(r, h, logFunc)
		registerWorkspaceRoutes(r, h)
		registerInfrastructureRoutes(r, h, logFunc, cfg)
		registerDomainRoutes(r, h, logFunc, cfg)

		// RBAC routes
		if !cfg.RBAC.Disabled && deps != nil && deps.RBACRegistry != nil {
			r.Route("/api/rbac", func(r chi.Router) {
				r.Get("/me", h.RBACCurrentUser)
				r.Get("/roles", h.RBACRoles)
				r.Group(func(r chi.Router) {
					r.Use(rbac.RequirePermission(rbac.PermAdmin))
					r.Get("/users", h.RBACListUsers)
					r.Get("/users/{id}", h.RBACGetUser)
					r.With(logFunc("rbac.user.create")).Post("/users", h.RBACCreateUser)
					r.With(logFunc("rbac.user.update")).Put("/users/{id}", h.RBACUpdateUser)
					r.With(logFunc("rbac.user.delete")).Delete("/users/{id}", h.RBACDeleteUser)
				})
			})
		}

		// Audit routes
		if !cfg.Audit.Disabled && deps != nil && deps.AuditStore != nil {
			r.Route("/api/audit", func(r chi.Router) {
				r.Get("/", h.AuditList)
				r.Get("/stats", h.AuditStats)
			})
		}

		// Multi-cluster routes
		if !cfg.MultiCluster.Disabled && deps != nil && deps.ClusterRegistry != nil {
			r.Route("/api/clusters", func(r chi.Router) {
				r.Get("/", h.ClustersList)
				r.Get("/{id}", h.ClustersGet)
				r.With(logFunc("cluster.create")).Post("/", h.ClustersCreate)
				r.With(logFunc("cluster.update")).Put("/{id}", h.ClustersUpdate)
				r.With(logFunc("cluster.delete")).Delete("/{id}", h.ClustersDelete)
				r.With(logFunc("cluster.test")).Post("/{id}/test", h.ClustersTest)
				r.With(logFunc("cluster.default")).Post("/{id}/default", h.ClustersSetDefault)
			})
		}
	})

	fileServer(r, "/", cfg.StaticDir)

	return r
}

func registerPublicRoutes(r chi.Router, h *handlers.Handler) {
	// These are exposed for the public portfolio site (flexinfer.ai)
	r.Route("/api/public", func(r chi.Router) {
		r.Get("/topology", h.PublicTopology)
		r.Get("/ci/status", h.PublicCIStatus)
		r.Get("/metrics/summary", h.PublicMetricsSummary)
		r.Get("/models/status", h.PublicModelsStatus)
		r.Get("/benchmarks", h.PublicBenchmarks)
	})
}

func registerCIRoutes(r chi.Router, h *handlers.Handler, logFunc func(string) func(http.Handler) http.Handler) {
	r.Get("/api/ci/repos", h.ListRepositories)
	r.Get("/api/ci/repos/{id}/config", h.GetRepoConfig)
	r.Get("/api/ci/pipeline/{id}", h.GetRepoPipeline)
	r.Get("/api/ci/pipelines/batch", h.BatchPipelines)
	r.Get("/api/ci/projects/{projectId}/jobs/{jobId}/trace", h.GetJobTrace)
	r.Get("/api/ci/projects/{projectId}/jobs/{jobId}", h.GetJobInfo)
	r.With(logFunc("ci.retry")).Post("/api/ci/projects/{projectId}/jobs/{jobId}/retry", h.RetryJob)
	r.With(logFunc("ci.cancel")).Post("/api/ci/projects/{projectId}/jobs/{jobId}/cancel", h.CancelJob)
	r.With(logFunc("ci.play")).Post("/api/ci/projects/{projectId}/jobs/{jobId}/play", h.PlayJob)

	// CI dashboard summary
	r.Get("/api/ci/summary", h.GetCISummary)
	// Pipeline trends & history
	r.Get("/api/ci/trends", h.GetAllPipelineTrends)
	r.Get("/api/ci/projects/{id}/trends", h.GetPipelineTrends)
	r.Get("/api/ci/projects/{id}/history", h.GetPipelineHistory)

	// Pipeline-level actions
	r.Get("/api/ci/projects/{id}/pipelines", h.ListProjectPipelines)
	r.With(logFunc("ci.pipeline.retry")).Post("/api/ci/projects/{id}/pipelines/{pid}/retry", h.RetryPipeline)
	r.With(logFunc("ci.pipeline.cancel")).Post("/api/ci/projects/{id}/pipelines/{pid}/cancel", h.CancelPipeline)
	r.With(logFunc("ci.pipeline.trigger")).Post("/api/ci/projects/{id}/pipelines", h.TriggerPipeline)
}

func registerWorkspaceRoutes(r chi.Router, h *handlers.Handler) {
	r.Get("/api/workspace/repos", h.WorkspaceRepos)
}

// registerProjectsRoutes wires the unified project-tracking federation
// endpoints. Reads inherit the authenticated group's RBAC PermRead; writes are
// audit-logged through the shared middleware.
func registerProjectsRoutes(r chi.Router, h *handlers.Handler, logFunc func(string) func(http.Handler) http.Handler) {
	r.Get("/api/projects", h.ListProjects)
	r.Get("/api/projects/{id}", h.GetProject)
	r.With(logFunc("project.risk.create")).Post("/api/projects/{id}/risks", h.CreateProjectRisk)
}

func registerInfrastructureRoutes(r chi.Router, h *handlers.Handler, logFunc func(string) func(http.Handler) http.Handler, cfg *config.Config) {
	r.Get("/api/infra/snapshot", h.InfraSnapshot)

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
		r.Get("/pvcs", h.K8sPVCs)
		r.Get("/pvs", h.K8sPVs)
		r.Get("/storageclasses", h.K8sStorageClasses)
		r.Get("/network-policies", h.K8sNetworkPolicies)
		r.Get("/configmaps", h.K8sConfigMaps)
		r.Get("/configmaps/{ns}/{name}", h.K8sConfigMapDetail)
		r.Get("/secrets", h.K8sSecrets)
		r.Get("/secrets/{ns}/{name}", h.K8sSecretDetail)

		if !cfg.K8s.ReadOnly {
			r.With(logFunc("k8s.scale")).Post("/deployments/{ns}/{name}/scale", h.K8sScale)
			r.With(logFunc("k8s.restart")).Post("/deployments/{ns}/{name}/restart", h.K8sRestart)
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

	r.Route("/api/alertmanager", func(r chi.Router) {
		r.Get("/alerts", h.AlertmanagerAlerts)
		r.Get("/silences", h.AlertmanagerSilences)
		r.Get("/status", h.AlertmanagerStatus)
		r.With(logFunc("alertmanager.silence.create")).Post("/silences", h.AlertmanagerCreateSilence)
		r.With(logFunc("alertmanager.silence.delete")).Delete("/silences/{id}", h.AlertmanagerDeleteSilence)
	})

	r.Route("/api/flexinfer", func(r chi.Router) {
		r.Get("/proxy/health", h.FlexInferProxyHealth)
		r.Get("/proxy/models", h.FlexInferProxyModels)
		r.Get("/proxy/metrics", h.FlexInferProxyMetrics)
	})
}

func registerDomainRoutes(r chi.Router, h *handlers.Handler, logFunc func(string) func(http.Handler) http.Handler, cfg *config.Config) {
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
		r.Get("/helmreleases/{namespace}/{name}/values", h.FluxHelmReleaseValues)
		r.Get("/helmreleases/{namespace}/{name}/history", h.FluxHelmReleaseHistory)
		r.With(logFunc("flux.reconcile")).Post("/reconcile/{kind}/{namespace}/{name}", h.FluxReconcile)
		if !cfg.K8s.ReadOnly {
			r.With(logFunc("flux.suspend")).Post("/suspend/{kind}/{namespace}/{name}", h.FluxSuspend)
		}
	})

	r.Route("/api/litellm", func(r chi.Router) {
		r.Get("/health", h.LiteLLMHealth)
		r.Get("/metrics", h.LiteLLMMetrics)
		r.Get("/metrics/{model}", h.LiteLLMModelMetrics)
		r.Get("/models", h.LiteLLMModels)
		r.Get("/router", h.LiteLLMRouter)
	})

	r.Route("/api/hud", func(r chi.Router) {
		r.Get("/capabilities", h.HUDCapabilities)
		r.Get("/fleet", h.HUDFleet)
		r.Get("/presence", h.HUDPresence)
		r.Get("/claims", h.HUDClaims)
		r.Get("/tasks", h.HUDTasks)
		r.Get("/workflows", h.HUDWorkflows)
		r.Get("/timeline", h.HUDTimeline)
		r.Get("/handoffs", h.HUDHandoffs)
		r.Get("/sessions/{id}", h.HUDSessionDetail)
		r.Get("/sessions/{id}/trace", h.HUDSessionTrace)
		r.Get("/events", h.HUDEventsSSE)
		r.With(logFunc("hud.workflow.approve")).Post("/workflows/{id}/approve", h.HUDWorkflowApprove)
		r.With(logFunc("hud.workflow.reject")).Post("/workflows/{id}/reject", h.HUDWorkflowReject)
		r.With(logFunc("hud.workflow.cancel")).Post("/workflows/{id}/cancel", h.HUDWorkflowCancel)
		r.With(logFunc("hud.handoff.accept")).Post("/handoffs/{id}/accept", h.HUDHandoffAccept)
		r.With(logFunc("hud.handoff.reject")).Post("/handoffs/{id}/reject", h.HUDHandoffReject)
	})

	// Loom control plane — unified federation of fleet/projects/plans/mills/
	// flightdeck. Slice 1 lands the health aggregator; per-surface routes follow.
	r.Route("/api/loom", func(r chi.Router) {
		r.Get("/health", h.LoomHealth)
		r.Get("/plans", h.LoomPlans)
		r.Get("/plans/{id}", h.LoomPlanDetail)

		// Mills surface — read-only proxy to loom-mills-operator (/api/mills/*).
		r.Route("/mills", func(r chi.Router) {
			r.Get("/status", h.LoomMillsStatus)
			r.Get("/kpis", h.LoomMillsKPIs)
			r.Get("/policy", h.LoomMillsPolicy)
			r.Get("/backlog", h.LoomMillsBacklog)
			r.Get("/backlog/{id}", h.LoomMillsBacklogItem)
			r.Get("/pipeline/runs", h.LoomMillsPipelineRuns)
			r.Get("/pipeline/runs/{id}", h.LoomMillsPipelineRun)
			r.Get("/council/runs", h.LoomMillsCouncilRuns)
			r.Get("/council/runs/{id}", h.LoomMillsCouncilRun)
			r.Get("/council/runs/{id}/debate", h.LoomMillsCouncilDebate)
			r.Get("/eval/scores", h.LoomMillsEvalScores)
			r.Get("/squads", h.LoomMillsSquads)
			r.Get("/squads/{name}", h.LoomMillsSquad)
			r.Get("/audit/findings", h.LoomMillsAuditFindings)
			r.Get("/audit/findings/{id}", h.LoomMillsAuditFinding)
			r.Get("/policy/proposals", h.LoomMillsPolicyProposals)
		})

		// Flightdeck surface — read-only proxy to the loom-flightdeck board API
		// (Stall Board + Context Ledger), bearer token injected server-side.
		r.Route("/flightdeck", func(r chi.Router) {
			r.Get("/board/summary", h.LoomFlightdeckBoardSummary)
			r.Get("/board/stalls", h.LoomFlightdeckBoardStalls)
			r.Get("/board/session/{id}", h.LoomFlightdeckBoardSession)
			r.Get("/context/summary", h.LoomFlightdeckContextSummary)
			r.Get("/context/catalog", h.LoomFlightdeckContextCatalog)
			r.Get("/context/rules", h.LoomFlightdeckContextRules)
		})
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
		r.Get("/crd/{namespace}/{name}/events", h.ModelsCRDEvents)
		r.Get("/crd/{namespace}/{name}/swap-history", h.ModelSwapHistory)
		r.Get("/crd/{namespace}/{name}/inference", h.ModelsInferenceMetrics)
		r.Get("/crd/groups/{group}/swap-history", h.GroupSwapHistory)
		r.Get("/lora/{namespace}/{name}", h.ModelsLoRA)
		r.Get("/catalogs", h.ModelsCatalog)
		r.Get("/cache", h.ModelCacheList)
		r.Get("/cache/watch-sse", h.ModelCacheWatchSSE)
		r.Get("/cache/{namespace}/{name}", h.ModelCacheGet)
		r.Get("/cache/{namespace}/{name}/logs", h.ModelCachePodLogs)
		r.Get("/search/huggingface", h.ModelsSearchHuggingFace)
		r.Get("/search/civitai", h.ModelsSearchCivitAI)

		if !cfg.K8s.ReadOnly {
			r.With(logFunc("models.crd.scale")).Post("/crd/{namespace}/{name}/scale", h.ModelsCRDScale)
			r.With(logFunc("models.crd.activate")).Post("/crd/{namespace}/{name}/activate", h.ModelsCRDActivate)
			r.With(logFunc("models.crd.restart")).Post("/crd/{namespace}/{name}/restart", h.ModelsCRDRestart)
			r.With(logFunc("models.crd.patch")).Patch("/crd/{namespace}/{name}/spec", h.ModelsCRDPatchSpec)
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

		// HUD push webhook (local HUD → cluster flexdeck)
		r.Post("/hud/push", h.HUDPresencePush)

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
