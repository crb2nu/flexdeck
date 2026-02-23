package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/flexinfer/flexdeck/internal/cluster"
)

// ClustersList returns all registered clusters (tokens redacted).
func (h *Handler) ClustersList(w http.ResponseWriter, r *http.Request) {
	if h.clusterRegistry == nil {
		http.Error(w, "multi-cluster disabled", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(h.clusterRegistry.List())
}

// ClustersGet returns a single cluster by ID.
func (h *Handler) ClustersGet(w http.ResponseWriter, r *http.Request) {
	if h.clusterRegistry == nil {
		http.Error(w, "multi-cluster disabled", http.StatusServiceUnavailable)
		return
	}
	c, err := h.clusterRegistry.Get(chi.URLParam(r, "id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(c)
}

// ClustersCreate adds a new cluster.
func (h *Handler) ClustersCreate(w http.ResponseWriter, r *http.Request) {
	if h.clusterRegistry == nil {
		http.Error(w, "multi-cluster disabled", http.StatusServiceUnavailable)
		return
	}

	var c cluster.ClusterInfo
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if c.Name == "" || c.Host == "" {
		http.Error(w, "name and host are required", http.StatusBadRequest)
		return
	}

	if err := h.clusterRegistry.Create(&c); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	redacted := c.Redacted()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(&redacted)
}

// ClustersUpdate modifies a cluster.
func (h *Handler) ClustersUpdate(w http.ResponseWriter, r *http.Request) {
	if h.clusterRegistry == nil {
		http.Error(w, "multi-cluster disabled", http.StatusServiceUnavailable)
		return
	}

	var c cluster.ClusterInfo
	if err := json.NewDecoder(r.Body).Decode(&c); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	c.ID = chi.URLParam(r, "id")

	if err := h.clusterRegistry.Update(&c); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// Evict cached K8s client so it gets re-created with new config
	if h.clusterManager != nil {
		h.clusterManager.RemoveClient(c.ID)
	}

	redacted := c.Redacted()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(&redacted)
}

// ClustersDelete removes a cluster.
func (h *Handler) ClustersDelete(w http.ResponseWriter, r *http.Request) {
	if h.clusterRegistry == nil {
		http.Error(w, "multi-cluster disabled", http.StatusServiceUnavailable)
		return
	}

	id := chi.URLParam(r, "id")
	if err := h.clusterRegistry.Delete(id); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	if h.clusterManager != nil {
		h.clusterManager.RemoveClient(id)
	}

	w.WriteHeader(http.StatusNoContent)
}

// ClustersTest tests connectivity to a cluster.
func (h *Handler) ClustersTest(w http.ResponseWriter, r *http.Request) {
	if h.clusterRegistry == nil || h.clusterManager == nil {
		http.Error(w, "multi-cluster disabled", http.StatusServiceUnavailable)
		return
	}

	id := chi.URLParam(r, "id")
	info, err := h.clusterRegistry.GetRaw(id)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := h.clusterManager.TestConnection(r.Context(), info); err != nil {
		h.clusterRegistry.UpdateStatus(id, "disconnected")
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}

	h.clusterRegistry.UpdateStatus(id, "connected")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

// ClustersSetDefault sets a cluster as the default.
func (h *Handler) ClustersSetDefault(w http.ResponseWriter, r *http.Request) {
	if h.clusterRegistry == nil {
		http.Error(w, "multi-cluster disabled", http.StatusServiceUnavailable)
		return
	}

	if err := h.clusterRegistry.SetDefault(chi.URLParam(r, "id")); err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
