package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/flexinfer/flexdeck/internal/cache"
	"github.com/flexinfer/flexdeck/internal/workspace"
)

// WorkspaceRepos returns a read-only inventory of services and libs. It prefers
// the GitLab API (every repo + real git metadata, independent of the disk
// sync) and falls back to scanning the mounted workspace when no GitLab token
// is configured.
func (h *Handler) WorkspaceRepos(w http.ResponseWriter, r *http.Request) {
	useGitLab := h.cfg != nil &&
		strings.TrimSpace(h.cfg.GitLab.Token) != "" &&
		strings.TrimSpace(h.cfg.GitLab.URL) != ""
	if !useGitLab && (h.cfg == nil || strings.TrimSpace(h.cfg.WorkspaceDir) == "") {
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "workspace inventory not configured"})
		return
	}

	scanCtx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	// Captured once per request so the cached background refresh can reuse it.
	// Verifying bindings against live Flux state is best-effort: when no cluster
	// client is available the inventory keeps its inferred bindings.
	kc := h.k8sForRequest(r)

	scan := func(ctx context.Context) (any, error) {
		var inventory *workspace.Inventory
		var err error
		if useGitLab {
			client := h.gitlabClient
			if client == nil {
				client = newGitLabClient()
			}
			inventory, err = workspace.ScanGitLab(ctx, workspace.GitLabScanOptions{
				BaseURL: h.cfg.GitLab.URL,
				Token:   h.cfg.GitLab.Token,
				Client:  client,
				Buckets: []string{workspace.BucketServices, workspace.BucketLibs},
			})
		} else {
			inventory, err = workspace.Scan(ctx, h.cfg.WorkspaceDir, workspace.ScanOptions{})
		}
		if err != nil {
			return nil, err
		}
		workspace.EnrichBindings(inventory, h.fluxBindingTargets(ctx, kc))
		return inventory, nil
	}

	if h.cache != nil {
		cached, err := h.cache.GetOrFetchWithOptions(scanCtx, "workspace:repos", cache.FetchOptions{
			TTL:                      30 * time.Second,
			StaleTTL:                 2 * time.Minute,
			JitterFraction:           0.1,
			BackgroundRefreshTimeout: 20 * time.Second,
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
