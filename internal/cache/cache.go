package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/rand"
	"sync/atomic"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// Stats holds atomic cache operation counters.
type Stats struct {
	Hits      int64 `json:"hits"`
	Misses    int64 `json:"misses"`
	StaleHits int64 `json:"stale_hits"`
	Errors    int64 `json:"errors"`
}

const staleKeySuffix = ":stale"

// FetchOptions controls cache freshness, stale fallback, and jitter behavior.
type FetchOptions struct {
	TTL                      time.Duration
	StaleTTL                 time.Duration
	JitterFraction           float64
	BackgroundRefreshTimeout time.Duration
}

// Cache provides a generic Redis cache layer with TTL-based expiration.
type Cache struct {
	redis  *redis.Client
	prefix string
	group  singleflight.Group

	hits      atomic.Int64
	misses    atomic.Int64
	staleHits atomic.Int64
	errors    atomic.Int64
}

// New creates a new Cache using an existing Redis client.
func New(client *redis.Client, prefix string) *Cache {
	return &Cache{
		redis:  client,
		prefix: prefix,
	}
}

// Stats returns a snapshot of cache hit/miss counters.
func (c *Cache) Stats() Stats {
	return Stats{
		Hits:      c.hits.Load(),
		Misses:    c.misses.Load(),
		StaleHits: c.staleHits.Load(),
		Errors:    c.errors.Load(),
	}
}

// NewRedisClient creates and validates a Redis client from the shared app config.
func NewRedisClient(cfg config.RedisConfig) (*redis.Client, error) {
	opts, err := redis.ParseURL(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("invalid redis URL: %w", err)
	}
	opts.Password = cfg.Password
	opts.DB = cfg.DB

	client := redis.NewClient(opts)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("redis connection failed: %w", err)
	}

	return client, nil
}

// GetOrFetch retrieves a cached value or calls fetch to populate it.
// The fetch function is called when the cache misses. The result is
// JSON-serialized and stored with the given TTL.
func (c *Cache) GetOrFetch(ctx context.Context, key string, ttl time.Duration, fetch func() (any, error)) ([]byte, error) {
	return c.GetOrFetchWithOptions(ctx, key, FetchOptions{TTL: ttl}, func(context.Context) (any, error) {
		return fetch()
	})
}

// GetOrFetchWithOptions retrieves a cached value with coalescing and optional stale fallback.
func (c *Cache) GetOrFetchWithOptions(ctx context.Context, key string, opts FetchOptions, fetch func(context.Context) (any, error)) ([]byte, error) {
	return c.GetOrFetchBytesWithOptions(ctx, key, opts, func(fetchCtx context.Context) ([]byte, error) {
		result, err := fetch(fetchCtx)
		if err != nil {
			return nil, err
		}

		data, err := json.Marshal(result)
		if err != nil {
			return nil, fmt.Errorf("cache marshal error: %w", err)
		}

		return data, nil
	})
}

// GetOrFetchBytesWithOptions retrieves raw bytes with coalescing and optional stale fallback.
func (c *Cache) GetOrFetchBytesWithOptions(ctx context.Context, key string, opts FetchOptions, fetch func(context.Context) ([]byte, error)) ([]byte, error) {
	fullKey := c.prefix + key
	if cached, found := c.readValue(ctx, fullKey); found {
		c.hits.Add(1)
		return cached, nil
	}

	staleKey := fullKey + staleKeySuffix
	if stale, found := c.readValue(ctx, staleKey); found && opts.useStale() {
		c.staleHits.Add(1)
		c.refreshInBackground(fullKey, staleKey, opts, fetch)
		return stale, nil
	}

	c.misses.Add(1)
	value, err, _ := c.group.Do(fullKey, func() (any, error) {
		if cached, found := c.readValue(ctx, fullKey); found {
			return cached, nil
		}

		data, err := fetch(ctx)
		if err != nil {
			c.errors.Add(1)
			return nil, err
		}

		c.storeFetchedValue(ctx, fullKey, staleKey, data, opts)
		return data, nil
	})
	if err != nil {
		return nil, err
	}

	return value.([]byte), nil
}

// Get retrieves a cached value without fetching. Returns nil, nil on cache miss.
func (c *Cache) Get(ctx context.Context, key string) ([]byte, error) {
	fullKey := c.prefix + key
	cached, err := c.redis.Get(ctx, fullKey).Bytes()
	if err == redis.Nil {
		return nil, nil
	}
	return cached, err
}

// Set stores a value in the cache with the given TTL.
func (c *Cache) Set(ctx context.Context, key string, data []byte, ttl time.Duration) {
	fullKey := c.prefix + key
	if err := c.redis.Set(ctx, fullKey, data, ttl).Err(); err != nil {
		slog.Warn("cache set error", "key", fullKey, "error", err)
	}
}

// Invalidate removes a specific cache key.
func (c *Cache) Invalidate(ctx context.Context, key string) {
	fullKey := c.prefix + key
	if err := c.redis.Del(ctx, fullKey, fullKey+staleKeySuffix).Err(); err != nil {
		slog.Warn("cache invalidate error", "key", fullKey, "error", err)
	}
}

// InvalidatePattern removes all keys matching a glob pattern.
func (c *Cache) InvalidatePattern(ctx context.Context, pattern string) {
	fullPattern := c.prefix + pattern
	var cursor uint64
	for {
		var keys []string
		var err error
		keys, cursor, err = c.redis.Scan(ctx, cursor, fullPattern, 100).Result()
		if err != nil {
			slog.Warn("cache invalidate scan error", "pattern", fullPattern, "error", err)
			return
		}
		if len(keys) > 0 {
			c.redis.Del(ctx, keys...)
		}
		if cursor == 0 {
			break
		}
	}
}

func (c *Cache) readValue(ctx context.Context, fullKey string) ([]byte, bool) {
	cached, err := c.redis.Get(ctx, fullKey).Bytes()
	if err == nil {
		return cached, true
	}
	if err != redis.Nil {
		slog.Warn("cache get error, falling through to fetch", "key", fullKey, "error", err)
	}
	return nil, false
}

func (c *Cache) storeFetchedValue(ctx context.Context, fullKey, staleKey string, data []byte, opts FetchOptions) {
	ttl := applyTTLJitter(opts.TTL, opts.JitterFraction)
	if ttl >= 0 {
		if setErr := c.redis.Set(ctx, fullKey, data, ttl).Err(); setErr != nil {
			slog.Warn("cache set error", "key", fullKey, "error", setErr)
		}
	}

	if opts.useStale() {
		if setErr := c.redis.Set(ctx, staleKey, data, opts.StaleTTL).Err(); setErr != nil {
			slog.Warn("cache stale set error", "key", staleKey, "error", setErr)
		}
	}
}

func (c *Cache) refreshInBackground(fullKey, staleKey string, opts FetchOptions, fetch func(context.Context) ([]byte, error)) {
	go func() {
		refreshCtx := context.Background()
		cancel := func() {}
		if opts.BackgroundRefreshTimeout > 0 {
			refreshCtx, cancel = context.WithTimeout(context.Background(), opts.BackgroundRefreshTimeout)
		}
		defer cancel()

		_, err, _ := c.group.Do(fullKey, func() (any, error) {
			if cached, found := c.readValue(refreshCtx, fullKey); found {
				return cached, nil
			}

			data, err := fetch(refreshCtx)
			if err != nil {
				return nil, err
			}

			c.storeFetchedValue(refreshCtx, fullKey, staleKey, data, opts)
			return data, nil
		})
		if err != nil {
			slog.Warn("cache background refresh error", "key", fullKey, "error", err)
		}
	}()
}

func (o FetchOptions) useStale() bool {
	return o.StaleTTL > o.TTL && o.StaleTTL > 0
}

func applyTTLJitter(ttl time.Duration, fraction float64) time.Duration {
	if ttl <= 0 || fraction <= 0 {
		return ttl
	}

	if fraction > 1 {
		fraction = 1
	}

	minTTL := float64(ttl) * (1 - fraction)
	maxTTL := float64(ttl)
	if minTTL < 1 {
		minTTL = 1
	}
	if maxTTL < minTTL {
		maxTTL = minTTL
	}

	return time.Duration(minTTL + rand.Float64()*(maxTTL-minTTL))
}
