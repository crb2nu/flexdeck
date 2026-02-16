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
	PipelineID int       `json:"pipeline_id"`
	ProjectID  int       `json:"project_id"`
	Ref        string    `json:"ref"`
	Status     string    `json:"status"`
	Duration   float64   `json:"duration_s"`
	CreatedAt  time.Time `json:"created_at"`
	FinishedAt time.Time `json:"finished_at,omitempty"`
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
	return err
}

// GetPipelineTrends computes trend data for a project over a time window.
func (s *Store) GetPipelineTrends(ctx context.Context, projectID int, window time.Duration) (*PipelineTrend, error) {
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

	// Calculate avg/p95 duration
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

	// Build sparkline from durations (last 20 data points)
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
