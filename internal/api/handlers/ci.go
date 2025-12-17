package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

type RepoInfo struct {
	ID            int    `json:"id"`
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

	// Read body first to debug if needed
	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		slog.Error("Failed to read response body", "error", err)
		http.Error(w, "Failed to read response", http.StatusInternalServerError)
		return
	}

	var projects []struct {
		ID                int    `json:"id"`
		PathWithNamespace string `json:"path_with_namespace"`
		Name              string `json:"name"`
		DefaultBranch     string `json:"default_branch"`
		WebURL            string `json:"web_url"`
	}

	if err := json.Unmarshal(bodyBytes, &projects); err != nil {
		// Log the body snippet for debugging html responses
		snippet := string(bodyBytes)
		if len(snippet) > 500 {
			snippet = snippet[:500]
		}
		slog.Error("Failed to decode projects", "error", err, "body_snippet", snippet)
		http.Error(w, "Failed to decode projects response", http.StatusInternalServerError)
		return
	}

	// 2. For each project, check for .gitlab-ci.yml
	// In production, you might want to do this async or on-demand, fetching content only when selected.
	// For now, we'll fetch it for the list as requested, but maybe limited to top 20
	// To optimize, we could maybe search for files... but let's just try fetching the file.

	for _, p := range projects {
		repo := RepoInfo{
			ID:   p.ID,
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

		// Use the configured internal URL, but we might want to ensure we don't break if it's external.
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
			// If file fetch fails (e.g. 404), just ignore config
			// slog.Info("Failed to fetch CI file", "repo", p.PathWithNamespace, "status", fileResp.Status)
			fileResp.Body.Close()
		}

		repos = append(repos, repo)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(repos)
}

func (h *Handler) GetRepoPipeline(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

	if token == "" {
		http.Error(w, "GitLab token not configured", http.StatusUnauthorized)
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}

	// 1. Get Latest Pipeline
	pipelineURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines?per_page=1", gitlabURL, idStr)
	req, _ := http.NewRequest("GET", pipelineURL, nil)
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != http.StatusOK {
		http.Error(w, "Failed to fetch pipeline", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	var pipelines []struct {
		ID        int       `json:"id"`
		Status    string    `json:"status"`
		Ref       string    `json:"ref"`
		CreatedAt time.Time `json:"created_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&pipelines); err != nil || len(pipelines) == 0 {
		http.Error(w, "No pipeline found", http.StatusNotFound)
		return
	}
	latest := pipelines[0]

	// 2. Get Pipeline Jobs
	jobsURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines/%d/jobs", gitlabURL, idStr, latest.ID)
	jReq, _ := http.NewRequest("GET", jobsURL, nil)
	jReq.Header.Set("PRIVATE-TOKEN", token)

	jResp, err := client.Do(jReq)
	if err != nil || jResp.StatusCode != http.StatusOK {
		http.Error(w, "Failed to fetch jobs", http.StatusInternalServerError)
		return
	}
	defer jResp.Body.Close()

	var jobs []struct {
		ID         int     `json:"id"`
		Name       string  `json:"name"`
		Stage      string  `json:"stage"`
		Status     string  `json:"status"`
		Duration   float64 `json:"duration"`
		StartedAt  string  `json:"started_at"`
		FinishedAt string  `json:"finished_at"`
	}
	json.NewDecoder(jResp.Body).Decode(&jobs)

	// Map to frontend Pipeline structure
	type Job struct {
		ID         string  `json:"id"`
		Name       string  `json:"name"`
		Stage      string  `json:"stage"`
		Status     string  `json:"status"`
		Duration   float64 `json:"duration"`
		StartedAt  string  `json:"startedAt"`
		FinishedAt string  `json:"finishedAt"`
	}

	type Stage struct {
		Name string `json:"name"`
		Jobs []Job  `json:"jobs"`
	}

	type PipelineResponse struct {
		ID        string  `json:"id"`
		Ref       string  `json:"ref"`
		Status    string  `json:"status"`
		CreatedAt string  `json:"createdAt"`
		Stages    []Stage `json:"stages"`
	}

	// Group jobs by stage
	stageMap := make(map[string][]Job)

	// GitLab jobs typically come newest first, we reverse this iteration potentially if we want execution order
	// but standard grouping is safer.

	seenStages := []string{}
	seenStagesSet := make(map[string]bool)

	// Pre-define standard order
	stdOrder := []string{".pre", "build", "test", "deploy", ".post"}
	for _, s := range stdOrder {
		if !seenStagesSet[s] {
			seenStagesSet[s] = true
			seenStages = append(seenStages, s)
		}
	}

	for _, j := range jobs {
		jobFormatted := Job{
			ID:         fmt.Sprintf("%d", j.ID),
			Name:       j.Name,
			Stage:      j.Stage,
			Status:     j.Status,
			Duration:   j.Duration,
			StartedAt:  j.StartedAt,
			FinishedAt: j.FinishedAt,
		}

		if _, exists := stageMap[j.Stage]; !exists {
			stageMap[j.Stage] = []Job{}
			if !seenStagesSet[j.Stage] {
				seenStages = append(seenStages, j.Stage)
				seenStagesSet[j.Stage] = true
			}
		}
		stageMap[j.Stage] = append(stageMap[j.Stage], jobFormatted)
	}

	stages := []Stage{}
	for _, sName := range seenStages {
		if jList, ok := stageMap[sName]; ok && len(jList) > 0 {
			stages = append(stages, Stage{
				Name: sName,
				Jobs: jList,
			})
		}
	}

	respData := PipelineResponse{
		ID:        fmt.Sprintf("%d", latest.ID),
		Ref:       latest.Ref,
		Status:    latest.Status,
		CreatedAt: latest.CreatedAt.Format(time.RFC3339),
		Stages:    stages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(respData)
}
