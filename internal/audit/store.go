package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const redisKey = "flexdeck:audit"

// Entry represents a single audit log entry.
type Entry struct {
	ID         string `json:"id"`
	Timestamp  string `json:"timestamp"`
	Action     string `json:"action"`
	Method     string `json:"method"`
	Path       string `json:"path"`
	Status     int    `json:"status"`
	DurationMs int64  `json:"durationMs"`
	RemoteAddr string `json:"remoteAddr"`
	UserAgent  string `json:"userAgent"`
	UserID     string `json:"userId,omitempty"`
	Username   string `json:"username,omitempty"`
	Role       string `json:"role,omitempty"`
	Body       string `json:"body,omitempty"`
}

// QueryOpts controls how audit entries are queried.
type QueryOpts struct {
	Since  time.Time
	Until  time.Time
	Action string
	UserID string
	Offset int64
	Limit  int64
}

// Store persists audit entries in a Redis sorted set.
type Store struct {
	rdb *redis.Client
	ttl time.Duration
}

// NewStore creates a new audit store backed by Redis.
func NewStore(client *redis.Client, ttlDays int) *Store {
	if ttlDays <= 0 {
		ttlDays = 90
	}
	return &Store{
		rdb: client,
		ttl: time.Duration(ttlDays) * 24 * time.Hour,
	}
}

// Record persists an audit entry and prunes expired entries.
func (s *Store) Record(ctx context.Context, entry Entry) error {
	if entry.ID == "" {
		entry.ID = uuid.New().String()
	}
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().UTC().Format(time.RFC3339Nano)
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("audit: marshal entry: %w", err)
	}

	ts, _ := time.Parse(time.RFC3339Nano, entry.Timestamp)
	score := float64(ts.UnixMilli())

	pipe := s.rdb.Pipeline()
	pipe.ZAdd(ctx, redisKey, redis.Z{Score: score, Member: string(data)})

	// Prune entries older than TTL
	cutoff := float64(time.Now().Add(-s.ttl).UnixMilli())
	pipe.ZRemRangeByScore(ctx, redisKey, "-inf", fmt.Sprintf("%f", cutoff))

	_, err = pipe.Exec(ctx)
	return err
}

// Query returns audit entries matching the given options.
func (s *Store) Query(ctx context.Context, opts QueryOpts) ([]Entry, int64, error) {
	min := "-inf"
	max := "+inf"

	if !opts.Since.IsZero() {
		min = fmt.Sprintf("%d", opts.Since.UnixMilli())
	}
	if !opts.Until.IsZero() {
		max = fmt.Sprintf("%d", opts.Until.UnixMilli())
	}

	// Get total count for the range
	total, err := s.rdb.ZCount(ctx, redisKey, min, max).Result()
	if err != nil {
		return nil, 0, fmt.Errorf("audit: count: %w", err)
	}

	limit := opts.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	results, err := s.rdb.ZRevRangeByScore(ctx, redisKey, &redis.ZRangeBy{
		Min:    min,
		Max:    max,
		Offset: opts.Offset,
		Count:  limit,
	}).Result()
	if err != nil {
		return nil, 0, fmt.Errorf("audit: query: %w", err)
	}

	entries := make([]Entry, 0, len(results))
	for _, raw := range results {
		var e Entry
		if err := json.Unmarshal([]byte(raw), &e); err != nil {
			continue
		}
		// Apply client-side filters
		if opts.Action != "" && e.Action != opts.Action {
			continue
		}
		if opts.UserID != "" && e.UserID != opts.UserID {
			continue
		}
		entries = append(entries, e)
	}

	return entries, total, nil
}

// Stats returns aggregated audit statistics.
func (s *Store) Stats(ctx context.Context) (map[string]any, error) {
	total, err := s.rdb.ZCard(ctx, redisKey).Result()
	if err != nil {
		return nil, err
	}

	// Get last 7 days of entries for breakdown
	sevenDaysAgo := time.Now().Add(-7 * 24 * time.Hour)
	results, err := s.rdb.ZRevRangeByScore(ctx, redisKey, &redis.ZRangeBy{
		Min:   fmt.Sprintf("%d", sevenDaysAgo.UnixMilli()),
		Max:   "+inf",
		Count: 10000,
	}).Result()
	if err != nil {
		return nil, err
	}

	byAction := map[string]int{}
	byUser := map[string]int{}
	perDay := map[string]int{}

	for _, raw := range results {
		var e Entry
		if err := json.Unmarshal([]byte(raw), &e); err != nil {
			continue
		}
		byAction[e.Action]++
		if e.Username != "" {
			byUser[e.Username]++
		}
		if t, err := time.Parse(time.RFC3339Nano, e.Timestamp); err == nil {
			day := t.Format("2006-01-02")
			perDay[day]++
		}
	}

	perDayList := make([]map[string]any, 0, len(perDay))
	for day, count := range perDay {
		perDayList = append(perDayList, map[string]any{"date": day, "count": count})
	}

	return map[string]any{
		"total":    total,
		"byAction": byAction,
		"byUser":   byUser,
		"perDay":   perDayList,
	}, nil
}
