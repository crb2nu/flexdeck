package handlers

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type RepoInfo struct {
	Name          string `json:"name"`
	Path          string `json:"path"`
	Type          string `json:"type"` // "gitlab", "github", "none"
	HasConfig     bool   `json:"hasConfig"`
	ConfigContent string `json:"configContent,omitempty"`
}

func (h *Handler) ListRepositories(w http.ResponseWriter, r *http.Request) {
	workspace := h.cfg.WorkspaceDir
	repos := []RepoInfo{}

	// Max depth to search
	maxDepth := 3

	filepath.WalkDir(workspace, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			return nil
		}

		// Calculate depth
		rel, err := filepath.Rel(workspace, path)
		if err != nil {
			return nil
		}

		if rel == "." {
			return nil
		}

		depth := strings.Count(rel, string(os.PathSeparator)) + 1

		// Check if .git exists in this dir
		if _, err := os.Stat(filepath.Join(path, ".git")); err == nil {
			// Found a repo
			repo := RepoInfo{
				Name:      filepath.Base(path),
				Path:      path,
				Type:      "none",
				HasConfig: false,
			}

			// Check for .gitlab-ci.yml
			if content, err := os.ReadFile(filepath.Join(path, ".gitlab-ci.yml")); err == nil {
				repo.Type = "gitlab"
				repo.HasConfig = true
				repo.ConfigContent = string(content)
			} else if _, err := os.Stat(filepath.Join(path, ".github", "workflows")); err == nil {
				repo.Type = "github"
				repo.HasConfig = true
				// For GitHub, we might need to list files, but for now just mark as present
			}

			repos = append(repos, repo)
			return fs.SkipDir // Don't traverse inside a repo (assume no nested repos)
		}

		if depth >= maxDepth {
			return fs.SkipDir
		}

		return nil
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repos)
}
