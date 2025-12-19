package handlers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

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
		Source   string `json:"source"`   // "huggingface" or "civitai"
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
