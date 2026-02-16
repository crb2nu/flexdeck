package handlers

import (
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// ModelsLoRA lists LoRA adapters for a given model namespace/name.
func (h *Handler) ModelsLoRA(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	if h.k8s == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "k8s disabled"})
		return
	}

	ctx := r.Context()
	cacheKey := fmt.Sprintf("models:lora:%s:%s", ns, name)

	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, cacheKey, 30*time.Second, func() (any, error) {
			adapters, err := h.k8s.ListLoRAAdapters(ctx, ns)
			if err != nil {
				return nil, err
			}
			// Filter to adapters referencing this model
			var filtered []any
			for _, a := range adapters {
				if a.ModelRef == name {
					filtered = append(filtered, a)
				}
			}
			if filtered == nil {
				filtered = []any{}
			}
			return map[string]any{"adapters": filtered, "model": name, "namespace": ns}, nil
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
		slog.Warn("lora cache error", "error", err)
	}

	adapters, err := h.k8s.ListLoRAAdapters(ctx, ns)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}

	var filtered []any
	for _, a := range adapters {
		if a.ModelRef == name {
			filtered = append(filtered, a)
		}
	}
	if filtered == nil {
		filtered = []any{}
	}

	respondJSON(w, http.StatusOK, map[string]any{"adapters": filtered, "model": name, "namespace": ns})
}
