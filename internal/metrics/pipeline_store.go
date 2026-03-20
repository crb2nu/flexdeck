package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/redis/go-redis/v9"
)

// PipelineRun represents a single pipeline execution.
type PipelineRun struct {
	PipelineID int        `json:"pipeline_id"`
	ProjectID  int        `json:"project_id"`
	Ref        string     `json:"ref"`
	Status     string     `json:"status"`
	Duration   float64    `json:"duration_s"`
	CreatedAt  time.Time  `json:"created_at"`
	FinishedAt time.Time  `json:"finished_at,omitempty"`
	Stages     []StageRun `json:"stages,omitempty"`
}

// StageRun represents a single stage within a pipeline run.
type StageRun struct {
	Name     string  `json:"name"`
	Status   string  `json:"status"`
	Duration float64 `json:"duration_s"`
}

// PipelineTrend holds computed trend data for a project's pipelines.
type PipelineTrend struct {
	ProjectID   int       `json:"project_id"`
	ProjectName string    `json:"project_name,omitempty"`
	AvgDuration float64   `json:"avg_duration_s"`
	P95Duration float64   `json:"p95_duration_s"`
	SuccessRate float64   `json:"success_rate"`
	TotalRuns   int       `json:"total_runs"`
	Sparkline   []float64 `json:"sparkline"`
	Trend       string    `json:"trend"`
}

const pipelineKeyPrefix = "ci:pipeline:"
const pipelineTTL = 8 * 24 * time.Hour // 8 days
const projectNamesKey = "ci:project:names"
const dirtyProjectsKey = "ci:dirty:projects"

const (
	pipelineTrendSummaryPrefix = "ci:summary:trend:"
	pipelineAllTrendsSummary   = "ci:summary:trends:all"
	pipelineTrendSummaryTTL    = 5 * time.Minute
	pipelineAllTrendsTTL       = 3 * time.Minute
	ciDashboardSummaryKey      = "ci:summary:dashboard"
	ciDashboardSummaryTTL      = 3 * time.Minute
)

// CISummary holds aggregated CI health metrics for the dashboard landing page.
type CISummary struct {
	ActivePipelines int     `json:"active_pipelines"`
	FailedLast24h   int     `json:"failed_last_24h"`
	SuccessLast24h  int     `json:"success_last_24h"`
	SuccessRate24h  float64 `json:"success_rate_24h"`
	AvgDuration24h  float64 `json:"avg_duration_24h_s"`
	SlowestProject  string  `json:"slowest_project,omitempty"`
	SlowestDuration float64 `json:"slowest_duration_s"`
}

// StorePipelineRun stores a pipeline run in a Redis sorted set keyed by project.
func (s *Store) StorePipelineRun(ctx context.Context, run PipelineRun) error {
	key := fmt.Sprintf("%s%d", pipelineKeyPrefix, run.ProjectID)

	data, err := json.Marshal(run)
	if err != nil {
		return fmt.Errorf("marshal pipeline run: %w", err)
	}

	pipe := s.redis.Pipeline()
	pipe.ZAdd(ctx, key, redis.Z{
		Score:  float64(run.CreatedAt.Unix()),
		Member: string(data),
	})
	pipe.Expire(ctx, key, pipelineTTL)
	pipe.SAdd(ctx, dirtyProjectsKey, run.ProjectID)
	_, err = pipe.Exec(ctx)
	if err != nil {
		return err
	}

	s.materializePipelineTrend(ctx, run.ProjectID, 7*24*time.Hour)
	return nil
}

// GetPipelineTrends returns trend data for a project, preferring a
// pre-materialized summary. Falls back to full computation on miss.
func (s *Store) GetPipelineTrends(ctx context.Context, projectID int, window time.Duration) (*PipelineTrend, error) {
	summaryKey := fmt.Sprintf("%s%d", pipelineTrendSummaryPrefix, projectID)
	data, err := s.redis.Get(ctx, summaryKey).Bytes()
	if err == nil {
		var trend PipelineTrend
		if err := json.Unmarshal(data, &trend); err == nil {
			return &trend, nil
		}
	}

	trend, err := s.computePipelineTrends(ctx, projectID, window)
	if err != nil {
		return nil, err
	}
	if trend.TotalRuns > 0 {
		if data, err := json.Marshal(trend); err == nil {
			s.redis.Set(ctx, summaryKey, data, pipelineTrendSummaryTTL)
		}
	}
	return trend, nil
}

// computePipelineTrends computes trend data from raw sorted-set entries.
func (s *Store) computePipelineTrends(ctx context.Context, projectID int, window time.Duration) (*PipelineTrend, error) {
	key := fmt.Sprintf("%s%d", pipelineKeyPrefix, projectID)
	cutoff := time.Now().Add(-window).Unix()

	members, err := s.redis.ZRangeByScore(ctx, key, &redis.ZRangeBy{
		Min: fmt.Sprintf("%d", cutoff),
		Max: "+inf",
	}).Result()
	if err != nil {
		return nil, fmt.Errorf("redis zrangebyscore: %w", err)
	}

	if len(members) == 0 {
		return &PipelineTrend{ProjectID: projectID}, nil
	}

	var runs []PipelineRun
	for _, m := range members {
		var r PipelineRun
		if err := json.Unmarshal([]byte(m), &r); err == nil {
			runs = append(runs, r)
		}
	}

	if len(runs) == 0 {
		return &PipelineTrend{ProjectID: projectID}, nil
	}

	sort.Slice(runs, func(i, j int) bool {
		return runs[i].CreatedAt.Before(runs[j].CreatedAt)
	})

	trend := &PipelineTrend{
		ProjectID:   projectID,
		ProjectName: s.GetProjectName(ctx, projectID),
		TotalRuns:   len(runs),
	}

	var durations []float64
	successCount := 0
	for _, r := range runs {
		durations = append(durations, r.Duration)
		if r.Status == "success" {
			successCount++
		}
	}

	trend.AvgDuration = avg(durations)
	trend.P95Duration = percentile(durations, 95)
	if len(runs) > 0 {
		trend.SuccessRate = float64(successCount) / float64(len(runs)) * 100
	}

	sparklineRuns := runs
	if len(sparklineRuns) > 20 {
		sparklineRuns = sparklineRuns[len(sparklineRuns)-20:]
	}
	for _, r := range sparklineRuns {
		trend.Sparkline = append(trend.Sparkline, r.Duration)
	}

	trend.Trend = s.detectTrend(trend.Sparkline)

	return trend, nil
}

// materializePipelineTrend computes and stores a single project's trend summary.
func (s *Store) materializePipelineTrend(ctx context.Context, projectID int, window time.Duration) {
	trend, err := s.computePipelineTrends(ctx, projectID, window)
	if err != nil || trend.TotalRuns == 0 {
		return
	}
	data, err := json.Marshal(trend)
	if err != nil {
		return
	}
	summaryKey := fmt.Sprintf("%s%d", pipelineTrendSummaryPrefix, projectID)
	s.redis.Set(ctx, summaryKey, data, pipelineTrendSummaryTTL)
}

// MaterializeAllPipelineTrends iterates all projects and stores an all-projects
// summary at a single Redis key, plus refreshes per-project summaries.
func (s *Store) MaterializeAllPipelineTrends(ctx context.Context) {
	ids, err := s.GetAllPipelineProjectIDs(ctx)
	if err != nil {
		return
	}

	var trends []*PipelineTrend
	window := 7 * 24 * time.Hour
	for _, id := range ids {
		t, err := s.computePipelineTrends(ctx, id, window)
		if err != nil || t.TotalRuns == 0 {
			continue
		}
		trends = append(trends, t)

		// Also refresh per-project summary
		if data, err := json.Marshal(t); err == nil {
			summaryKey := fmt.Sprintf("%s%d", pipelineTrendSummaryPrefix, id)
			s.redis.Set(ctx, summaryKey, data, pipelineTrendSummaryTTL)
		}
	}

	if trends == nil {
		trends = []*PipelineTrend{}
	}
	data, err := json.Marshal(trends)
	if err != nil {
		return
	}
	s.redis.Set(ctx, pipelineAllTrendsSummary, data, pipelineAllTrendsTTL)
}

// MaterializeDirtyPipelineTrends recomputes trends only for projects that received
// new data since the last call, then merges the results into the all-projects summary.
func (s *Store) MaterializeDirtyPipelineTrends(ctx context.Context) {
	// Atomically fetch and clear the dirty set.
	dirtyRaw, err := s.redis.SMembers(ctx, dirtyProjectsKey).Result()
	if err != nil || len(dirtyRaw) == 0 {
		return
	}
	s.redis.Del(ctx, dirtyProjectsKey)

	var dirtyIDs []int
	for _, raw := range dirtyRaw {
		var id int
		if _, err := fmt.Sscanf(raw, "%d", &id); err == nil {
			dirtyIDs = append(dirtyIDs, id)
		}
	}
	if len(dirtyIDs) == 0 {
		return
	}

	window := 7 * 24 * time.Hour
	updatedTrends := make(map[int]*PipelineTrend, len(dirtyIDs))
	for _, id := range dirtyIDs {
		t, err := s.computePipelineTrends(ctx, id, window)
		if err != nil || t.TotalRuns == 0 {
			continue
		}
		// Refresh per-project summary.
		if data, err := json.Marshal(t); err == nil {
			summaryKey := fmt.Sprintf("%s%d", pipelineTrendSummaryPrefix, id)
			s.redis.Set(ctx, summaryKey, data, pipelineTrendSummaryTTL)
		}
		updatedTrends[id] = t
	}

	// Merge into existing all-projects summary.
	existing, err := s.GetMaterializedAllTrends(ctx)
	if err != nil {
		// Fall back to full recompute if all-projects key is missing.
		s.MaterializeAllPipelineTrends(ctx)
		return
	}

	merged := make(map[int]*PipelineTrend, len(existing))
	for _, t := range existing {
		merged[t.ProjectID] = t
	}
	for id, t := range updatedTrends {
		merged[id] = t
	}

	result := make([]*PipelineTrend, 0, len(merged))
	for _, t := range merged {
		if t.TotalRuns > 0 {
			result = append(result, t)
		}
	}
	if data, err := json.Marshal(result); err == nil {
		s.redis.Set(ctx, pipelineAllTrendsSummary, data, pipelineAllTrendsTTL)
	}
}

// GetMaterializedAllTrends returns the pre-computed all-projects trend summary.
// Returns nil, err if the key is missing or corrupt (caller should fall back).
func (s *Store) GetMaterializedAllTrends(ctx context.Context) ([]*PipelineTrend, error) {
	data, err := s.redis.Get(ctx, pipelineAllTrendsSummary).Bytes()
	if err != nil {
		s.MaterializeAllPipelineTrends(ctx)
		data, err = s.redis.Get(ctx, pipelineAllTrendsSummary).Bytes()
		if err != nil {
			return nil, err
		}
	}
	var trends []*PipelineTrend
	if err := json.Unmarshal(data, &trends); err != nil {
		return nil, err
	}
	return trends, nil
}

// GetPipelineHistory returns the most recent pipeline runs for a project.
func (s *Store) GetPipelineHistory(ctx context.Context, projectID int, limit int) ([]PipelineRun, error) {
	key := fmt.Sprintf("%s%d", pipelineKeyPrefix, projectID)

	members, err := s.redis.ZRevRangeByScore(ctx, key, &redis.ZRangeBy{
		Min:    "-inf",
		Max:    "+inf",
		Count:  int64(limit),
		Offset: 0,
	}).Result()
	if err != nil {
		return nil, fmt.Errorf("redis zrevrangebyscore: %w", err)
	}

	var runs []PipelineRun
	for _, m := range members {
		var r PipelineRun
		if err := json.Unmarshal([]byte(m), &r); err == nil {
			runs = append(runs, r)
		}
	}

	return runs, nil
}

// GetAllProjectKeys returns all project IDs that have pipeline data.
func (s *Store) GetAllPipelineProjectIDs(ctx context.Context) ([]int, error) {
	var keys []string
	var cursor uint64
	for {
		var batch []string
		var err error
		batch, cursor, err = s.redis.Scan(ctx, cursor, pipelineKeyPrefix+"*", 100).Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		if cursor == 0 {
			break
		}
	}

	var ids []int
	for _, k := range keys {
		suffix := k[len(pipelineKeyPrefix):]
		var id int
		if _, err := fmt.Sscanf(suffix, "%d", &id); err == nil {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// MaterializeCISummary scans pipeline data from the last 24h and writes an
// aggregated CI health summary to Redis.
func (s *Store) MaterializeCISummary(ctx context.Context) {
	summary, err := s.computeCISummary(ctx)
	if err != nil {
		return
	}

	data, err := json.Marshal(summary)
	if err != nil {
		return
	}
	s.redis.Set(ctx, ciDashboardSummaryKey, data, ciDashboardSummaryTTL)
}

func (s *Store) computeCISummary(ctx context.Context) (*CISummary, error) {
	ids, err := s.GetAllPipelineProjectIDs(ctx)
	if err != nil {
		return nil, err
	}

	cutoff := time.Now().Add(-24 * time.Hour).Unix()
	summary := &CISummary{}

	var totalDuration float64
	var totalCompleted int
	projectAvgDurations := make(map[int]float64)

	for _, id := range ids {
		key := fmt.Sprintf("%s%d", pipelineKeyPrefix, id)
		members, err := s.redis.ZRangeByScore(ctx, key, &redis.ZRangeBy{
			Min: fmt.Sprintf("%d", cutoff),
			Max: "+inf",
		}).Result()
		if err != nil {
			continue
		}

		var projectDurationSum float64
		var projectCount int
		for _, m := range members {
			var r PipelineRun
			if err := json.Unmarshal([]byte(m), &r); err != nil {
				continue
			}
			switch r.Status {
			case "running", "pending":
				summary.ActivePipelines++
			case "success":
				summary.SuccessLast24h++
				totalDuration += r.Duration
				totalCompleted++
				projectDurationSum += r.Duration
				projectCount++
			case "failed":
				summary.FailedLast24h++
				totalDuration += r.Duration
				totalCompleted++
				projectDurationSum += r.Duration
				projectCount++
			}
		}
		if projectCount > 0 {
			projectAvgDurations[id] = projectDurationSum / float64(projectCount)
		}
	}

	if totalCompleted > 0 {
		summary.AvgDuration24h = totalDuration / float64(totalCompleted)
		summary.SuccessRate24h = float64(summary.SuccessLast24h) / float64(totalCompleted) * 100
	}

	// Find slowest project by average duration.
	for id, avgDur := range projectAvgDurations {
		if avgDur > summary.SlowestDuration {
			summary.SlowestDuration = avgDur
			summary.SlowestProject = s.GetProjectName(ctx, id)
			if summary.SlowestProject == "" {
				summary.SlowestProject = fmt.Sprintf("Project #%d", id)
			}
		}
	}
	return summary, nil
}

// GetCISummary returns the pre-materialized CI dashboard summary.
func (s *Store) GetCISummary(ctx context.Context) (*CISummary, error) {
	data, err := s.redis.Get(ctx, ciDashboardSummaryKey).Bytes()
	if err == nil {
		var summary CISummary
		if err := json.Unmarshal(data, &summary); err == nil {
			return &summary, nil
		}
	}

	value, refreshErr, _ := s.refresh.Do(ciDashboardSummaryKey, func() (any, error) {
		summary, err := s.computeCISummary(ctx)
		if err != nil {
			return nil, err
		}
		data, err := json.Marshal(summary)
		if err != nil {
			return nil, err
		}
		if err := s.redis.Set(ctx, ciDashboardSummaryKey, data, ciDashboardSummaryTTL).Err(); err != nil {
			return nil, err
		}
		return data, nil
	})
	if refreshErr != nil {
		return nil, refreshErr
	}

	var summary CISummary
	if err := json.Unmarshal(value.([]byte), &summary); err != nil {
		return nil, err
	}
	return &summary, nil
}

// StoreProjectNames stores a batch of project ID → path_with_namespace mappings.
func (s *Store) StoreProjectNames(ctx context.Context, names map[string]interface{}) {
	if len(names) == 0 {
		return
	}
	s.redis.HSet(ctx, projectNamesKey, names)
}

// GetProjectName returns the cached path_with_namespace for a project ID.
func (s *Store) GetProjectName(ctx context.Context, projectID int) string {
	name, err := s.redis.HGet(ctx, projectNamesKey, fmt.Sprintf("%d", projectID)).Result()
	if err != nil {
		return ""
	}
	return name
}

func avg(vals []float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	sum := 0.0
	for _, v := range vals {
		sum += v
	}
	return sum / float64(len(vals))
}

func percentile(vals []float64, pct float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	sorted := make([]float64, len(vals))
	copy(sorted, vals)
	sort.Float64s(sorted)

	rank := pct / 100.0 * float64(len(sorted)-1)
	lower := int(math.Floor(rank))
	upper := int(math.Ceil(rank))
	if lower == upper || upper >= len(sorted) {
		return sorted[lower]
	}
	frac := rank - float64(lower)
	return sorted[lower]*(1-frac) + sorted[upper]*frac
}
