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
	AvgDuration float64   `json:"avg_duration_s"`
	P95Duration float64   `json:"p95_duration_s"`
	SuccessRate float64   `json:"success_rate"`
	TotalRuns   int       `json:"total_runs"`
	Sparkline   []float64 `json:"sparkline"`
	Trend       string    `json:"trend"`
}

const pipelineKeyPrefix = "ci:pipeline:"
const pipelineTTL = 8 * 24 * time.Hour // 8 days

const (
	pipelineTrendSummaryPrefix = "ci:summary:trend:"
	pipelineAllTrendsSummary   = "ci:summary:trends:all"
	pipelineTrendSummaryTTL    = 5 * time.Minute
	pipelineAllTrendsTTL       = 3 * time.Minute
)

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
	return s.computePipelineTrends(ctx, projectID, window)
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
		ProjectID: projectID,
		TotalRuns: len(runs),
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

// GetMaterializedAllTrends returns the pre-computed all-projects trend summary.
// Returns nil, err if the key is missing or corrupt (caller should fall back).
func (s *Store) GetMaterializedAllTrends(ctx context.Context) ([]*PipelineTrend, error) {
	data, err := s.redis.Get(ctx, pipelineAllTrendsSummary).Bytes()
	if err != nil {
		return nil, err
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
