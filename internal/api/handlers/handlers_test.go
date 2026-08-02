package handlers

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/flexinfer/flexdeck/internal/cache"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/metrics"
)

func TestNewWithDepsUsesInjectedCacheWithoutMetricsStore(t *testing.T) {
	t.Parallel()

	server, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	defer server.Close()

	client, err := cache.NewRedisClient(config.RedisConfig{URL: "redis://" + server.Addr()})
	if err != nil {
		t.Fatalf("failed to create redis client: %v", err)
	}
	defer func() { _ = client.Close() }()

	injectedCache := cache.New(client, "flexdeck:test:")
	handler := NewWithDeps(&config.Config{}, nil, nil, nil, &HandlerDeps{Cache: injectedCache})

	if handler.cache != injectedCache {
		t.Fatal("expected handler to use injected cache")
	}
}

func TestNewWithDepsFallsBackToMetricsStoreCache(t *testing.T) {
	t.Parallel()

	server, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	defer server.Close()

	client, err := cache.NewRedisClient(config.RedisConfig{URL: "redis://" + server.Addr()})
	if err != nil {
		t.Fatalf("failed to create redis client: %v", err)
	}
	defer func() { _ = client.Close() }()

	handler := NewWithDeps(&config.Config{}, nil, nil, metrics.NewStoreWithClient(client), nil)

	if handler.cache == nil {
		t.Fatal("expected handler cache to be initialized from metrics store")
	}
}

func TestNewWithDepsPublicOnlySkipsPrivateClients(t *testing.T) {
	t.Parallel()

	handler := NewWithDeps(&config.Config{
		PublicAPIOnly: true,
		Qdrant:        config.QdrantConfig{URL: "http://qdrant.internal", APIKey: "secret"},
		Mills:         config.MillsConfig{URL: "http://mills.internal", AdminToken: "secret"},
		Flightdeck:    config.FlightdeckConfig{URL: "http://flightdeck.internal", Token: "secret"},
	}, nil, nil, nil, nil)

	if handler.qdrant != nil || handler.millsClient != nil || handler.flightdeckClient != nil {
		t.Fatal("public-only handler must not initialize private upstream clients")
	}
	if handler.gitlabClient == nil {
		t.Fatal("public-only handler still needs the public CI HTTP client")
	}
}
