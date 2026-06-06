package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/flexinfer/flexdeck/internal/cache"
	"github.com/flexinfer/flexdeck/internal/workspace"
)

// WorkspaceRepos returns a read-only inventory of local services and libs.
func (h *Handler) WorkspaceRepos(w http.ResponseWriter, r *http.Request) {
	if h.cfg == nil || strings.TrimSpace(h.cfg.WorkspaceDir) == "" {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "workspace root not configured"})
		return
	}

	scanCtx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	scan := func(ctx context.Context) (any, error) {
		return workspace.Scan(ctx, h.cfg.WorkspaceDir, workspace.ScanOptions{})
	}

	if h.cache != nil {
		cached, err := h.cache.GetOrFetchWithOptions(scanCtx, "workspace:repos", cache.FetchOptions{
			TTL:                      30 * time.Second,
			StaleTTL:                 2 * time.Minute,
			JitterFraction:           0.1,
			BackgroundRefreshTimeout: 5 * time.Second,
		}, scan)
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
	}

	inventory, err := scan(scanCtx)
	if err != nil {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, inventory)
}
