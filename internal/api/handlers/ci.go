package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"gopkg.in/yaml.v3"

	"github.com/flexinfer/flexdeck/internal/metrics"
)

type RepoInfo struct {
	ID            int    `json:"id"`
	Name          string `json:"name"`
	Path          string `json:"path"`
	Type          string `json:"type"` // "gitlab", "github", "none"
	HasConfig     bool   `json:"hasConfig"`
	ConfigContent string `json:"configContent,omitempty"`
}

const (
	gitlabPerPageDefault    = 100
	gitlabMaxProjects       = 500
	gitlabPipelineListLimit = 500
)

func (h *Handler) ListRepositories(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Try cache first (5 minute TTL for repo list)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "ci:repos", 5*time.Minute, func() (any, error) {
			return h.fetchRepositories()
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn("ci cache miss with error, falling through", "error", err)
	}

	repos, err := h.fetchRepositories()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(repos)
}

func (h *Handler) fetchRepositories() ([]RepoInfo, error) {
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

	if token == "" {
		slog.Warn("GitLab token not configured")
		return []RepoInfo{}, nil
	}

	client := &http.Client{Timeout: 10 * time.Second}
	var projects []struct {
		ID                int    `json:"id"`
		PathWithNamespace string `json:"path_with_namespace"`
		Name              string `json:"name"`
		DefaultBranch     string `json:"default_branch"`
		WebURL            string `json:"web_url"`
	}
	for page := 1; len(projects) < gitlabMaxProjects; page++ {
		apiURL := fmt.Sprintf("%s/api/v4/projects?simple=true&per_page=%d&page=%d&order_by=last_activity_at&sort=desc",
			gitlabURL, gitlabPerPageDefault, page)
		req, err := http.NewRequest("GET", apiURL, nil)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("PRIVATE-TOKEN", token)

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch projects: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("GitLab API error: %s", resp.Status)
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to read response: %w", err)
		}

		var pageProjects []struct {
			ID                int    `json:"id"`
			PathWithNamespace string `json:"path_with_namespace"`
			Name              string `json:"name"`
			DefaultBranch     string `json:"default_branch"`
			WebURL            string `json:"web_url"`
		}

		if err := json.Unmarshal(bodyBytes, &pageProjects); err != nil {
			snippet := string(bodyBytes)
			if len(snippet) > 500 {
				snippet = snippet[:500]
			}
			slog.Error("Failed to decode projects", "error", err, "body_snippet", snippet)
			return nil, fmt.Errorf("failed to decode projects response: %w", err)
		}

		projects = append(projects, pageProjects...)
		if len(pageProjects) < gitlabPerPageDefault {
			break
		}
		if len(pageProjects) == 0 {
			break
		}
	}

	if len(projects) > gitlabMaxProjects {
		projects = projects[:gitlabMaxProjects]
	}

	// Fetch .gitlab-ci.yml for each project in parallel (fixes N+1)
	repos := make([]RepoInfo, len(projects))
	var wg sync.WaitGroup

	for i, p := range projects {
		repos[i] = RepoInfo{
			ID:   p.ID,
			Name: p.PathWithNamespace,
			Path: p.WebURL,
			Type: "gitlab",
		}

		wg.Add(1)
		go func(idx int, proj struct {
			ID                int    `json:"id"`
			PathWithNamespace string `json:"path_with_namespace"`
			Name              string `json:"name"`
			DefaultBranch     string `json:"default_branch"`
			WebURL            string `json:"web_url"`
		}) {
			defer wg.Done()

			ref := proj.DefaultBranch
			if ref == "" {
				ref = "main"
			}

			fileURL := fmt.Sprintf("%s/api/v4/projects/%d/repository/files/%s/raw?ref=%s",
				gitlabURL, proj.ID, ".gitlab-ci.yml", ref)
			fileReq, err := http.NewRequest("GET", fileURL, nil)
			if err != nil {
				return
			}
			fileReq.Header.Set("PRIVATE-TOKEN", token)

			fileResp, err := client.Do(fileReq)
			if err != nil {
				return
			}
			defer func() { _ = fileResp.Body.Close() }()

			if fileResp.StatusCode == http.StatusOK {
				content, readErr := io.ReadAll(fileResp.Body)
				if readErr == nil {
					repos[idx].HasConfig = true
					repos[idx].ConfigContent = string(content)
				}
			}
		}(i, p)
	}

	wg.Wait()
	return repos, nil
}

func (h *Handler) GetRepoPipeline(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	ctx := r.Context()

	// Try cache (30s TTL for pipeline status)
	if h.cache != nil {
		cacheKey := fmt.Sprintf("ci:pipeline:%s", idStr)
		cached, err := h.cache.GetOrFetch(ctx, cacheKey, 30*time.Second, func() (any, error) {
			return h.fetchRepoPipeline(idStr)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
	}

	data, err := h.fetchRepoPipeline(idStr)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

func (h *Handler) fetchRepoPipeline(idStr string) (any, error) {
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

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
		return nil, fmt.Errorf("GitLab token not configured")
	}

	client := &http.Client{Timeout: 10 * time.Second}

	pipelineURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines?per_page=1", gitlabURL, idStr)
	req, err := http.NewRequest("GET", pipelineURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to GitLab: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitLab API error: %d", resp.StatusCode)
	}

	var pipelines []struct {
		ID        int       `json:"id"`
		Status    string    `json:"status"`
		Ref       string    `json:"ref"`
		CreatedAt time.Time `json:"created_at"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&pipelines)

	if len(pipelines) == 0 {
		return PipelineResponse{Status: "none", Stages: []Stage{}}, nil
	}
	latest := pipelines[0]

	stageOrder, err := fetchGitLabStageOrder(client, gitlabURL, token, idStr, latest.Ref)
	if err != nil {
		slog.Debug("failed to fetch pipeline stage order from gitlab-ci", "project_id", idStr, "ref", latest.Ref, "error", err)
	}

	jobsURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines/%d/jobs", gitlabURL, idStr, latest.ID)
	jReq, _ := http.NewRequest("GET", jobsURL, nil)
	jReq.Header.Set("PRIVATE-TOKEN", token)

	jResp, err := client.Do(jReq)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch jobs: %w", err)
	}
	defer func() { _ = jResp.Body.Close() }()

	if jResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch jobs: status %d", jResp.StatusCode)
	}

	var jobs []struct {
		ID         int     `json:"id"`
		Name       string  `json:"name"`
		Stage      string  `json:"stage"`
		Status     string  `json:"status"`
		Duration   float64 `json:"duration"`
		StartedAt  string  `json:"started_at"`
		FinishedAt string  `json:"finished_at"`
	}
	_ = json.NewDecoder(jResp.Body).Decode(&jobs)

	stageMap := make(map[string][]Job)
	seenStages := make([]string, 0, len(stageOrder))
	seenStagesSet := make(map[string]struct{}, len(stageOrder))

	appendStage := func(name string) {
		if name == "" {
			return
		}
		if _, exists := seenStagesSet[name]; exists {
			return
		}
		seenStagesSet[name] = struct{}{}
		seenStages = append(seenStages, name)
	}

	for _, stageName := range stageOrder {
		appendStage(stageName)
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
		}
		appendStage(j.Stage)
		stageMap[j.Stage] = append(stageMap[j.Stage], jobFormatted)
	}

	stages := []Stage{}
	for _, sName := range seenStages {
		if jList, ok := stageMap[sName]; ok && len(jList) > 0 {
			stages = append(stages, Stage{Name: sName, Jobs: jList})
		}
	}

	return PipelineResponse{
		ID:        fmt.Sprintf("%d", latest.ID),
		Ref:       latest.Ref,
		Status:    latest.Status,
		CreatedAt: latest.CreatedAt.Format(time.RFC3339),
		Stages:    stages,
	}, nil
}

func fetchGitLabStageOrder(client *http.Client, gitlabURL, token, projectID, ref string) ([]string, error) {
	if ref == "" {
		ref = "main"
	}
	fileURL := fmt.Sprintf(
		"%s/api/v4/projects/%s/repository/files/%s/raw?ref=%s",
		gitlabURL,
		projectID,
		".gitlab-ci.yml",
		url.QueryEscape(ref),
	)

	req, err := http.NewRequest("GET", fileURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create gitlab-ci request: %w", err)
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch gitlab-ci: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gitlab-ci fetch returned status %d", resp.StatusCode)
	}

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read gitlab-ci response: %w", err)
	}

	stageOrder, err := parseGitLabStages(content)
	if err != nil {
		return nil, fmt.Errorf("failed to parse gitlab-ci stages: %w", err)
	}
	return stageOrder, nil
}

func parseGitLabStages(content []byte) ([]string, error) {
	var parsed map[string]any
	if err := yaml.Unmarshal(content, &parsed); err != nil {
		return nil, err
	}

	stagesRaw, ok := parsed["stages"]
	if !ok {
		return []string{}, nil
	}

	stagesList, ok := stagesRaw.([]any)
	if !ok {
		return []string{}, nil
	}

	stageOrder := make([]string, 0, len(stagesList))
	for _, item := range stagesList {
		if name, ok := item.(string); ok && name != "" {
			stageOrder = append(stageOrder, name)
		}
	}
	return stageOrder, nil
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
	defer func() { _ = resp.Body.Close() }()

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

// RetryJob retries a failed or canceled job
func (h *Handler) RetryJob(w http.ResponseWriter, r *http.Request) {
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

	// POST to GitLab job retry endpoint
	retryURL := fmt.Sprintf("%s/api/v4/projects/%s/jobs/%s/retry", gitlabURL, projectID, jobID)
	req, err := http.NewRequest("POST", retryURL, nil)
	if err != nil {
		slog.Error("Failed to create retry request", "error", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to create request",
		})
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		slog.Error("Failed to retry job", "error", err)
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": "Failed to connect to GitLab",
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		slog.Warn("GitLab retry API returned non-OK", "status", resp.StatusCode, "job", jobID, "body", string(body))
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": fmt.Sprintf("GitLab API error: %d", resp.StatusCode),
		})
		return
	}

	var job struct {
		ID     int    `json:"id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&job); err != nil {
		slog.Warn("Failed to decode retry response", "error", err)
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"jobId":   fmt.Sprintf("%d", job.ID),
		"status":  job.Status,
	})
}

// CancelJob cancels a running job
func (h *Handler) CancelJob(w http.ResponseWriter, r *http.Request) {
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

	// POST to GitLab job cancel endpoint
	cancelURL := fmt.Sprintf("%s/api/v4/projects/%s/jobs/%s/cancel", gitlabURL, projectID, jobID)
	req, err := http.NewRequest("POST", cancelURL, nil)
	if err != nil {
		slog.Error("Failed to create cancel request", "error", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to create request",
		})
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		slog.Error("Failed to cancel job", "error", err)
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": "Failed to connect to GitLab",
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		slog.Warn("GitLab cancel API returned non-OK", "status", resp.StatusCode, "job", jobID, "body", string(body))
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": fmt.Sprintf("GitLab API error: %d", resp.StatusCode),
		})
		return
	}

	var job struct {
		ID     int    `json:"id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&job); err != nil {
		slog.Warn("Failed to decode cancel response", "error", err)
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"jobId":   fmt.Sprintf("%d", job.ID),
		"status":  job.Status,
	})
}

// PlayJob plays (triggers) a manual job
func (h *Handler) PlayJob(w http.ResponseWriter, r *http.Request) {
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

	// POST to GitLab job play endpoint
	playURL := fmt.Sprintf("%s/api/v4/projects/%s/jobs/%s/play", gitlabURL, projectID, jobID)
	req, err := http.NewRequest("POST", playURL, nil)
	if err != nil {
		slog.Error("Failed to create play request", "error", err)
		respondJSON(w, http.StatusInternalServerError, map[string]any{
			"error": "Failed to create request",
		})
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		slog.Error("Failed to play job", "error", err)
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": "Failed to connect to GitLab",
		})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		slog.Warn("GitLab play API returned non-OK", "status", resp.StatusCode, "job", jobID, "body", string(body))
		respondJSON(w, http.StatusBadGateway, map[string]any{
			"error": fmt.Sprintf("GitLab API error: %d", resp.StatusCode),
		})
		return
	}

	var job struct {
		ID     int    `json:"id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&job); err != nil {
		slog.Warn("Failed to decode play response", "error", err)
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"jobId":   fmt.Sprintf("%d", job.ID),
		"status":  job.Status,
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
	defer func() { _ = resp.Body.Close() }()

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

// --- Pipeline Trends & History ---

// GetAllPipelineTrends returns trend data for all projects with pipeline data.
func (h *Handler) GetAllPipelineTrends(w http.ResponseWriter, r *http.Request) {
	if h.metricsStore == nil {
		respondJSON(w, http.StatusOK, []any{})
		return
	}

	ctx := r.Context()
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, "ci:trends:all", 60*time.Second, func() (any, error) {
			return h.fetchAllTrends(ctx)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
	}

	data, err := h.fetchAllTrends(ctx)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

func (h *Handler) fetchAllTrends(ctx context.Context) (any, error) {
	ids, err := h.metricsStore.GetAllPipelineProjectIDs(ctx)
	if err != nil {
		return nil, err
	}

	var trends []any
	for _, id := range ids {
		t, err := h.metricsStore.GetPipelineTrends(ctx, id, 7*24*time.Hour)
		if err != nil {
			continue
		}
		if t.TotalRuns > 0 {
			trends = append(trends, t)
		}
	}

	if trends == nil {
		trends = []any{}
	}
	return trends, nil
}

// GetPipelineTrends returns trend data for a specific project.
func (h *Handler) GetPipelineTrends(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	if h.metricsStore == nil {
		respondJSON(w, http.StatusOK, map[string]any{})
		return
	}

	var id int
	_, _ = fmt.Sscanf(idStr, "%d", &id)
	if id == 0 {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid project id"})
		return
	}

	ctx := r.Context()
	cacheKey := fmt.Sprintf("ci:trends:%d", id)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, cacheKey, 60*time.Second, func() (any, error) {
			return h.metricsStore.GetPipelineTrends(ctx, id, 7*24*time.Hour)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
	}

	data, err := h.metricsStore.GetPipelineTrends(ctx, id, 7*24*time.Hour)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

// GetPipelineHistory returns recent pipeline runs for a project.
func (h *Handler) GetPipelineHistory(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	if h.metricsStore == nil {
		respondJSON(w, http.StatusOK, []any{})
		return
	}

	var id int
	_, _ = fmt.Sscanf(idStr, "%d", &id)
	if id == 0 {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid project id"})
		return
	}

	limit := 20
	if l := r.URL.Query().Get("limit"); l != "" {
		_, _ = fmt.Sscanf(l, "%d", &limit)
		if limit <= 0 || limit > gitlabPipelineListLimit {
			limit = 20
		}
	}

	ctx := r.Context()
	cacheKey := fmt.Sprintf("ci:history:%d:%d", id, limit)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(ctx, cacheKey, 30*time.Second, func() (any, error) {
			return h.metricsStore.GetPipelineHistory(ctx, id, limit)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
	}

	data, err := h.metricsStore.GetPipelineHistory(ctx, id, limit)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if data == nil {
		data = []metrics.PipelineRun{}
	}
	respondJSON(w, http.StatusOK, data)
}

// --- Pipeline-Level Actions ---

// RetryPipeline retries an entire pipeline.
func (h *Handler) RetryPipeline(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	pipelineID := chi.URLParam(r, "pid")
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

	if token == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"error": "GitLab token not configured"})
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	retryURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines/%s/retry", gitlabURL, projectID, pipelineID)
	req, err := http.NewRequest("POST", retryURL, nil)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": "Failed to create request"})
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": "Failed to connect to GitLab"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		slog.Warn("GitLab pipeline retry returned non-OK", "status", resp.StatusCode, "body", string(body))
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("GitLab API error: %d", resp.StatusCode)})
		return
	}

	var pipeline struct {
		ID     int    `json:"id"`
		Status string `json:"status"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&pipeline)

	respondJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"pipelineId": fmt.Sprintf("%d", pipeline.ID),
		"status":     pipeline.Status,
	})
}

// CancelPipeline cancels a running pipeline.
func (h *Handler) CancelPipeline(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	pipelineID := chi.URLParam(r, "pid")
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

	if token == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"error": "GitLab token not configured"})
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	cancelURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines/%s/cancel", gitlabURL, projectID, pipelineID)
	req, err := http.NewRequest("POST", cancelURL, nil)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": "Failed to create request"})
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": "Failed to connect to GitLab"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(resp.Body)
		slog.Warn("GitLab pipeline cancel returned non-OK", "status", resp.StatusCode, "body", string(body))
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("GitLab API error: %d", resp.StatusCode)})
		return
	}

	var pipeline struct {
		ID     int    `json:"id"`
		Status string `json:"status"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&pipeline)

	respondJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"pipelineId": fmt.Sprintf("%d", pipeline.ID),
		"status":     pipeline.Status,
	})
}

// TriggerPipeline triggers a new pipeline on a given ref.
func (h *Handler) TriggerPipeline(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

	if token == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"error": "GitLab token not configured"})
		return
	}

	var body struct {
		Ref string `json:"ref"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Ref == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "ref is required"})
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	triggerURL := fmt.Sprintf("%s/api/v4/projects/%s/pipeline?ref=%s", gitlabURL, projectID, body.Ref)
	req, err := http.NewRequest("POST", triggerURL, nil)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": "Failed to create request"})
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": "Failed to connect to GitLab"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		slog.Warn("GitLab trigger pipeline returned non-OK", "status", resp.StatusCode, "body", string(respBody))
		respondJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("GitLab API error: %d", resp.StatusCode)})
		return
	}

	var pipeline struct {
		ID     int    `json:"id"`
		Status string `json:"status"`
		Ref    string `json:"ref"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&pipeline)

	respondJSON(w, http.StatusOK, map[string]any{
		"success":    true,
		"pipelineId": fmt.Sprintf("%d", pipeline.ID),
		"status":     pipeline.Status,
		"ref":        pipeline.Ref,
	})
}

// ListProjectPipelines lists recent pipelines for a project.
func (h *Handler) ListProjectPipelines(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

	if token == "" {
		respondJSON(w, http.StatusUnauthorized, map[string]any{"error": "GitLab token not configured"})
		return
	}

	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		_, _ = fmt.Sscanf(l, "%d", &limit)
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > gitlabPipelineListLimit {
		limit = gitlabPipelineListLimit
	}

	client := &http.Client{Timeout: 10 * time.Second}
	var pipelines []struct {
		ID        int       `json:"id"`
		Status    string    `json:"status"`
		Ref       string    `json:"ref"`
		Duration  *float64  `json:"duration"`
		CreatedAt time.Time `json:"created_at"`
		UpdatedAt time.Time `json:"updated_at"`
		WebURL    string    `json:"web_url"`
	}

	for page := 1; len(pipelines) < limit; page++ {
		perPage := gitlabPerPageDefault
		remaining := limit - len(pipelines)
		if remaining < perPage {
			perPage = remaining
		}

		pipelinesURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines?per_page=%d&page=%d",
			gitlabURL, projectID, perPage, page)
		req, err := http.NewRequest("GET", pipelinesURL, nil)
		if err != nil {
			respondJSON(w, http.StatusInternalServerError, map[string]any{"error": "Failed to create request"})
			return
		}
		req.Header.Set("PRIVATE-TOKEN", token)

		resp, err := client.Do(req)
		if err != nil {
			respondJSON(w, http.StatusBadGateway, map[string]any{"error": "Failed to connect to GitLab"})
			return
		}

		if resp.StatusCode != http.StatusOK {
			_ = resp.Body.Close()
			respondJSON(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("GitLab API error: %d", resp.StatusCode)})
			return
		}

		var pagePipelines []struct {
			ID        int       `json:"id"`
			Status    string    `json:"status"`
			Ref       string    `json:"ref"`
			Duration  *float64  `json:"duration"`
			CreatedAt time.Time `json:"created_at"`
			UpdatedAt time.Time `json:"updated_at"`
			WebURL    string    `json:"web_url"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&pagePipelines); err != nil {
			_ = resp.Body.Close()
			respondJSON(w, http.StatusInternalServerError, map[string]any{"error": "Failed to decode response"})
			return
		}
		_ = resp.Body.Close()

		pipelines = append(pipelines, pagePipelines...)
		if len(pagePipelines) < perPage || len(pagePipelines) == 0 {
			break
		}
	}
	if len(pipelines) > limit {
		pipelines = pipelines[:limit]
	}

	result := make([]map[string]any, 0, len(pipelines))
	for _, p := range pipelines {
		entry := map[string]any{
			"id":        fmt.Sprintf("%d", p.ID),
			"status":    p.Status,
			"ref":       p.Ref,
			"createdAt": p.CreatedAt.Format(time.RFC3339),
			"updatedAt": p.UpdatedAt.Format(time.RFC3339),
			"webUrl":    p.WebURL,
		}
		if p.Duration != nil {
			entry["duration"] = *p.Duration
		}
		result = append(result, entry)
	}

	respondJSON(w, http.StatusOK, result)
}
