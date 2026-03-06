package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/litellm"
)

// Store manages metrics storage in Redis
type Store struct {
	redis *redis.Client
}

// MetricPoint represents a single metric sample
type MetricPoint struct {
	Timestamp    int64   `json:"ts"`
	TotalTokens  float64 `json:"total"`
	OutputTokens float64 `json:"output"`
	InputTokens  float64 `json:"input"`
	RequestCount float64 `json:"requests"`
	LatencyMs    float64 `json:"latency_ms"`
}

// ModelThroughput represents calculated tok/s for a model
type ModelThroughput struct {
	Model           string    `json:"model"`
	TokPerSec1m     float64   `json:"tok_per_sec_1m"`
	TokPerSec5m     float64   `json:"tok_per_sec_5m"`
	TokPerSec15m    float64   `json:"tok_per_sec_15m"`
	OutputTokPerSec float64   `json:"output_tok_per_sec"`
	RequestsPerMin  float64   `json:"requests_per_min"`
	AvgLatencyMs    float64   `json:"avg_latency_ms"`
	SparklineData   []float64 `json:"sparkline"`
	Trend           string    `json:"trend"`
	LastUpdated     time.Time `json:"last_updated"`
}

// NewStore creates a new metrics store
func NewStore(cfg config.RedisConfig) (*Store, error) {
	opts, err := redis.ParseURL(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("invalid redis URL: %w", err)
	}
	opts.Password = cfg.Password
	opts.DB = cfg.DB

	client := redis.NewClient(opts)

	// Test connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis connection failed: %w", err)
	}

	return NewStoreWithClient(client), nil
}

// NewStoreWithClient wraps an existing Redis client for metrics storage.
func NewStoreWithClient(client *redis.Client) *Store {
	return &Store{redis: client}
}

// RedisClient returns the underlying Redis client for use by other packages.
func (s *Store) RedisClient() *redis.Client {
	return s.redis
}

// Close closes the Redis connection
func (s *Store) Close() error {
	return s.redis.Close()
}

// StoreMetrics stores a metrics snapshot in Redis
func (s *Store) StoreMetrics(ctx context.Context, metrics []litellm.ModelMetrics) error {
	pipe := s.redis.Pipeline()
	now := time.Now().Unix()

	for _, m := range metrics {
		key := fmt.Sprintf("litellm:metrics:%s", m.Model)
		point := MetricPoint{
			Timestamp:    now,
			TotalTokens:  m.TotalTokens,
			OutputTokens: m.OutputTokens,
			InputTokens:  m.InputTokens,
			RequestCount: m.RequestCount,
			LatencyMs:    m.TotalLatencyMs,
		}

		data, err := json.Marshal(point)
		if err != nil {
			continue
		}

		// Use Redis sorted set with timestamp as score for time-series
		pipe.ZAdd(ctx, key, redis.Z{
			Score:  float64(now),
			Member: string(data),
		})

		// Trim old data (keep last 20 minutes)
		cutoff := float64(now - 1200)
		pipe.ZRemRangeByScore(ctx, key, "-inf", fmt.Sprintf("%f", cutoff))

		// Set TTL on key
		pipe.Expire(ctx, key, 25*time.Minute)
	}

	_, err := pipe.Exec(ctx)
	return err
}

// GetThroughput calculates tok/s for all models across time windows
func (s *Store) GetThroughput(ctx context.Context) ([]ModelThroughput, error) {
	// Scan model keys incrementally to avoid blocking Redis
	var keys []string
	var cursor uint64
	for {
		var batch []string
		var err error
		batch, cursor, err = s.redis.Scan(ctx, cursor, "litellm:metrics:*", 100).Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, batch...)
		if cursor == 0 {
			break
		}
	}

	results := make([]ModelThroughput, 0, len(keys))
	now := time.Now().Unix()

	for _, key := range keys {
		model := key[len("litellm:metrics:"):]

		// Get all points for this model (last 15 minutes)
		points, err := s.redis.ZRangeByScore(ctx, key, &redis.ZRangeBy{
			Min: fmt.Sprintf("%d", now-900),
			Max: fmt.Sprintf("%d", now),
		}).Result()
		if err != nil {
			continue
		}

		if len(points) < 2 {
			continue // Need at least 2 points to calculate rate
		}

		throughput := s.calculateThroughput(model, points, now)
		results = append(results, throughput)
	}

	// Sort by model name
	sort.Slice(results, func(i, j int) bool {
		return results[i].Model < results[j].Model
	})

	return results, nil
}

// GetModelThroughput returns throughput for a specific model
func (s *Store) GetModelThroughput(ctx context.Context, model string) (*ModelThroughput, error) {
	key := fmt.Sprintf("litellm:metrics:%s", model)
	now := time.Now().Unix()

	points, err := s.redis.ZRangeByScore(ctx, key, &redis.ZRangeBy{
		Min: fmt.Sprintf("%d", now-900),
		Max: fmt.Sprintf("%d", now),
	}).Result()
	if err != nil {
		return nil, err
	}

	if len(points) < 2 {
		return nil, fmt.Errorf("insufficient data points")
	}

	throughput := s.calculateThroughput(model, points, now)
	return &throughput, nil
}

func (s *Store) calculateThroughput(model string, points []string, now int64) ModelThroughput {
	var parsed []MetricPoint
	for _, p := range points {
		var mp MetricPoint
		if err := json.Unmarshal([]byte(p), &mp); err == nil {
			parsed = append(parsed, mp)
		}
	}

	if len(parsed) < 2 {
		return ModelThroughput{Model: model, LastUpdated: time.Now()}
	}

	// Sort by timestamp
	sort.Slice(parsed, func(i, j int) bool {
		return parsed[i].Timestamp < parsed[j].Timestamp
	})

	result := ModelThroughput{
		Model:       model,
		LastUpdated: time.Now(),
	}

	// Calculate tok/s for each window
	result.TokPerSec1m = s.calculateRate(parsed, now, 60)
	result.TokPerSec5m = s.calculateRate(parsed, now, 300)
	result.TokPerSec15m = s.calculateRate(parsed, now, 900)

	// Output tokens rate
	result.OutputTokPerSec = s.calculateOutputRate(parsed, now, 60)

	// Requests per minute
	result.RequestsPerMin = s.calculateRequestRate(parsed, now, 60) * 60

	// Average latency
	result.AvgLatencyMs = s.calculateAvgLatency(parsed)

	// Sparkline data (last 15 data points, tok/s at each point)
	result.SparklineData = s.generateSparkline(parsed)

	// Trend detection
	result.Trend = s.detectTrend(result.SparklineData)

	return result
}

func (s *Store) calculateRate(points []MetricPoint, now int64, windowSec int64) float64 {
	cutoff := now - windowSec
	var first, last *MetricPoint

	for i := range points {
		if points[i].Timestamp >= cutoff {
			if first == nil {
				first = &points[i]
			}
			last = &points[i]
		}
	}

	if first == nil || last == nil || first.Timestamp == last.Timestamp {
		return 0
	}

	tokenDiff := last.TotalTokens - first.TotalTokens
	timeDiff := float64(last.Timestamp - first.Timestamp)

	if timeDiff <= 0 || tokenDiff < 0 {
		return 0
	}

	return tokenDiff / timeDiff
}

func (s *Store) calculateOutputRate(points []MetricPoint, now int64, windowSec int64) float64 {
	cutoff := now - windowSec
	var first, last *MetricPoint

	for i := range points {
		if points[i].Timestamp >= cutoff {
			if first == nil {
				first = &points[i]
			}
			last = &points[i]
		}
	}

	if first == nil || last == nil || first.Timestamp == last.Timestamp {
		return 0
	}

	tokenDiff := last.OutputTokens - first.OutputTokens
	timeDiff := float64(last.Timestamp - first.Timestamp)

	if timeDiff <= 0 || tokenDiff < 0 {
		return 0
	}

	return tokenDiff / timeDiff
}

func (s *Store) calculateRequestRate(points []MetricPoint, now int64, windowSec int64) float64 {
	cutoff := now - windowSec
	var first, last *MetricPoint

	for i := range points {
		if points[i].Timestamp >= cutoff {
			if first == nil {
				first = &points[i]
			}
			last = &points[i]
		}
	}

	if first == nil || last == nil || first.Timestamp == last.Timestamp {
		return 0
	}

	reqDiff := last.RequestCount - first.RequestCount
	timeDiff := float64(last.Timestamp - first.Timestamp)

	if timeDiff <= 0 || reqDiff < 0 {
		return 0
	}

	return reqDiff / timeDiff
}

func (s *Store) calculateAvgLatency(points []MetricPoint) float64 {
	if len(points) == 0 {
		return 0
	}

	// Get the most recent latency value
	return points[len(points)-1].LatencyMs
}

func (s *Store) generateSparkline(points []MetricPoint) []float64 {
	if len(points) < 2 {
		return nil
	}

	// Take last 15 points max
	start := 0
	if len(points) > 15 {
		start = len(points) - 15
	}
	subset := points[start:]

	sparkline := make([]float64, 0, len(subset)-1)

	for i := 1; i < len(subset); i++ {
		tokenDiff := subset[i].TotalTokens - subset[i-1].TotalTokens
		timeDiff := float64(subset[i].Timestamp - subset[i-1].Timestamp)

		if timeDiff > 0 && tokenDiff >= 0 {
			sparkline = append(sparkline, tokenDiff/timeDiff)
		} else {
			sparkline = append(sparkline, 0)
		}
	}

	return sparkline
}

func (s *Store) detectTrend(sparkline []float64) string {
	if len(sparkline) < 3 {
		return "stable"
	}

	// Compare first half average to second half average
	mid := len(sparkline) / 2
	var firstHalf, secondHalf float64

	for i := 0; i < mid; i++ {
		firstHalf += sparkline[i]
	}
	firstHalf /= float64(mid)

	for i := mid; i < len(sparkline); i++ {
		secondHalf += sparkline[i]
	}
	secondHalf /= float64(len(sparkline) - mid)

	// 10% threshold for trend detection
	if firstHalf == 0 && secondHalf == 0 {
		return "stable"
	}

	if firstHalf == 0 && secondHalf > 0 {
		return "up"
	}

	ratio := secondHalf / firstHalf
	if ratio > 1.1 {
		return "up"
	} else if ratio < 0.9 {
		return "down"
	}
	return "stable"
}
