package handlers

import (
	"encoding/json"
	"net/http"
)

// UI Config handler
func (h *Handler) UIConfig(w http.ResponseWriter, r *http.Request) {
	// TODO: Load from UI_CONFIG_DIR
	config := map[string]any{
		"title":  "FLEXDECK",
		"accent": "#00f0ff",
		"links":  []any{},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(config)
}

// vLLM handlers - stubs for now
func (h *Handler) VLLMHealth(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "vllm health")
}

func (h *Handler) VLLMModels(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "vllm models")
}

func (h *Handler) VLLMDeployments(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "vllm deployments")
}

func (h *Handler) VLLMActivate(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "vllm activate")
}

func (h *Handler) VLLMAgent(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "vllm agent")
}

// Cache handlers - stubs for now
func (h *Handler) CacheStats(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "cache stats")
}

func (h *Handler) CacheModels(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "cache models")
}

func (h *Handler) CacheDownload(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "cache download")
}

func (h *Handler) CacheDelete(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "cache delete")
}

// Flux handlers - stubs for now
func (h *Handler) FluxKustomizations(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "flux kustomizations")
}

func (h *Handler) FluxReconcile(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "flux reconcile")
}

// AI Stack handler - stub for now
func (h *Handler) AIStackStatus(w http.ResponseWriter, r *http.Request) {
	respondNotImplemented(w, "aistack status")
}

func respondNotImplemented(w http.ResponseWriter, feature string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotImplemented)
	json.NewEncoder(w).Encode(map[string]any{
		"error":   "not implemented",
		"feature": feature,
	})
}
