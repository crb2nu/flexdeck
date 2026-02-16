package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/flexinfer/flexdeck/internal/models"
)

// ModelsList returns all registered models
func (h *Handler) ModelsList(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.modelsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "models feature disabled",
		})
		return
	}

	modelList := h.modelsRegistry.List()
	respondJSON(w, http.StatusOK, map[string]any{
		"models": modelList,
	})
}

// ModelsGet returns a specific model
func (h *Handler) ModelsGet(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.modelsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "models feature disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")
	model, err := h.modelsRegistry.Get(id)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, model)
}

// ModelsRegister registers a new model
func (h *Handler) ModelsRegister(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.modelsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "models feature disabled",
		})
		return
	}

	var req struct {
		Source   string `json:"source"`    // "huggingface" or "civitai"
		SourceID string `json:"source_id"` // HF repo ID or CivitAI model ID
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid request body",
		})
		return
	}

	var model *models.Model

	switch models.ModelSource(req.Source) {
	case models.SourceHuggingFace:
		if h.hfClient == nil {
			respondJSON(w, http.StatusServiceUnavailable, map[string]any{
				"error": "huggingface client not configured",
			})
			return
		}

		hfModel, err := h.hfClient.GetModel(r.Context(), req.SourceID)
		if err != nil {
			respondJSON(w, http.StatusBadRequest, map[string]any{
				"error": fmt.Sprintf("failed to fetch HuggingFace model: %v", err),
			})
			return
		}

		model = h.hfClient.ToModel(hfModel)

		// Get size
		if size, err := h.hfClient.GetTotalSize(r.Context(), req.SourceID); err == nil {
			model.Size = size
		}

	case models.SourceCivitAI:
		if h.civitClient == nil {
			respondJSON(w, http.StatusServiceUnavailable, map[string]any{
				"error": "civitai client not configured",
			})
			return
		}

		var modelID int
		if _, err := fmt.Sscanf(req.SourceID, "%d", &modelID); err != nil {
			respondJSON(w, http.StatusBadRequest, map[string]any{
				"error": "civitai source_id must be a number",
			})
			return
		}

		civitModel, err := h.civitClient.GetModel(r.Context(), modelID)
		if err != nil {
			respondJSON(w, http.StatusBadRequest, map[string]any{
				"error": fmt.Sprintf("failed to fetch CivitAI model: %v", err),
			})
			return
		}

		model = h.civitClient.ToModel(civitModel)

	default:
		respondJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid source, must be 'huggingface' or 'civitai'",
		})
		return
	}

	if err := h.modelsRegistry.Register(model); err != nil {
		respondJSON(w, http.StatusConflict, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusCreated, model)
}

// ModelsDelete removes a model from the registry
func (h *Handler) ModelsDelete(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.modelsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "models feature disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")
	if err := h.modelsRegistry.Delete(id); err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"deleted": id,
	})
}

// ModelsSearchHuggingFace searches HuggingFace for models
func (h *Handler) ModelsSearchHuggingFace(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.hfClient == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "huggingface search disabled",
		})
		return
	}

	query := r.URL.Query().Get("q")
	filter := r.URL.Query().Get("filter")
	limitStr := r.URL.Query().Get("limit")

	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	results, err := h.hfClient.Search(r.Context(), query, filter, limit)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": err.Error(),
		})
		return
	}

	// Convert to our model format
	modelResults := make([]*models.Model, len(results))
	for i, hf := range results {
		modelResults[i] = h.hfClient.ToModel(&hf)
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"models": modelResults,
		"count":  len(modelResults),
	})
}

// ModelsSearchCivitAI searches CivitAI for models
func (h *Handler) ModelsSearchCivitAI(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.civitClient == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "civitai search disabled",
		})
		return
	}

	query := r.URL.Query().Get("q")
	modelType := r.URL.Query().Get("type")
	limitStr := r.URL.Query().Get("limit")

	limit := 20
	if limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	results, err := h.civitClient.Search(r.Context(), query, models.CivitAIModelType(modelType), limit)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": err.Error(),
		})
		return
	}

	// Convert to our model format
	modelResults := make([]*models.Model, len(results))
	for i, civit := range results {
		modelResults[i] = h.civitClient.ToModel(&civit)
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"models": modelResults,
		"count":  len(modelResults),
	})
}

// ModelsStartDownload starts downloading a model
func (h *Handler) ModelsStartDownload(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.modelsDownloader == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "model downloads disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")
	model, err := h.modelsRegistry.Get(id)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	if err := h.modelsDownloader.StartDownload(r.Context(), model, nil); err != nil {
		respondJSON(w, http.StatusConflict, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusAccepted, map[string]any{
		"message": "download started",
		"model":   model,
	})
}

// ModelsDownloadProgress returns download progress via SSE
func (h *Handler) ModelsDownloadProgress(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.modelsDownloader == nil {
		http.Error(w, "model downloads disabled", http.StatusServiceUnavailable)
		return
	}

	id := chi.URLParam(r, "id")

	// Check if download is in progress
	progress, exists := h.modelsDownloader.GetProgress(id)
	if !exists {
		http.Error(w, "no download in progress", http.StatusNotFound)
		return
	}

	// Setup SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	// Create channel for progress updates
	progressCh := make(chan models.DownloadProgress, 10)
	h.modelsDownloader.SubscribeProgress(id, func(p models.DownloadProgress) {
		select {
		case progressCh <- p:
		default:
		}
	})

	// Send initial progress
	sendSSE(w, flusher, "progress", progress)

	// Stream updates
	for {
		select {
		case <-r.Context().Done():
			return
		case p := <-progressCh:
			sendSSE(w, flusher, "progress", &p)
			if p.Status == "completed" || p.Status == "failed" {
				return
			}
		}
	}
}

// ModelsCancelDownload cancels a model download
func (h *Handler) ModelsCancelDownload(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.modelsDownloader == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "model downloads disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")
	if err := h.modelsDownloader.CancelDownload(id); err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"cancelled": id,
	})
}

// ModelsDeploy creates deployment manifests for a model
func (h *Handler) ModelsDeploy(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.gitopsGen == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "model deployment disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")
	model, err := h.modelsRegistry.Get(id)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	var config models.DeploymentConfig
	if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid request body",
		})
		return
	}

	if config.ModelPath == "" {
		config.ModelPath = model.LocalPath
	}

	if err := h.gitopsGen.WriteManifests(model, config); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": err.Error(),
		})
		return
	}

	// Update model deployment status
	h.modelsRegistry.UpdateDeploymentStatus(
		id,
		models.DeploymentPending,
		config.Name,
		config.Namespace,
		config.Replicas,
	)

	respondJSON(w, http.StatusOK, map[string]any{
		"message": "deployment manifests created",
		"model":   model,
		"config":  config,
	})
}

// ModelsScale scales a model deployment
func (h *Handler) ModelsScale(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.modelsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "models feature disabled",
		})
		return
	}

	id := chi.URLParam(r, "id")
	model, err := h.modelsRegistry.Get(id)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	var req struct {
		Replicas int `json:"replicas"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid request body",
		})
		return
	}

	// Use K8s client to scale if available
	if h.k8s != nil && model.DeploymentName != "" && model.DeploymentNS != "" {
		if err := h.k8s.ScaleDeployment(r.Context(), model.DeploymentNS, model.DeploymentName, int32(req.Replicas)); err != nil {
			respondJSON(w, http.StatusInternalServerError, map[string]any{
				"error": fmt.Sprintf("failed to scale: %v", err),
			})
			return
		}
	}

	// Update registry
	status := models.DeploymentDeployed
	if req.Replicas == 0 {
		status = models.DeploymentStopped
	}
	h.modelsRegistry.UpdateDeploymentStatus(id, status, model.DeploymentName, model.DeploymentNS, req.Replicas)

	respondJSON(w, http.StatusOK, map[string]any{
		"scaled":   id,
		"replicas": req.Replicas,
	})
}

func sendSSE(w http.ResponseWriter, flusher http.Flusher, event string, data any) {
	jsonData, err := json.Marshal(data)
	if err != nil {
		slog.Warn("sendSSE: failed to marshal data", "error", err)
		return
	}
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, jsonData)
	flusher.Flush()
}

// ModelsDiscoverK8s scans Kubernetes for flexinfer-managed model deployments
// and syncs them to the models registry. This enables automatic discovery of
// models deployed by the flexinfer controller.
func (h *Handler) ModelsDiscoverK8s(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Models.Disabled || h.modelsRegistry == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "models feature disabled",
		})
		return
	}

	if h.k8s == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "kubernetes client not configured",
		})
		return
	}

	// Namespace to scan - use flexinfer-system or configured AI namespace
	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = h.cfg.Models.AINamespace
		if namespace == "" {
			namespace = "ai"
		}
	}

	discovered, err := h.SyncModelsFromK8s(r.Context(), namespace)
	if err != nil {
		slog.Error("ModelsDiscoverK8s: failed to sync models", "error", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": fmt.Sprintf("failed to discover models: %v", err),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"discovered": discovered,
		"namespace":  namespace,
	})
}

// SyncModelsFromK8s queries K8s for flexinfer model deployments and syncs to registry.
// Exported for use by auto-discovery on startup.
func (h *Handler) SyncModelsFromK8s(ctx context.Context, namespace string) (int, error) {
	deployments, err := h.k8s.GetDeployments(ctx, namespace)
	if err != nil {
		return 0, fmt.Errorf("failed to list deployments: %w", err)
	}

	discovered := 0
	for _, dep := range deployments.Items {
		labels := dep.Labels
		podLabels := dep.Spec.Template.Labels

		getLabel := func(key string) string {
			if labels != nil {
				if v := labels[key]; v != "" {
					return v
				}
			}
			if podLabels != nil {
				if v := podLabels[key]; v != "" {
					return v
				}
			}
			return ""
		}

		// Primary discovery signal: served model annotation (matches actual k3s AI deployments)
		servedModel := ""
		aliases := ""
		description := ""
		if dep.Annotations != nil {
			servedModel = dep.Annotations["litellm.flexinfer.ai/served-model"]
			aliases = dep.Annotations["litellm.flexinfer.ai/aliases"]
			description = dep.Annotations["description"]
		}

		// Backwards compatible: original flexinfer-managed label set.
		if servedModel == "" {
			if labels == nil {
				continue
			}
			managedBy := labels["app.kubernetes.io/managed-by"]
			appName := labels["app.kubernetes.io/name"]
			if managedBy != "flexinfer" || appName != "model" {
				continue
			}
			servedModel = labels["flexinfer.ai/model"]
			if servedModel == "" {
				servedModel = dep.Name
			}
		}

		// Registry ID should match what LiteLLM exposes via /v1/models where possible.
		modelID := servedModel

		// Display name: prefer explicit label when available (more readable than "served model" IDs).
		displayName := modelID
		if podLabels != nil {
			if v := podLabels["model"]; v != "" {
				displayName = v
			}
		}
		if v := getLabel("flexinfer.ai/model"); v != "" {
			displayName = v
		}

		// Extract model type from backend or annotations
		backend := getLabel("flexinfer.ai/backend")
		engine := getLabel("engine")
		component := getLabel("component")
		capability := getLabel("capability")
		modelType := models.TypeLLM // Default to LLM
		if backend == "stable-diffusion" || backend == "sdxl" || backend == "comfyui" ||
			engine == "comfyui" || engine == "stable-diffusion" {
			modelType = models.TypeDiffusion
		} else if backend == "embedding" || backend == "bge" || backend == "nomic" ||
			component == "embeddings" || containsIgnoreCase(modelID, "embedding") || containsIgnoreCase(modelID, "text-embedding") {
			modelType = models.TypeEmbedding
		}

		// Determine deployment status from replicas
		status := models.DeploymentStopped
		replicas := 0
		if dep.Spec.Replicas != nil {
			replicas = int(*dep.Spec.Replicas)
		}
		if dep.Status.ReadyReplicas > 0 {
			status = models.DeploymentDeployed
			replicas = int(dep.Status.ReadyReplicas)
		} else if replicas > 0 {
			status = models.DeploymentPending
		}

		// Build metadata from annotations
		metadata := make(map[string]any)
		if dep.Annotations != nil {
			if aliases != "" {
				metadata["aliases"] = aliases
			}
			if servedModel != "" {
				metadata["served_model"] = servedModel
			}
		}
		if gpuGroup := getLabel("flexinfer.ai/gpu-group"); gpuGroup != "" {
			metadata["gpu_group"] = gpuGroup
		}
		metadata["backend"] = backend
		metadata["engine"] = engine
		metadata["component"] = component
		if capability != "" {
			metadata["capability"] = capability
		}
		metadata["namespace"] = namespace
		if description != "" {
			metadata["description"] = description
		}

		// Hardware best-effort from scheduling hints.
		if dep.Spec.Template.Spec.NodeSelector != nil {
			if v := dep.Spec.Template.Spec.NodeSelector["gpu.amd.com/model"]; v != "" {
				metadata["hardware"] = "AMD " + v
			} else if v := dep.Spec.Template.Spec.NodeSelector["kubernetes.io/hostname"]; v != "" {
				metadata["node"] = v
				if containsIgnoreCase(v, "7900") {
					metadata["hardware"] = "AMD 7900 XTX"
				}
			}
		}

		// Extract parameter count from model name (e.g., "qwen3-14b-mlc" -> "14B")
		params := inferParamsFromName(displayName)
		if params == "" {
			params = inferParamsFromName(modelID)
		}
		if params != "" {
			metadata["parameters"] = params
		}

		// Create or update model in registry
		if existing, err := h.modelsRegistry.Get(modelID); err == nil && existing != nil {
			existing.Name = displayName
			existing.Source = models.SourceLocal
			existing.Type = modelType
			if description != "" {
				existing.Description = description
			}
			existing.DeploymentStatus = status
			existing.DeploymentName = dep.Name
			existing.DeploymentNS = namespace
			existing.Replicas = replicas
			existing.Metadata = metadata
			_ = h.modelsRegistry.Update(existing)
			discovered++
			continue
		}

		model := &models.Model{
			ID:               modelID,
			Name:             displayName,
			Source:           models.SourceLocal,
			Type:             modelType,
			Description:      description,
			DeploymentStatus: status,
			DeploymentName:   dep.Name,
			DeploymentNS:     namespace,
			Replicas:         replicas,
			Metadata:         metadata,
		}

		// Register new model
		if err := h.modelsRegistry.Register(model); err != nil {
			slog.Warn("syncModelsFromK8s: failed to register model",
				"model", modelID, "error", err)
			continue
		}

		discovered++
	}

	return discovered, nil
}

// inferParamsFromName extracts parameter count from model name
func inferParamsFromName(name string) string {
	// Extract parameter counts like "7b", "32B", "0.5b", "137m" from a model name.
	// Prefer the largest match to avoid substring collisions (e.g. "32b" contains "2b").
	//
	// Examples:
	// - qwen25-coder-32b -> 32B
	// - qwen2.5-7b -> 7B
	// - nemotron-3-nano-30b -> 30B
	re := regexp.MustCompile(`(?i)(?:^|[^0-9])(\d+(?:\.\d+)?)([bm])(?:[^a-z0-9]|$)`)
	matches := re.FindAllStringSubmatch(name, -1)
	if len(matches) == 0 {
		return ""
	}

	best := ""
	bestScore := -1.0
	for _, m := range matches {
		if len(m) < 3 {
			continue
		}
		v, err := strconv.ParseFloat(m[1], 64)
		if err != nil {
			continue
		}
		suffix := strToLower(m[2])
		mult := 1.0
		if suffix == "b" {
			mult = 1_000_000_000
		} else if suffix == "m" {
			mult = 1_000_000
		}
		score := v * mult
		if score > bestScore {
			bestScore = score
			best = m[1] + toUpper(suffix)
		}
	}

	return best
}

func strToLower(s string) string {
	result := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			c += 'a' - 'A'
		}
		result[i] = c
	}
	return string(result)
}

func toUpper(s string) string {
	result := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		result[i] = c
	}
	return string(result)
}

func containsIgnoreCase(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if strToLower(s[i:i+len(substr)]) == substr {
			return true
		}
	}
	return false
}

// ModelsCRDScale sets spec.serverless.minReplicas on a Model CRD.
func (h *Handler) ModelsCRDScale(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "k8s client unavailable"})
		return
	}

	namespace := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	var req struct {
		MinReplicas int32 `json:"minReplicas"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	if err := h.k8s.ScaleFlexInferModel(r.Context(), namespace, name, req.MinReplicas); err != nil {
		slog.Error("ModelsCRDScale: failed", "error", err, "model", name)
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	h.invalidateCRDCache(r.Context(), namespace)

	respondJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"model":       name,
		"minReplicas": req.MinReplicas,
	})
}

// ModelsCRDActivate sets minReplicas=1 to activate an idle/preempted model.
func (h *Handler) ModelsCRDActivate(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "k8s client unavailable"})
		return
	}

	namespace := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	if err := h.k8s.ScaleFlexInferModel(r.Context(), namespace, name, 1); err != nil {
		slog.Error("ModelsCRDActivate: failed", "error", err, "model", name)
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	h.invalidateCRDCache(r.Context(), namespace)

	respondJSON(w, http.StatusOK, map[string]any{"ok": true, "model": name, "action": "activate"})
}

// ModelsCRDRestart annotates the Model CRD with a restart timestamp.
func (h *Handler) ModelsCRDRestart(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "k8s client unavailable"})
		return
	}

	namespace := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	if err := h.k8s.RestartFlexInferModel(r.Context(), namespace, name); err != nil {
		slog.Error("ModelsCRDRestart: failed", "error", err, "model", name)
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	h.invalidateCRDCache(r.Context(), namespace)

	respondJSON(w, http.StatusOK, map[string]any{"ok": true, "model": name, "action": "restart"})
}

// ModelsCRDWatchSSE streams Model CRD watch events via Server-Sent Events.
func (h *Handler) ModelsCRDWatchSSE(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s client unavailable", http.StatusServiceUnavailable)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = "flexinfer-system"
	}

	ctx := r.Context()
	events, err := h.k8s.WatchFlexInferModels(ctx, namespace)
	if err != nil {
		slog.Error("ModelsCRDWatchSSE: watch failed", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher.Flush()

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-events:
			if !ok {
				return
			}
			sendSSE(w, flusher, "model", event)
		}
	}
}

// invalidateCRDCache clears cached K8s data for the given namespace after a CRD mutation.
func (h *Handler) invalidateCRDCache(ctx context.Context, namespace string) {
	if h.cache == nil {
		return
	}
	h.cache.Invalidate(ctx, fmt.Sprintf("k8s:pods:%s", namespace))
	h.cache.Invalidate(ctx, fmt.Sprintf("k8s:deployments:%s", namespace))
	h.cache.Invalidate(ctx, "topology:public")
}

// ModelsCRDEvents returns K8s events for a specific FlexInfer Model CRD.
func (h *Handler) ModelsCRDEvents(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "k8s client unavailable"})
		return
	}

	namespace := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	cacheKey := fmt.Sprintf("models:events:%s:%s", namespace, name)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), cacheKey, 15*time.Second, func() (any, error) {
			return h.k8s.GetFlexInferModelEvents(r.Context(), namespace, name)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	events, err := h.k8s.GetFlexInferModelEvents(r.Context(), namespace, name)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"events":    events,
		"model":     name,
		"namespace": namespace,
	})
}

// ModelsCRD queries flexinfer.ai/v1alpha2 Model CRDs directly from K8s.
// This returns the full CRD state: phase lifecycle, GPU allocation, metrics,
// serverless config, cache status, KV-cache pressure, and shared GPU groups.
func (h *Handler) ModelsCRD(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "kubernetes client not configured",
		})
		return
	}

	namespace := r.URL.Query().Get("namespace")
	if namespace == "" {
		namespace = h.cfg.Models.AINamespace
		if namespace == "" {
			namespace = "flexinfer-system"
		}
	}

	models, err := h.k8s.ListFlexInferModels(r.Context(), namespace)
	if err != nil {
		slog.Error("ModelsCRD: failed to list Model CRDs", "error", err, "namespace", namespace)
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": fmt.Sprintf("failed to list Model CRDs: %v", err),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"models":    models,
		"namespace": namespace,
		"count":     len(models),
	})
}
