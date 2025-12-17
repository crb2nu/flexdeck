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

	// Response types moved to top for reuse
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

	if token == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "GitLab token not configured",
		})
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}

	// 1. Get Latest Pipeline
	pipelineURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines?per_page=1", gitlabURL, idStr)
	req, err := http.NewRequest("GET", pipelineURL, nil)
	if err != nil {
		slog.Error("Failed to create request", "error", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to create request",
		})
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		slog.Error("Failed to fetch pipeline from GitLab", "error", err)
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": "Failed to connect to GitLab",
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("GitLab API returned non-OK status", "status", resp.StatusCode, "project", idStr)
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": fmt.Sprintf("GitLab API error: %d", resp.StatusCode),
		})
		return
	}

	var pipelines []struct {
		ID        int       `json:"id"`
		Status    string    `json:"status"`
		Ref       string    `json:"ref"`
		CreatedAt time.Time `json:"created_at"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&pipelines); err != nil {
		slog.Error("Failed to decode pipelines response", "error", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to decode pipelines",
		})
		return
	}

	// No pipelines found - return empty pipeline structure instead of error
	if len(pipelines) == 0 {
		respondJSON(w, http.StatusOK, PipelineResponse{
			ID:        "",
			Ref:       "",
			Status:    "none",
			CreatedAt: "",
			Stages:    []Stage{},
		})
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

// GetJobTrace fetches the trace/log output for a specific job
func (h *Handler) GetJobTrace(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	jobID := chi.URLParam(r, "jobId")
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

	if token == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "GitLab token not configured",
		})
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}

	// Fetch job trace from GitLab
	traceURL := fmt.Sprintf("%s/api/v4/projects/%s/jobs/%s/trace", gitlabURL, projectID, jobID)
	req, err := http.NewRequest("GET", traceURL, nil)
	if err != nil {
		slog.Error("Failed to create trace request", "error", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to create request",
		})
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		slog.Error("Failed to fetch job trace", "error", err)
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": "Failed to connect to GitLab",
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		slog.Warn("GitLab trace API returned non-OK", "status", resp.StatusCode, "job", jobID)
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": fmt.Sprintf("GitLab API error: %d", resp.StatusCode),
		})
		return
	}

	// Read the trace content
	trace, err := io.ReadAll(resp.Body)
	if err != nil {
		slog.Error("Failed to read trace", "error", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to read trace",
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"jobId": jobID,
		"trace": string(trace),
	})
}

// GetJobInfo fetches detailed information about a specific job
func (h *Handler) GetJobInfo(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectId")
	jobID := chi.URLParam(r, "jobId")
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

	if token == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]any{
			"error": "GitLab token not configured",
		})
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}

	// Fetch job details from GitLab
	jobURL := fmt.Sprintf("%s/api/v4/projects/%s/jobs/%s", gitlabURL, projectID, jobID)
	req, err := http.NewRequest("GET", jobURL, nil)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to create request",
		})
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": "Failed to connect to GitLab",
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": fmt.Sprintf("GitLab API error: %d", resp.StatusCode),
		})
		return
	}

	var job struct {
		ID         int      `json:"id"`
		Name       string   `json:"name"`
		Stage      string   `json:"stage"`
		Status     string   `json:"status"`
		Duration   float64  `json:"duration"`
		StartedAt  string   `json:"started_at"`
		FinishedAt string   `json:"finished_at"`
		WebURL     string   `json:"web_url"`
		Ref        string   `json:"ref"`
		Tag        bool     `json:"tag"`
		Coverage   *float64 `json:"coverage"`
		Runner     *struct {
			ID          int    `json:"id"`
			Description string `json:"description"`
			Active      bool   `json:"active"`
		} `json:"runner"`
		Artifacts []struct {
			FileType   string `json:"file_type"`
			Size       int64  `json:"size"`
			Filename   string `json:"filename"`
			FileFormat string `json:"file_format"`
		} `json:"artifacts"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&job); err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to decode job info",
		})
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"id":         fmt.Sprintf("%d", job.ID),
		"name":       job.Name,
		"stage":      job.Stage,
		"status":     job.Status,
		"duration":   job.Duration,
		"startedAt":  job.StartedAt,
		"finishedAt": job.FinishedAt,
		"webUrl":     job.WebURL,
		"ref":        job.Ref,
		"tag":        job.Tag,
		"coverage":   job.Coverage,
		"runner":     job.Runner,
		"artifacts":  job.Artifacts,
	})
}
