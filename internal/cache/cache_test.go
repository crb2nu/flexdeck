package cache

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/redis/go-redis/v9"
)

func newTestCache(t *testing.T) (*Cache, *miniredis.Miniredis) {
	t.Helper()

	server, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(server.Close)

	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		if closeErr := client.Close(); closeErr != nil {
			t.Fatalf("failed to close redis client: %v", closeErr)
		}
	})

	return New(client, "flexdeck:test:"), server
}

func TestGetOrFetchCachesOnMissAndHitsOnNextRead(t *testing.T) {
	t.Parallel()

	cache, _ := newTestCache(t)
	ctx := context.Background()

	fetchCalls := 0
	fetch := func() (any, error) {
		fetchCalls++
		return map[string]any{"ok": true, "count": fetchCalls}, nil
	}

	first, err := cache.GetOrFetch(ctx, "key", time.Minute, fetch)
	if err != nil {
		t.Fatalf("first GetOrFetch() returned error: %v", err)
	}
	second, err := cache.GetOrFetch(ctx, "key", time.Minute, fetch)
	if err != nil {
		t.Fatalf("second GetOrFetch() returned error: %v", err)
	}

	if fetchCalls != 1 {
		t.Fatalf("expected fetch to be called once, got %d", fetchCalls)
	}
	if string(first) != string(second) {
		t.Fatalf("expected cached payload to match first payload: first=%s second=%s", string(first), string(second))
	}
}

func TestSetGetAndExpiry(t *testing.T) {
	t.Parallel()

	cache, server := newTestCache(t)
	ctx := context.Background()

	expected := []byte(`{"service":"flexdeck"}`)
	cache.Set(ctx, "ttl-key", expected, 2*time.Second)

	got, err := cache.Get(ctx, "ttl-key")
	if err != nil {
		t.Fatalf("Get() returned error before expiry: %v", err)
	}
	if string(got) != string(expected) {
		t.Fatalf("unexpected cached payload before expiry: got=%s want=%s", string(got), string(expected))
	}

	server.FastForward(3 * time.Second)

	got, err = cache.Get(ctx, "ttl-key")
	if err != nil {
		t.Fatalf("Get() returned error after expiry: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil after key expiry, got=%s", string(got))
	}
}

func TestInvalidatePatternRemovesOnlyMatchingKeys(t *testing.T) {
	t.Parallel()

	cache, _ := newTestCache(t)
	ctx := context.Background()

	cache.Set(ctx, "group:a", []byte(`"a"`), time.Minute)
	cache.Set(ctx, "group:b", []byte(`"b"`), time.Minute)
	cache.Set(ctx, "other:c", []byte(`"c"`), time.Minute)

	cache.InvalidatePattern(ctx, "group:*")

	if got, err := cache.Get(ctx, "group:a"); err != nil || got != nil {
		t.Fatalf("expected group:a to be removed, got=%q err=%v", string(got), err)
	}
	if got, err := cache.Get(ctx, "group:b"); err != nil || got != nil {
		t.Fatalf("expected group:b to be removed, got=%q err=%v", string(got), err)
	}
	got, err := cache.Get(ctx, "other:c")
	if err != nil {
		t.Fatalf("unexpected error reading other:c: %v", err)
	}
	if got == nil {
		t.Fatal("expected other:c to remain in cache")
	}
}

func TestGetOrFetchReturnsMarshalErrorForUnsupportedPayload(t *testing.T) {
	t.Parallel()

	cache, _ := newTestCache(t)
	ctx := context.Background()

	_, err := cache.GetOrFetch(ctx, "bad", time.Minute, func() (any, error) {
		return map[string]any{"bad": make(chan int)}, nil
	})
	if err == nil {
		t.Fatal("expected marshal error but got nil")
	}
}

func TestGetOrFetchPayloadIsJSONEncoded(t *testing.T) {
	t.Parallel()

	cache, _ := newTestCache(t)
	ctx := context.Background()

	data, err := cache.GetOrFetch(ctx, "json", time.Minute, func() (any, error) {
		return struct {
			Name string `json:"name"`
		}{Name: "flexdeck"}, nil
	})
	if err != nil {
		t.Fatalf("GetOrFetch() returned error: %v", err)
	}

	var decoded map[string]string
	if unmarshalErr := json.Unmarshal(data, &decoded); unmarshalErr != nil {
		t.Fatalf("failed to decode cached JSON: %v", unmarshalErr)
	}
	if decoded["name"] != "flexdeck" {
		t.Fatalf("unexpected decoded payload: %+v", decoded)
	}
}

func TestNewRedisClientConnectsAndHonorsDB(t *testing.T) {
	t.Parallel()

	server, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	defer server.Close()

	client, err := NewRedisClient(config.RedisConfig{
		URL: "redis://" + server.Addr(),
		DB:  3,
	})
	if err != nil {
		t.Fatalf("NewRedisClient() returned error: %v", err)
	}
	defer func() {
		if closeErr := client.Close(); closeErr != nil {
			t.Fatalf("failed to close redis client: %v", closeErr)
		}
	}()

	if got := client.Options().DB; got != 3 {
		t.Fatalf("expected DB 3, got %d", got)
	}
}

func TestGetOrFetchBytesWithOptionsCoalescesConcurrentMisses(t *testing.T) {
	t.Parallel()

	cache, _ := newTestCache(t)
	ctx := context.Background()

	var fetchCalls atomic.Int32
	start := make(chan struct{})

	fetch := func(context.Context) ([]byte, error) {
		fetchCalls.Add(1)
		<-start
		return []byte(`{"ok":true}`), nil
	}

	const workers = 8
	var wg sync.WaitGroup
	results := make([][]byte, workers)
	errs := make([]error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			results[idx], errs[idx] = cache.GetOrFetchBytesWithOptions(ctx, "coalesce", FetchOptions{
				TTL:            time.Minute,
				JitterFraction: 0.1,
			}, fetch)
		}(i)
	}

	close(start)
	wg.Wait()

	if got := fetchCalls.Load(); got != 1 {
		t.Fatalf("expected a single fetch call, got %d", got)
	}
	for i, err := range errs {
		if err != nil {
			t.Fatalf("worker %d returned error: %v", i, err)
		}
		if string(results[i]) != `{"ok":true}` {
			t.Fatalf("worker %d returned unexpected payload %q", i, string(results[i]))
		}
	}
}

func TestGetOrFetchBytesWithOptionsServesStaleAndRefreshesInBackground(t *testing.T) {
	t.Parallel()

	cache, server := newTestCache(t)
	ctx := context.Background()

	var fetchCalls atomic.Int32
	refreshed := make(chan struct{}, 1)

	fetch := func(context.Context) ([]byte, error) {
		call := fetchCalls.Add(1)
		if call == 1 {
			return []byte(`{"version":1}`), nil
		}
		refreshed <- struct{}{}
		return []byte(`{"version":2}`), nil
	}

	first, err := cache.GetOrFetchBytesWithOptions(ctx, "stale", FetchOptions{
		TTL:                      time.Second,
		StaleTTL:                 5 * time.Second,
		BackgroundRefreshTimeout: time.Second,
	}, fetch)
	if err != nil {
		t.Fatalf("first GetOrFetchBytesWithOptions() returned error: %v", err)
	}
	if string(first) != `{"version":1}` {
		t.Fatalf("unexpected first payload %q", string(first))
	}

	server.FastForward(2 * time.Second)

	stale, err := cache.GetOrFetchBytesWithOptions(ctx, "stale", FetchOptions{
		TTL:                      time.Second,
		StaleTTL:                 5 * time.Second,
		BackgroundRefreshTimeout: time.Second,
	}, fetch)
	if err != nil {
		t.Fatalf("stale GetOrFetchBytesWithOptions() returned error: %v", err)
	}
	if string(stale) != `{"version":1}` {
		t.Fatalf("expected stale payload, got %q", string(stale))
	}

	select {
	case <-refreshed:
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for background refresh to start")
	}

	deadline := time.Now().Add(time.Second)
	for {
		current, getErr := cache.Get(ctx, "stale")
		if getErr != nil {
			t.Fatalf("Get() returned error: %v", getErr)
		}
		if string(current) == `{"version":2}` {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("cache did not refresh in background, last value %q", string(current))
		}
		time.Sleep(10 * time.Millisecond)
	}

	if got := fetchCalls.Load(); got != 2 {
		t.Fatalf("expected 2 fetch calls after background refresh, got %d", got)
	}
}

func TestApplyTTLJitterStaysWithinExpectedBounds(t *testing.T) {
	t.Parallel()

	baseTTL := 10 * time.Second
	for i := 0; i < 100; i++ {
		jittered := applyTTLJitter(baseTTL, 0.25)
		if jittered < 7500*time.Millisecond || jittered > baseTTL {
			t.Fatalf("jittered TTL %s outside expected range", jittered)
		}
	}
	if got := applyTTLJitter(baseTTL, 0); got != baseTTL {
		t.Fatalf("expected unchanged TTL when fraction is zero, got %s", got)
	}
}

func TestStatsCountersIncrementCorrectly(t *testing.T) {
	t.Parallel()

	c, server := newTestCache(t)
	ctx := context.Background()

	fetchCalls := 0
	fetch := func(context.Context) ([]byte, error) {
		fetchCalls++
		return []byte(`{"n":1}`), nil
	}

	// Miss → fetch
	_, err := c.GetOrFetchBytesWithOptions(ctx, "stats-key", FetchOptions{TTL: time.Minute}, fetch)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}

	s := c.Stats()
	if s.Misses != 1 {
		t.Fatalf("expected 1 miss, got %d", s.Misses)
	}

	// Hit from cache
	_, err = c.GetOrFetchBytesWithOptions(ctx, "stats-key", FetchOptions{TTL: time.Minute}, fetch)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}

	s = c.Stats()
	if s.Hits != 1 {
		t.Fatalf("expected 1 hit, got %d", s.Hits)
	}
	if fetchCalls != 1 {
		t.Fatalf("expected fetch called once, got %d", fetchCalls)
	}

	// Stale hit path: short TTL, longer stale TTL
	staleFetchCalls := 0
	staleFetch := func(context.Context) ([]byte, error) {
		staleFetchCalls++
		return []byte(`{"stale":true}`), nil
	}

	_, err = c.GetOrFetchBytesWithOptions(ctx, "stale-stats", FetchOptions{
		TTL:                      time.Second,
		StaleTTL:                 10 * time.Second,
		BackgroundRefreshTimeout: time.Second,
	}, staleFetch)
	if err != nil {
		t.Fatalf("stale initial: %v", err)
	}

	// Expire primary TTL but keep stale
	server.FastForward(2 * time.Second)

	_, err = c.GetOrFetchBytesWithOptions(ctx, "stale-stats", FetchOptions{
		TTL:                      time.Second,
		StaleTTL:                 10 * time.Second,
		BackgroundRefreshTimeout: time.Second,
	}, staleFetch)
	if err != nil {
		t.Fatalf("stale read: %v", err)
	}

	s = c.Stats()
	if s.StaleHits < 1 {
		t.Fatalf("expected at least 1 stale hit, got %d", s.StaleHits)
	}
}

func TestSmoothOptionsEnablesStaleAndJitter(t *testing.T) {
	t.Parallel()

	opts := SmoothOptions(30 * time.Second)
	if opts.TTL != 30*time.Second {
		t.Errorf("TTL: got %s want 30s", opts.TTL)
	}
	if opts.StaleTTL != 2*time.Minute {
		t.Errorf("StaleTTL: got %s want 2m (ttl*4)", opts.StaleTTL)
	}
	if opts.JitterFraction != 0.15 {
		t.Errorf("JitterFraction: got %v want 0.15", opts.JitterFraction)
	}
	if opts.BackgroundRefreshTimeout != 3*time.Second {
		t.Errorf("BackgroundRefreshTimeout: got %s want 3s", opts.BackgroundRefreshTimeout)
	}
	if !opts.useStale() {
		t.Error("SmoothOptions should enable stale-while-revalidate")
	}
}

func TestGetOrFetchSmoothServesStaleWhileRevalidating(t *testing.T) {
	t.Parallel()

	c, server := newTestCache(t)
	ctx := context.Background()

	var fetchCalls atomic.Int32
	refreshed := make(chan struct{}, 1)
	fetch := func() (any, error) {
		call := fetchCalls.Add(1)
		if call == 1 {
			return map[string]any{"version": 1}, nil
		}
		refreshed <- struct{}{}
		return map[string]any{"version": 2}, nil
	}

	// Prime the cache (TTL 1s, stale window 4s via SmoothOptions).
	if _, err := c.GetOrFetchSmooth(ctx, "smooth", time.Second, fetch); err != nil {
		t.Fatalf("first GetOrFetchSmooth: %v", err)
	}

	// Past the fresh TTL but within the stale window: must serve stale instantly
	// and kick off a background refresh rather than block on the upstream.
	server.FastForward(2 * time.Second)
	stale, err := c.GetOrFetchSmooth(ctx, "smooth", time.Second, fetch)
	if err != nil {
		t.Fatalf("stale GetOrFetchSmooth: %v", err)
	}
	if string(stale) != `{"version":1}` {
		t.Fatalf("expected stale version 1, got %q", string(stale))
	}

	select {
	case <-refreshed:
	case <-time.After(time.Second):
		t.Fatal("background refresh did not start")
	}
	if got := fetchCalls.Load(); got != 2 {
		t.Fatalf("expected 2 fetch calls (initial + background), got %d", got)
	}
}
