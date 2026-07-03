package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"golang.org/x/sync/errgroup"
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
		cached, err := h.cache.GetOrFetchSmooth(ctx, "ci:repos", 5*time.Minute, func() (any, error) {
			return h.fetchRepositories(ctx)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn("ci cache miss with error, falling through", "error", err)
	}

	repos, err := h.fetchRepositories(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(repos)
}

func (h *Handler) fetchRepositories(ctx context.Context) ([]RepoInfo, error) {
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

	if token == "" {
		slog.Warn("GitLab token not configured")
		return []RepoInfo{}, nil
	}

	client := h.gitlabClient
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
		req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
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

	// Map projects to RepoInfo without fetching config content.
	// HasConfig is left false; the frontend can fetch config on demand
	// via GET /api/ci/repos/{id}/config.
	repos := make([]RepoInfo, len(projects))
	for i, p := range projects {
		repos[i] = RepoInfo{
			ID:   p.ID,
			Name: p.PathWithNamespace,
			Path: p.WebURL,
			Type: "gitlab",
		}
	}

	return repos, nil
}

// GetRepoConfig returns the .gitlab-ci.yml content for a single repo on demand.
// GET /api/ci/repos/{id}/config
func (h *Handler) GetRepoConfig(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.Atoi(idStr)
	if err != nil || id <= 0 {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid project id"})
		return
	}

	ctx := r.Context()
	cacheKey := fmt.Sprintf("ci:config:%d", id)

	if h.cache != nil {
		cached, cacheErr := h.cache.GetOrFetchSmooth(ctx, cacheKey, 5*time.Minute, func() (any, error) {
			return h.fetchRepoConfig(ctx, id)
		})
		if cacheErr == nil {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(cached)
			return
		}
		slog.Warn("ci config cache miss with error, falling through", "error", cacheErr, "project", id)
	}

	data, fetchErr := h.fetchRepoConfig(ctx, id)
	if fetchErr != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": fetchErr.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

func (h *Handler) fetchRepoConfig(ctx context.Context, projectID int) (map[string]any, error) {
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token
	if token == "" {
		return nil, fmt.Errorf("GitLab token not configured")
	}

	// Fetch the project's default branch first.
	projURL := fmt.Sprintf("%s/api/v4/projects/%d?simple=true", gitlabURL, projectID)
	projReq, err := http.NewRequestWithContext(ctx, "GET", projURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create project request: %w", err)
	}
	projReq.Header.Set("PRIVATE-TOKEN", token)

	projResp, err := h.gitlabClient.Do(projReq)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch project: %w", err)
	}
	defer func() { _ = projResp.Body.Close() }()

	ref := "main"
	if projResp.StatusCode == http.StatusOK {
		var proj struct {
			DefaultBranch string `json:"default_branch"`
		}
		if decErr := json.NewDecoder(projResp.Body).Decode(&proj); decErr == nil && proj.DefaultBranch != "" {
			ref = proj.DefaultBranch
		}
	}

	// Fetch .gitlab-ci.yml from the repository.
	fileURL := fmt.Sprintf("%s/api/v4/projects/%d/repository/files/%s/raw?ref=%s",
		gitlabURL, projectID, ".gitlab-ci.yml", ref)
	fileReq, err := http.NewRequestWithContext(ctx, "GET", fileURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create file request: %w", err)
	}
	fileReq.Header.Set("PRIVATE-TOKEN", token)

	fileResp, err := h.gitlabClient.Do(fileReq)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch config file: %w", err)
	}
	defer func() { _ = fileResp.Body.Close() }()

	if fileResp.StatusCode != http.StatusOK {
		return map[string]any{
			"id":            projectID,
			"hasConfig":     false,
			"configContent": "",
		}, nil
	}

	content, err := io.ReadAll(fileResp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read config content: %w", err)
	}

	return map[string]any{
		"id":            projectID,
		"hasConfig":     true,
		"configContent": string(content),
	}, nil
}

func (h *Handler) GetRepoPipeline(w http.ResponseWriter, r *http.Request) {
	idStr := chi.URLParam(r, "id")
	ctx := r.Context()

	data, err := h.fetchOrCachePipeline(ctx, idStr)
	if err != nil {
		respondJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	respondJSON(w, http.StatusOK, data)
}

func (h *Handler) fetchRepoPipeline(ctx context.Context, idStr string) (any, error) {
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

	client := h.gitlabClient

	// Step 1: Fetch latest pipeline (must be first — we need pipeline ID and ref)
	pipelineURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines?per_page=1", gitlabURL, idStr)
	req, err := http.NewRequestWithContext(ctx, "GET", pipelineURL, nil)
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

	// Steps 2 & 3: Fetch stage order and jobs in parallel (both depend on step 1 only)
	g, gctx := errgroup.WithContext(ctx)
	var stageOrder []string
	var rawJobs []struct {
		ID         int     `json:"id"`
		Name       string  `json:"name"`
		Stage      string  `json:"stage"`
		Status     string  `json:"status"`
		Duration   float64 `json:"duration"`
		StartedAt  string  `json:"started_at"`
		FinishedAt string  `json:"finished_at"`
	}

	// Step 2: Fetch stage order from .gitlab-ci.yml
	g.Go(func() error {
		var fetchErr error
		stageOrder, fetchErr = fetchGitLabStageOrder(gctx, client, gitlabURL, token, idStr, latest.Ref)
		if fetchErr != nil {
			slog.Debug("failed to fetch pipeline stage order from gitlab-ci",
				"project_id", idStr, "ref", latest.Ref, "error", fetchErr)
			// Non-fatal: stage order is best-effort, fall back to job-derived order
			return nil
		}
		return nil
	})

	// Step 3: Fetch pipeline jobs
	g.Go(func() error {
		jobsURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines/%d/jobs", gitlabURL, idStr, latest.ID)
		jReq, reqErr := http.NewRequestWithContext(gctx, "GET", jobsURL, nil)
		if reqErr != nil {
			return fmt.Errorf("failed to create jobs request: %w", reqErr)
		}
		jReq.Header.Set("PRIVATE-TOKEN", token)

		jResp, doErr := client.Do(jReq)
		if doErr != nil {
			return fmt.Errorf("failed to fetch jobs: %w", doErr)
		}
		defer func() { _ = jResp.Body.Close() }()

		if jResp.StatusCode != http.StatusOK {
			return fmt.Errorf("failed to fetch jobs: status %d", jResp.StatusCode)
		}

		_ = json.NewDecoder(jResp.Body).Decode(&rawJobs)
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}

	// Assemble stages from stageOrder + jobs (same logic as before)
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

	for _, j := range rawJobs {
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

// BatchPipelines returns pipeline data for multiple projects in one request.
// GET /api/ci/pipelines/batch?ids=1,2,3
func (h *Handler) BatchPipelines(w http.ResponseWriter, r *http.Request) {
	idsParam := r.URL.Query().Get("ids")
	if idsParam == "" {
		respondJSON(w, http.StatusBadRequest, map[string]any{"error": "ids parameter is required"})
		return
	}

	ids := strings.Split(idsParam, ",")

	// Limit to 20 IDs max to prevent abuse
	if len(ids) > 20 {
		ids = ids[:20]
	}

	// Filter out empty strings
	filtered := ids[:0]
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" {
			filtered = append(filtered, id)
		}
	}
	ids = filtered

	if len(ids) == 0 {
		respondJSON(w, http.StatusOK, map[string]any{"pipelines": map[string]any{}})
		return
	}

	ctx := r.Context()
	results := make(map[string]any, len(ids))
	var mu sync.Mutex

	g, gctx := errgroup.WithContext(ctx)
	g.SetLimit(5) // Concurrency limit to avoid hammering GitLab

	for _, id := range ids {
		id := id
		g.Go(func() error {
			data, err := h.fetchOrCachePipeline(gctx, id)
			mu.Lock()
			if err != nil {
				results[id] = map[string]string{"error": err.Error()}
			} else {
				results[id] = data
			}
			mu.Unlock()
			return nil // Don't fail the whole batch on individual errors
		})
	}
	_ = g.Wait()

	respondJSON(w, http.StatusOK, map[string]any{"pipelines": results})
}

// fetchOrCachePipeline returns pipeline data from the Redis store first,
// falling back to a direct GitLab API call on miss.
func (h *Handler) fetchOrCachePipeline(ctx context.Context, idStr string) (any, error) {
	// Try the metrics store first — the scraper pre-populates this every 60s.
	if h.metricsStore != nil {
		if id, err := strconv.Atoi(idStr); err == nil {
			if runs, err := h.metricsStore.GetPipelineHistory(ctx, id, 1); err == nil && len(runs) > 0 {
				return h.pipelineRunToResponse(runs[0]), nil
			}
		}
	}

	// Fall back to cache-aside → GitLab API.
	if h.cache != nil {
		cacheKey := fmt.Sprintf("ci:pipeline:api:%s", idStr)
		cachedBytes, err := h.cache.GetOrFetchSmooth(ctx, cacheKey, 30*time.Second, func() (any, error) {
			return h.fetchRepoPipeline(ctx, idStr)
		})
		if err == nil {
			var decoded any
			if jsonErr := json.Unmarshal(cachedBytes, &decoded); jsonErr == nil {
				return decoded, nil
			}
		}
	}
	return h.fetchRepoPipeline(ctx, idStr)
}

// pipelineRunToResponse converts a store PipelineRun to the handler response format.
func (h *Handler) pipelineRunToResponse(run metrics.PipelineRun) any {
	type Job struct {
		ID       string  `json:"id"`
		Name     string  `json:"name"`
		Stage    string  `json:"stage"`
		Status   string  `json:"status"`
		Duration float64 `json:"duration"`
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
		Source    string  `json:"source,omitempty"`
	}

	stages := make([]Stage, 0, len(run.Stages))
	for _, s := range run.Stages {
		jobs := make([]Job, 0, len(s.Jobs))
		for idx, j := range s.Jobs {
			jobs = append(jobs, Job{
				// Synthesize a stable, unique id so the frontend can key rows.
				// The store does not persist GitLab job ids.
				ID:       fmt.Sprintf("%s-%d", s.Name, idx),
				Name:     j.Name,
				Stage:    s.Name,
				Status:   j.Status,
				Duration: j.Duration,
			})
		}
		// Backward compatibility: runs cached before per-job data existed have
		// no Jobs — fall back to a single synthetic job from the stage aggregate
		// so older entries still render (as 1/1) instead of an empty stage.
		if len(jobs) == 0 {
			jobs = append(jobs, Job{
				Name:     s.Name,
				Stage:    s.Name,
				Status:   s.Status,
				Duration: s.Duration,
			})
		}
		stages = append(stages, Stage{Name: s.Name, Jobs: jobs})
	}

	return PipelineResponse{
		ID:        fmt.Sprintf("%d", run.PipelineID),
		Ref:       run.Ref,
		Status:    run.Status,
		CreatedAt: run.CreatedAt.Format(time.RFC3339),
		Stages:    stages,
		Source:    "store",
	}
}

func fetchGitLabStageOrder(ctx context.Context, client *http.Client, gitlabURL, token, projectID, ref string) ([]string, error) {
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

	req, err := http.NewRequestWithContext(ctx, "GET", fileURL, nil)
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

	client := h.gitlabClient

	// Fetch job trace from GitLab
	traceURL := fmt.Sprintf("%s/api/v4/projects/%s/jobs/%s/trace", gitlabURL, projectID, jobID)
	req, err := http.NewRequestWithContext(r.Context(), "GET", traceURL, nil)
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

	client := h.gitlabClient

	// POST to GitLab job retry endpoint
	retryURL := fmt.Sprintf("%s/api/v4/projects/%s/jobs/%s/retry", gitlabURL, projectID, jobID)
	req, err := http.NewRequestWithContext(r.Context(), "POST", retryURL, nil)
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

	client := h.gitlabClient

	// POST to GitLab job cancel endpoint
	cancelURL := fmt.Sprintf("%s/api/v4/projects/%s/jobs/%s/cancel", gitlabURL, projectID, jobID)
	req, err := http.NewRequestWithContext(r.Context(), "POST", cancelURL, nil)
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

	client := h.gitlabClient

	// POST to GitLab job play endpoint
	playURL := fmt.Sprintf("%s/api/v4/projects/%s/jobs/%s/play", gitlabURL, projectID, jobID)
	req, err := http.NewRequestWithContext(r.Context(), "POST", playURL, nil)
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

	client := h.gitlabClient

	// Fetch job details from GitLab
	jobURL := fmt.Sprintf("%s/api/v4/projects/%s/jobs/%s", gitlabURL, projectID, jobID)
	req, err := http.NewRequestWithContext(r.Context(), "GET", jobURL, nil)
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

// GetCISummary returns the materialized CI health summary for the dashboard.
func (h *Handler) GetCISummary(w http.ResponseWriter, r *http.Request) {
	if h.metricsStore == nil {
		respondJSON(w, http.StatusOK, map[string]any{})
		return
	}

	summary, err := h.metricsStore.GetCISummary(r.Context())
	if err != nil {
		respondJSON(w, http.StatusOK, map[string]any{})
		return
	}
	respondJSON(w, http.StatusOK, summary)
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
	// Try pre-materialized all-projects summary first
	if materialized, err := h.metricsStore.GetMaterializedAllTrends(ctx); err == nil {
		return materialized, nil
	}

	// Fall back to per-project computation
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

	client := h.gitlabClient
	retryURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines/%s/retry", gitlabURL, projectID, pipelineID)
	req, err := http.NewRequestWithContext(r.Context(), "POST", retryURL, nil)
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

	client := h.gitlabClient
	cancelURL := fmt.Sprintf("%s/api/v4/projects/%s/pipelines/%s/cancel", gitlabURL, projectID, pipelineID)
	req, err := http.NewRequestWithContext(r.Context(), "POST", cancelURL, nil)
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

	client := h.gitlabClient
	triggerURL := fmt.Sprintf("%s/api/v4/projects/%s/pipeline?ref=%s", gitlabURL, projectID, body.Ref)
	req, err := http.NewRequestWithContext(r.Context(), "POST", triggerURL, nil)
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

	client := h.gitlabClient
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
		req, err := http.NewRequestWithContext(r.Context(), "GET", pipelinesURL, nil)
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
