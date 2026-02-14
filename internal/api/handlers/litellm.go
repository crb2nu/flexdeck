package handlers

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// LiteLLMHealth checks LiteLLM service health
func (h *Handler) LiteLLMHealth(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LiteLLM.Disabled || h.cfg.LiteLLM.URL == "" {
		respondJSON(w, http.StatusOK, map[string]any{
			"healthy":  false,
			"disabled": true,
		})
		return
	}

	if h.litellm == nil {
		respondJSON(w, http.StatusOK, map[string]any{
			"healthy": false,
			"error":   "litellm client not initialized",
		})
		return
	}

	healthy, err := h.litellm.Health(r.Context())
	if err != nil {
		respondJSON(w, http.StatusOK, map[string]any{
			"healthy": false,
			"error":   err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"healthy": healthy,
	})
}

// LiteLLMMetrics returns aggregated tok/s metrics for all models
func (h *Handler) LiteLLMMetrics(w http.ResponseWriter, r *http.Request) {
	if h.cfg.LiteLLM.Disabled || h.metricsStore == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "litellm metrics disabled",
		})
		return
	}

	// Try cached throughput first (5s TTL)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), "litellm:throughput", 5*time.Second, func() (any, error) {
			return h.metricsStore.GetThroughput(r.Context())
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	throughput, err := h.metricsStore.GetThroughput(r.Context())
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"models": throughput,
	})
}

// LiteLLMModelMetrics returns metrics for a specific model
func (h *Handler) LiteLLMModelMetrics(w http.ResponseWriter, r *http.Request) {
	model := chi.URLParam(r, "model")
	if model == "" {
		http.Error(w, "missing model parameter", http.StatusBadRequest)
		return
	}

	if h.cfg.LiteLLM.Disabled || h.metricsStore == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "litellm metrics disabled",
		})
		return
	}

	throughput, err := h.metricsStore.GetModelThroughput(r.Context(), model)
	if err != nil {
		respondJSON(w, http.StatusNotFound, map[string]any{
			"error": err.Error(),
		})
		return
	}

	respondJSON(w, http.StatusOK, throughput)
}
