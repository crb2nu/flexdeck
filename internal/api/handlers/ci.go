package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"
)

type RepoInfo struct {
	Name          string `json:"name"`
	Path          string `json:"path"`
	Type          string `json:"type"` // "gitlab", "github", "none"
	HasConfig     bool   `json:"hasConfig"`
	ConfigContent string `json:"configContent,omitempty"`
}

func (h *Handler) ListRepositories(w http.ResponseWriter, r *http.Request) {
	repos := []RepoInfo{}

	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

	if token == "" {
		// Log warning or return empty if no token
		slog.Warn("GitLab token not configured")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(repos)
		return
	}

	// 1. Fetch Projects
	// Using simple membership=true to get user's projects
	apiURL := fmt.Sprintf("%s/api/v4/projects?membership=true&simple=true&per_page=20", gitlabURL)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		http.Error(w, "Failed to create request", http.StatusInternalServerError)
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		slog.Error("Failed to fetch GitLab projects", "error", err)
		http.Error(w, "Failed to fetch projects", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Error("GitLab API error", "status", resp.Status)
		http.Error(w, "GitLab API error", http.StatusBadGateway)
		return
	}

	var projects []struct {
		ID                int    `json:"id"`
		PathWithNamespace string `json:"path_with_namespace"`
		Name              string `json:"name"`
		DefaultBranch     string `json:"default_branch"`
		WebURL            string `json:"web_url"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&projects); err != nil {
		slog.Error("Failed to decode projects", "error", err)
		http.Error(w, "Failed to decode projects", http.StatusInternalServerError)
		return
	}

	// 2. For each project, check for .gitlab-ci.yml
	// In production, you might want to do this async or on-demand, fetching content only when selected.
	// For now, we'll fetch it for the list as requested, but maybe limited to top 20
	// To optimize, we could maybe search for files... but let's just try fetching the file.

	for _, p := range projects {
		repo := RepoInfo{
			Name: p.PathWithNamespace,
			Path: p.WebURL,
			Type: "gitlab",
		}

		// Fetch .gitlab-ci.yml
		// /projects/:id/repository/files/:file_path/raw?ref=master
		ciFileObj := ".gitlab-ci.yml"
		// Only attempt if default branch is set
		ref := p.DefaultBranch
		if ref == "" {
			ref = "main" // fallback
		}

		fileURL := fmt.Sprintf("%s/api/v4/projects/%d/repository/files/%s/raw?ref=%s", gitlabURL, p.ID, ciFileObj, ref)
		fileReq, _ := http.NewRequest("GET", fileURL, nil)
		fileReq.Header.Set("PRIVATE-TOKEN", token)

		fileResp, err := client.Do(fileReq)
		if err == nil && fileResp.StatusCode == http.StatusOK {
			content, _ := io.ReadAll(fileResp.Body)
			repo.HasConfig = true
			repo.ConfigContent = string(content)
			fileResp.Body.Close()
		} else if fileResp != nil {
			fileResp.Body.Close()
		}

		repos = append(repos, repo)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repos)
}
