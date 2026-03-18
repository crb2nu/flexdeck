package metrics

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/flexinfer/flexdeck/internal/litellm"
	"github.com/redis/go-redis/v9"
)

func TestMaterializer_RefreshesBothSummaryKeys(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := NewStoreWithClient(client)
	ctx := context.Background()

	// Seed throughput data: need at least 2 points separated in time.
	m1 := litellm.ModelMetrics{
		Model: "test-model", TotalTokens: 1000, OutputTokens: 400,
		InputTokens: 600, RequestCount: 10, TotalLatencyMs: 500,
	}
	m2 := litellm.ModelMetrics{
		Model: "test-model", TotalTokens: 2000, OutputTokens: 800,
		InputTokens: 1200, RequestCount: 20, TotalLatencyMs: 600,
	}
	if err := store.StoreMetrics(ctx, []litellm.ModelMetrics{m1}); err != nil {
		t.Fatalf("StoreMetrics(1): %v", err)
	}
	time.Sleep(1 * time.Second)
	if err := store.StoreMetrics(ctx, []litellm.ModelMetrics{m2}); err != nil {
		t.Fatalf("StoreMetrics(2): %v", err)
	}

	// Seed pipeline data.
	now := time.Now()
	run := PipelineRun{
		PipelineID: 1, ProjectID: 99,
		Status: "success", Duration: 60, CreatedAt: now,
	}
	if err := store.StorePipelineRun(ctx, run); err != nil {
		t.Fatalf("StorePipelineRun: %v", err)
	}

	// Delete both summary keys to simulate expiry.
	client.Del(ctx, throughputSummaryKey)
	client.Del(ctx, pipelineAllTrendsSummary)

	if client.Exists(ctx, throughputSummaryKey).Val() != 0 {
		t.Fatal("throughput key should be absent before materializer run")
	}
	if client.Exists(ctx, pipelineAllTrendsSummary).Val() != 0 {
		t.Fatal("pipeline trends key should be absent before materializer run")
	}

	// Run the materializer's refresh directly (no goroutine needed).
	store.MaterializeThroughput(ctx)
	store.MaterializeAllPipelineTrends(ctx)

	if client.Exists(ctx, throughputSummaryKey).Val() != 1 {
		t.Fatal("expected throughput summary key to exist after materializer refresh")
	}
	if client.Exists(ctx, pipelineAllTrendsSummary).Val() != 1 {
		t.Fatal("expected pipeline trends key to exist after materializer refresh")
	}
}

func TestMaterializer_StartStop(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := NewStoreWithClient(client)

	m := NewMaterializer(store)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan struct{})
	go func() {
		m.Start(ctx)
		close(done)
	}()

	// Give it a moment to start, then stop gracefully.
	time.Sleep(50 * time.Millisecond)
	m.Stop()

	select {
	case <-done:
		// Success — the goroutine exited.
	case <-time.After(2 * time.Second):
		t.Fatal("materializer did not stop within 2 seconds")
	}
}
