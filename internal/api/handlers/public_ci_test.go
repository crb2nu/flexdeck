package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/flexinfer/flexdeck/internal/cache"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/metrics"
	"github.com/redis/go-redis/v9"
)

func TestPublicCIStatusUsesMetricsStoreBeforeLiveGitLab(t *testing.T) {
	redisServer, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	defer redisServer.Close()

	client := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { _ = client.Close() })

	store := metrics.NewStoreWithClient(client)
	sharedCache := cache.New(client, "flexdeck:")
	ctx := context.Background()
	createdAt := time.Date(2026, 5, 18, 14, 0, 0, 0, time.UTC)

	store.StoreProjectNames(ctx, map[string]interface{}{
		"42": "services/flexinfer-site",
	})
	if err := store.StorePipelineRun(ctx, metrics.PipelineRun{
		PipelineID: 9001,
		ProjectID:  42,
		Ref:        "main",
		Status:     "success",
		Duration:   12.5,
		CreatedAt:  createdAt,
		Stages: []metrics.StageRun{
			{Name: "build", Status: "success", Duration: 4.5},
			{Name: "test", Status: "success", Duration: 8},
		},
	}); err != nil {
		t.Fatalf("failed to seed pipeline run: %v", err)
	}

	handler := &Handler{
		cfg:          &config.Config{},
		metricsStore: store,
		cache:        sharedCache,
	}

	req := httptest.NewRequest(http.MethodGet, "/api/public/ci/status", nil)
	rr := httptest.NewRecorder()
	handler.PublicCIStatus(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rr.Code, rr.Body.String())
	}

	var body PublicCIResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if body.Source != "live" || len(body.Pipelines) != 1 {
		t.Fatalf("unexpected response: %+v", body)
	}
	pipeline := body.Pipelines[0]
	if pipeline.ID != "9001" || pipeline.Project != "flexinfer-site" {
		t.Fatalf("unexpected pipeline identity: %+v", pipeline)
	}
	if pipeline.Visibility != "internal" {
		t.Fatalf("expected internal visibility for scraped store data, got %q", pipeline.Visibility)
	}
	if len(pipeline.Stages) != 2 || len(pipeline.Stages[0].Jobs) != 1 {
		t.Fatalf("expected aggregate stage jobs, got %+v", pipeline.Stages)
	}

	if cached, err := sharedCache.Get(ctx, "ci:status:public"); err != nil || len(cached) == 0 {
		t.Fatalf("expected public CI response to be cached, bytes=%d err=%v", len(cached), err)
	}
}
