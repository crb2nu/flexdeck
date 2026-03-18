package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/flexinfer/flexdeck/internal/infra"
)

// InfraSnapshot serves the pre-built infrastructure snapshot from Redis.
// Falls back to synchronous build if the worker has not yet populated the cache.
func (h *Handler) InfraSnapshot(w http.ResponseWriter, r *http.Request) {
	if h.cache == nil {
		// No Redis — build on demand if worker is available.
		if h.infraWorker == nil {
			http.Error(w, "infra cache not available", http.StatusServiceUnavailable)
			return
		}
		snap, err := h.infraWorker.BuildSnapshot(r.Context())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(snap)
		return
	}

	cached, err := h.cache.GetOrFetch(r.Context(), "infra:snapshot", 90*time.Second, func() (any, error) {
		if h.infraWorker != nil {
			return h.infraWorker.BuildSnapshot(r.Context())
		}
		return nil, fmt.Errorf("infra worker not initialised")
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(cached)
}

// K8sNetworkPolicies lists NetworkPolicy resources across all (or a single) namespace.
func (h *Handler) K8sNetworkPolicies(w http.ResponseWriter, r *http.Request) {
	kc := h.k8sForRequest(r)
	if kc == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	cacheKey := fmt.Sprintf("k8s:networkpolicies:%s", ns)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), cacheKey, 30*time.Second, func() (any, error) {
			return kc.GetNetworkPolicies(r.Context(), ns)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
	}

	policies, err := kc.GetNetworkPolicies(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(policies)
}

// infraWorkerInterface is satisfied by *infra.Worker but avoids a circular import
// from the handlers package. We use the concrete type via the Handler field instead.
var _ = (*infra.Worker)(nil)
