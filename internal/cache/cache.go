package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// Cache provides a generic Redis cache layer with TTL-based expiration.
type Cache struct {
	redis  *redis.Client
	prefix string
}

// New creates a new Cache using an existing Redis client.
func New(client *redis.Client, prefix string) *Cache {
	return &Cache{
		redis:  client,
		prefix: prefix,
	}
}

// GetOrFetch retrieves a cached value or calls fetch to populate it.
// The fetch function is called when the cache misses. The result is
// JSON-serialized and stored with the given TTL.
func (c *Cache) GetOrFetch(ctx context.Context, key string, ttl time.Duration, fetch func() (any, error)) ([]byte, error) {
	fullKey := c.prefix + key

	// Try cache first
	cached, err := c.redis.Get(ctx, fullKey).Bytes()
	if err == nil {
		return cached, nil
	}
	if err != redis.Nil {
		slog.Warn("cache get error, falling through to fetch", "key", fullKey, "error", err)
	}

	// Cache miss — call fetch
	result, err := fetch()
	if err != nil {
		return nil, err
	}

	data, err := json.Marshal(result)
	if err != nil {
		return nil, fmt.Errorf("cache marshal error: %w", err)
	}

	// Store in cache (best-effort, don't fail the request)
	if setErr := c.redis.Set(ctx, fullKey, data, ttl).Err(); setErr != nil {
		slog.Warn("cache set error", "key", fullKey, "error", setErr)
	}

	return data, nil
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
	if err := c.redis.Del(ctx, fullKey).Err(); err != nil {
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
