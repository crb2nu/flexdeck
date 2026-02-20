package cache

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
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
