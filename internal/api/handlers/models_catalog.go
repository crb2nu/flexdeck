package handlers

import (
	"log/slog"
	"net/http"
	"time"
)

// ModelsCatalog lists ModelCatalog CRDs from the configured AI namespace.
func (h *Handler) ModelsCatalog(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "k8s disabled"})
		return
	}

	ns := h.cfg.Models.AINamespace
	if ns == "" {
		ns = "ai"
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "models:catalogs", 60*time.Second, func() (any, error) {
			catalogs, err := h.k8s.ListModelCatalogs(ctx, ns)
			if err != nil {
				return nil, err
			}
			return map[string]any{"catalogs": catalogs, "namespace": ns}, nil
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
		slog.Warn("catalogs cache error", "error", err)
	}

	catalogs, err := h.k8s.ListModelCatalogs(ctx, ns)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{"catalogs": catalogs, "namespace": ns})
}
