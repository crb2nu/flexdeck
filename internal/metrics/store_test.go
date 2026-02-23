package metrics

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/flexinfer/flexdeck/internal/litellm"
	"github.com/redis/go-redis/v9"
)

func TestStore_Metrics(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := &Store{redis: client}

	ctx := context.Background()
	now := time.Now()

	model := "gpt-4"
	m1 := litellm.ModelMetrics{
		Model:          model,
		TotalTokens:    1000,
		OutputTokens:   400,
		InputTokens:    600,
		RequestCount:   10,
		TotalLatencyMs: 500,
		Timestamp:      now.Add(-60 * time.Second),
	}
	m2 := litellm.ModelMetrics{
		Model:          model,
		TotalTokens:    2000,
		OutputTokens:   800,
		InputTokens:    1200,
		RequestCount:   20,
		TotalLatencyMs: 600,
		Timestamp:      now,
	}

	// We can't easily mock time.Now() inside StoreMetrics, so we'll just push two points
	// and accept that they might have identical timestamps if we run too fast.
	// But calculateThroughput uses the point's recorded Timestamp (from now.Unix()).
	
	err := store.StoreMetrics(ctx, []litellm.ModelMetrics{m1})
	if err != nil {
		t.Fatalf("StoreMetrics failed: %v", err)
	}
	
	// Wait a bit to ensure different timestamp if needed
	time.Sleep(1 * time.Second)
	
	err = store.StoreMetrics(ctx, []litellm.ModelMetrics{m2})
	if err != nil {
		t.Fatalf("StoreMetrics failed: %v", err)
	}

	throughput, err := store.GetModelThroughput(ctx, model)
	if err != nil {
		t.Fatalf("GetModelThroughput failed: %v", err)
	}

	if throughput.Model != model {
		t.Errorf("expected model %q, got %q", model, throughput.Model)
	}

	if throughput.RequestsPerMin <= 0 {
		t.Errorf("expected positive requests per min, got %f", throughput.RequestsPerMin)
	}

	if throughput.TokPerSec1m <= 0 {
		t.Errorf("expected positive tokens per sec, got %f", throughput.TokPerSec1m)
	}
	
	if throughput.AvgLatencyMs != 600 {
		t.Errorf("expected latency 600, got %f", throughput.AvgLatencyMs)
	}

	// Test List all
	list, err := store.GetThroughput(ctx)
	if err != nil {
		t.Fatalf("GetThroughput failed: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("expected 1 model in list, got %d", len(list))
	}
}

func TestStore_Trend(t *testing.T) {
	store := &Store{}
	
	cases := []struct {
		data []float64
		want string
	}{
		{[]float64{10, 10, 10, 10}, "stable"},
		{[]float64{10, 10, 20, 20}, "up"},
		{[]float64{20, 20, 10, 10}, "down"},
		{[]float64{10, 11}, "stable"}, // too few points
	}

	for _, tc := range cases {
		got := store.detectTrend(tc.data)
		if got != tc.want {
			t.Errorf("detectTrend(%v) = %q, want %q", tc.data, got, tc.want)
		}
	}
}
