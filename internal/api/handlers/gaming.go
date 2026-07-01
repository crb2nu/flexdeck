package handlers

import (
	"fmt"
	"log/slog"
	"net/http"
)

// GamingSessions returns ai.flexinfer/v1alpha2 GamingSession CRDs. A GamingSession
// claims a GPU node for game streaming (Sunshine/Moonlight) instead of LLM
// inference, so the fleet view can render a node as "gaming" rather than idle.
//
// Read-only: the gaming lifecycle is driven declaratively (GitOps CRs + Flux),
// so FlexDeck surfaces state but does not mutate it.
func (h *Handler) GamingSessions(w http.ResponseWriter, r *http.Request) {
	kc := h.k8sForRequest(r)
	if kc == nil {
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

	sessions, err := kc.ListGamingSessions(r.Context(), namespace)
	if err != nil {
		slog.Error("GamingSessions: failed to list GamingSession CRDs", "error", err, "namespace", namespace)
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": fmt.Sprintf("failed to list GamingSession CRDs: %v", err),
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"sessions":  sessions,
		"namespace": namespace,
		"count":     len(sessions),
	})
}
