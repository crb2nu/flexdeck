package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	swapKeyPrefix      = "gpu:swap:"
	swapGroupKeyPrefix = "gpu:swap:group:"
	swapTTL            = 7 * 24 * time.Hour
	swapMaxAgeSec      = 7 * 24 * 3600 // 7 days in seconds
)

// GPUSwapEvent represents a GPU sharing state transition.
type GPUSwapEvent struct {
	Timestamp   time.Time `json:"ts"`
	Model       string    `json:"model"`
	Namespace   string    `json:"ns"`
	Group       string    `json:"group"`
	OldState    string    `json:"oldState"`
	NewState    string    `json:"newState"`
	PreemptedBy string    `json:"preemptedBy,omitempty"`
	DurationSec float64   `json:"durationSec,omitempty"`
}

// GroupSwapSummary provides aggregated swap statistics for a GPU group.
type GroupSwapSummary struct {
	TotalSwaps      int                       `json:"totalSwaps"`
	AvgQueueWaitSec float64                   `json:"avgQueueWaitSec"`
	ModelStats      map[string]ModelSwapStats `json:"modelStats"`
}

// ModelSwapStats holds per-model swap statistics within a group.
type ModelSwapStats struct {
	SwapCount      int     `json:"swapCount"`
	TotalActiveSec float64 `json:"totalActiveSec"`
	TotalQueuedSec float64 `json:"totalQueuedSec"`
}

// StoreSwapEvent stores a GPU swap event in Redis sorted sets keyed by model and group.
func (s *Store) StoreSwapEvent(ctx context.Context, event GPUSwapEvent) error {
	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal swap event: %w", err)
	}

	score := float64(event.Timestamp.Unix())
	member := string(data)
	cutoff := float64(time.Now().Unix() - swapMaxAgeSec)

	modelKey := fmt.Sprintf("%s%s:%s", swapKeyPrefix, event.Namespace, event.Model)
	groupKey := fmt.Sprintf("%s%s", swapGroupKeyPrefix, event.Group)

	pipe := s.redis.Pipeline()

	// Store in model key
	pipe.ZAdd(ctx, modelKey, redis.Z{Score: score, Member: member})
	pipe.ZRemRangeByScore(ctx, modelKey, "-inf", fmt.Sprintf("%f", cutoff))
	pipe.Expire(ctx, modelKey, swapTTL)

	// Store in group key
	pipe.ZAdd(ctx, groupKey, redis.Z{Score: score, Member: member})
	pipe.ZRemRangeByScore(ctx, groupKey, "-inf", fmt.Sprintf("%f", cutoff))
	pipe.Expire(ctx, groupKey, swapTTL)

	_, err = pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("store swap event: %w", err)
	}
	return nil
}

// GetModelSwapHistory returns swap events for a specific model within the given time window.
func (s *Store) GetModelSwapHistory(ctx context.Context, namespace, model string, hours int) ([]GPUSwapEvent, error) {
	key := fmt.Sprintf("%s%s:%s", swapKeyPrefix, namespace, model)
	return s.getSwapEvents(ctx, key, hours)
}

// GetGroupSwapHistory returns swap events for a GPU sharing group within the given time window.
// If namespace is non-empty, only events matching that namespace are returned.
func (s *Store) GetGroupSwapHistory(ctx context.Context, group, namespace string, hours int) ([]GPUSwapEvent, error) {
	key := fmt.Sprintf("%s%s", swapGroupKeyPrefix, group)
	events, err := s.getSwapEvents(ctx, key, hours)
	if err != nil {
		return nil, err
	}

	if namespace == "" {
		return events, nil
	}

	filtered := make([]GPUSwapEvent, 0, len(events))
	for _, e := range events {
		if e.Namespace == namespace {
			filtered = append(filtered, e)
		}
	}
	return filtered, nil
}

// getSwapEvents queries a Redis sorted set for swap events in the given time window.
func (s *Store) getSwapEvents(ctx context.Context, key string, hours int) ([]GPUSwapEvent, error) {
	cutoff := time.Now().Add(-time.Duration(hours) * time.Hour).Unix()

	members, err := s.redis.ZRangeByScore(ctx, key, &redis.ZRangeBy{
		Min: fmt.Sprintf("%d", cutoff),
		Max: "+inf",
	}).Result()
	if err != nil {
		return nil, fmt.Errorf("redis zrangebyscore: %w", err)
	}

	events := make([]GPUSwapEvent, 0, len(members))
	for _, m := range members {
		var e GPUSwapEvent
		if err := json.Unmarshal([]byte(m), &e); err == nil {
			events = append(events, e)
		}
	}
	return events, nil
}

// ComputeGroupSummary computes aggregated swap statistics from a list of events.
func ComputeGroupSummary(events []GPUSwapEvent) GroupSwapSummary {
	summary := GroupSwapSummary{
		TotalSwaps: len(events),
		ModelStats: make(map[string]ModelSwapStats),
	}

	var totalQueueWait float64
	var queueWaitCount int

	for _, e := range events {
		ms := summary.ModelStats[e.Model]
		ms.SwapCount++

		switch e.OldState {
		case "Active":
			ms.TotalActiveSec += e.DurationSec
		case "Queued":
			ms.TotalQueuedSec += e.DurationSec
			totalQueueWait += e.DurationSec
			queueWaitCount++
		}

		summary.ModelStats[e.Model] = ms
	}

	if queueWaitCount > 0 {
		summary.AvgQueueWaitSec = totalQueueWait / float64(queueWaitCount)
	}

	return summary
}
