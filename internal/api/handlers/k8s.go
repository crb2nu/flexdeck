package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
)

func (h *Handler) K8sServices(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	services, err := h.k8s.GetServices(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(services)
}

func (h *Handler) K8sNodes(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	nodes, err := h.k8s.GetNodes(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(nodes)
}

func (h *Handler) K8sDeployments(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	deployments, err := h.k8s.GetDeployments(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(deployments)
}

func (h *Handler) K8sPods(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	pods, err := h.k8s.GetPods(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pods)
}

func (h *Handler) K8sIngresses(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	ingresses, err := h.k8s.GetIngresses(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ingresses)
}

func (h *Handler) K8sScale(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")
	replicasStr := r.URL.Query().Get("replicas")

	replicas, err := strconv.ParseInt(replicasStr, 10, 32)
	if err != nil {
		http.Error(w, "invalid replicas parameter", http.StatusBadRequest)
		return
	}

	if err := h.k8s.ScaleDeployment(r.Context(), ns, name, int32(replicas)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":       true,
		"name":     name,
		"replicas": replicas,
	})
}

func (h *Handler) K8sRestart(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	if err := h.k8s.RestartDeployment(r.Context(), ns, name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":   true,
		"name": name,
	})
}
