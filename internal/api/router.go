package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/flexinfer/flexdeck/internal/api/handlers"
	"github.com/flexinfer/flexdeck/internal/auth"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/k8s"
)

func NewRouter(cfg *config.Config, k8sClient *k8s.Client) chi.Router {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))

	authMiddleware := auth.NewMiddleware(cfg)

	h := handlers.New(cfg, k8sClient)

	r.Get("/api/health", h.Health)

	r.Group(func(r chi.Router) {
		if cfg.Token != "" {
			r.Use(authMiddleware.Handler)
		}

		r.Get("/api/ui-config", h.UIConfig)

		r.Route("/api/k8s", func(r chi.Router) {
			r.Get("/services", h.K8sServices)
			r.Get("/nodes", h.K8sNodes)
			r.Get("/deployments", h.K8sDeployments)
			r.Get("/pods", h.K8sPods)
			r.Get("/ingresses", h.K8sIngresses)

			if !cfg.K8s.ReadOnly {
				r.Post("/deployments/{ns}/{name}/scale", h.K8sScale)
				r.Post("/deployments/{ns}/{name}/restart", h.K8sRestart)
			}
		})

		r.Route("/api/prom", func(r chi.Router) {
			r.Get("/health", h.PromHealth)
			r.Get("/query", h.PromQuery)
			r.Get("/query_range", h.PromQueryRange)
		})

		r.Route("/api/loki", func(r chi.Router) {
			r.Get("/labels", h.LokiLabels)
			r.Get("/label/{name}/values", h.LokiLabelValues)
			r.Get("/query", h.LokiQuery)
			r.Get("/query_range", h.LokiQueryRange)
			r.Get("/tail-sse", h.LokiTailSSE)
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
			r.Post("/reconcile/{kind}/{namespace}/{name}", h.FluxReconcile)
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
