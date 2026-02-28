package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
)

// PipelineScraper periodically fetches pipeline data from GitLab and stores it.
type PipelineScraper struct {
	store  *Store
	cfg    config.GitLabConfig
	stopCh chan struct{}
	doneCh chan struct{}
	client *http.Client
}

const (
	pipelineScrapePerPage    = 100
	pipelineScrapePerProject = 50
)

// NewPipelineScraper creates a new pipeline scraper.
func NewPipelineScraper(cfg config.GitLabConfig, store *Store) *PipelineScraper {
	return &PipelineScraper{
		store:  store,
		cfg:    cfg,
		stopCh: make(chan struct{}),
		doneCh: make(chan struct{}),
		client: &http.Client{Timeout: 15 * time.Second},
	}
}

// Start begins the scraping loop with a 60s interval.
func (ps *PipelineScraper) Start(ctx context.Context) {
	slog.Info("starting pipeline scraper", "interval", "60s")

	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	defer close(ps.doneCh)

	// Initial scrape
	ps.scrape(ctx)

	for {
		select {
		case <-ctx.Done():
			slog.Info("pipeline scraper stopping due to context cancellation")
			return
		case <-ps.stopCh:
			slog.Info("pipeline scraper stopping")
			return
		case <-ticker.C:
			ps.scrape(ctx)
		}
	}
}

// Stop stops the scraper and waits for it to finish.
func (ps *PipelineScraper) Stop() {
	close(ps.stopCh)
	<-ps.doneCh
}

func (ps *PipelineScraper) scrape(ctx context.Context) {
	scrapeCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	projects, err := ps.fetchProjects(scrapeCtx)
	if err != nil {
		slog.Warn("pipeline scraper: failed to fetch projects", "error", err)
		return
	}

	slog.Info("pipeline scraper: fetched projects", "count", len(projects))

	var stored atomic.Int64
	sem := make(chan struct{}, 5) // max 5 concurrent project scrapes
	var wg sync.WaitGroup

	for _, p := range projects {
		if scrapeCtx.Err() != nil {
			break
		}

		wg.Add(1)
		sem <- struct{}{} // acquire semaphore slot

		go func(projectID int) {
			defer wg.Done()
			defer func() { <-sem }() // release semaphore slot

			pipelines, err := ps.fetchPipelines(scrapeCtx, projectID)
			if err != nil {
				slog.Debug("pipeline scraper: failed to fetch pipelines", "project", projectID, "error", err)
				return
			}

			for _, pl := range pipelines {
				if scrapeCtx.Err() != nil {
					return
				}

				stages, err := ps.fetchPipelineJobs(scrapeCtx, projectID, pl.ID)
				if err != nil {
					slog.Debug("pipeline scraper: failed to fetch jobs", "pipeline", pl.ID, "error", err)
				}

				run := PipelineRun{
					PipelineID: pl.ID,
					ProjectID:  projectID,
					Ref:        pl.Ref,
					Status:     pl.Status,
					Duration:   pl.Duration,
					CreatedAt:  pl.CreatedAt,
					FinishedAt: pl.UpdatedAt,
					Stages:     stages,
				}

				if err := ps.store.StorePipelineRun(scrapeCtx, run); err != nil {
					slog.Warn("pipeline scraper: failed to store run", "pipeline", pl.ID, "error", err)
					continue
				}
				stored.Add(1)
			}
		}(p.ID)
	}

	wg.Wait()

	count := stored.Load()
	slog.Info("pipeline scraper: scrape complete", "projects", len(projects), "stored", count)
}

type gitlabProject struct {
	ID int `json:"id"`
}

type gitlabPipeline struct {
	ID        int       `json:"id"`
	Ref       string    `json:"ref"`
	Status    string    `json:"status"`
	Duration  float64   `json:"duration"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type gitlabJob struct {
	ID       int     `json:"id"`
	Name     string  `json:"name"`
	Stage    string  `json:"stage"`
	Status   string  `json:"status"`
	Duration float64 `json:"duration"`
}

func (ps *PipelineScraper) fetchProjects(ctx context.Context) ([]gitlabProject, error) {
	var all []gitlabProject
	for page := 1; page <= 10; page++ {
		url := fmt.Sprintf("%s/api/v4/projects?simple=true&per_page=100&page=%d", ps.cfg.URL, page)
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("PRIVATE-TOKEN", ps.cfg.Token)

		resp, err := ps.client.Do(req)
		if err != nil {
			return nil, err
		}

		if resp.StatusCode != http.StatusOK {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("projects API status %d", resp.StatusCode)
		}

		var projects []gitlabProject
		if err := json.NewDecoder(resp.Body).Decode(&projects); err != nil {
			_ = resp.Body.Close()
			return nil, err
		}
		_ = resp.Body.Close()

		all = append(all, projects...)
		if len(projects) < 100 {
			break // last page
		}
	}
	return all, nil
}

func (ps *PipelineScraper) fetchPipelines(ctx context.Context, projectID int) ([]gitlabPipeline, error) {
	var all []gitlabPipeline
	for page := 1; len(all) < pipelineScrapePerProject; page++ {
		perPage := pipelineScrapePerPage
		remaining := pipelineScrapePerProject - len(all)
		if remaining < perPage {
			perPage = remaining
		}

		url := fmt.Sprintf("%s/api/v4/projects/%d/pipelines?per_page=%d&page=%d", ps.cfg.URL, projectID, perPage, page)
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("PRIVATE-TOKEN", ps.cfg.Token)

		resp, err := ps.client.Do(req)
		if err != nil {
			return nil, err
		}

		if resp.StatusCode != http.StatusOK {
			_ = resp.Body.Close()
			return nil, fmt.Errorf("pipelines API status %d", resp.StatusCode)
		}

		var pagePipelines []gitlabPipeline
		if err := json.NewDecoder(resp.Body).Decode(&pagePipelines); err != nil {
			_ = resp.Body.Close()
			return nil, err
		}
		_ = resp.Body.Close()

		all = append(all, pagePipelines...)
		if len(pagePipelines) < perPage || len(pagePipelines) == 0 {
			break
		}
	}

	if len(all) > pipelineScrapePerProject {
		all = all[:pipelineScrapePerProject]
	}
	return all, nil
}

func (ps *PipelineScraper) fetchPipelineJobs(ctx context.Context, projectID, pipelineID int) ([]StageRun, error) {
	url := fmt.Sprintf("%s/api/v4/projects/%d/pipelines/%d/jobs", ps.cfg.URL, projectID, pipelineID)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("PRIVATE-TOKEN", ps.cfg.Token)

	resp, err := ps.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("jobs API status %d: %s", resp.StatusCode, string(body))
	}

	var jobs []gitlabJob
	if err := json.NewDecoder(resp.Body).Decode(&jobs); err != nil {
		return nil, err
	}

	// Aggregate by stage
	stageMap := make(map[string]*StageRun)
	stageOrder := []string{}
	for _, j := range jobs {
		sr, ok := stageMap[j.Stage]
		if !ok {
			sr = &StageRun{Name: j.Stage, Status: "success"}
			stageMap[j.Stage] = sr
			stageOrder = append(stageOrder, j.Stage)
		}
		sr.Duration += j.Duration
		// Promote stage status: failed > running > pending > success
		if j.Status == "failed" {
			sr.Status = "failed"
		} else if j.Status == "running" && sr.Status != "failed" {
			sr.Status = "running"
		} else if j.Status == "pending" && sr.Status != "failed" && sr.Status != "running" {
			sr.Status = "pending"
		}
	}

	stages := make([]StageRun, 0, len(stageOrder))
	for _, name := range stageOrder {
		stages = append(stages, *stageMap[name])
	}
	return stages, nil
}
