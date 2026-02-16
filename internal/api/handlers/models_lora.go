package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// ModelsLoRA lists LoRA adapters for a given model namespace/name.
func (h *Handler) ModelsLoRA(w http.ResponseWriter, r *http.Request) {
	ns := chi.URLParam(r, "namespace")
	name := chi.URLParam(r, "name")

	kc := h.k8sForRequest(r)
	if kc == nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "k8s disabled"})
		return
	}

	ctx := r.Context()
	cacheKey := fmt.Sprintf("models:lora:%s:%s", ns, name)

	h.cachedProxyJSON(w, r, cacheKey, 30*time.Second, "lora", func() (any, error) {
		adapters, err := kc.ListLoRAAdapters(ctx, ns)
		if err != nil {
			return nil, err
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
		return map[string]any{"adapters": filtered, "model": name, "namespace": ns}, nil
	})
}
