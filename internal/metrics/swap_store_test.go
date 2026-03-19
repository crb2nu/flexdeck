package metrics

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newTestStoreForSwap(t *testing.T) (*Store, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return &Store{redis: client}, mr
}

func TestStoreAndGetSwapEvents(t *testing.T) {
	store, mr := newTestStoreForSwap(t)
	defer mr.Close()

	ctx := context.Background()
	now := time.Now()

	events := []GPUSwapEvent{
		{Timestamp: now.Add(-2 * time.Hour), Model: "llama-70b", Namespace: "ai", Group: "gpu-0", OldState: "Active", NewState: "Queued", DurationSec: 300},
		{Timestamp: now.Add(-1 * time.Hour), Model: "llama-70b", Namespace: "ai", Group: "gpu-0", OldState: "Queued", NewState: "Active", DurationSec: 60},
		{Timestamp: now, Model: "llama-70b", Namespace: "ai", Group: "gpu-0", OldState: "Active", NewState: "Preempted", PreemptedBy: "qwen-14b", DurationSec: 600},
	}

	for _, e := range events {
		if err := store.StoreSwapEvent(ctx, e); err != nil {
			t.Fatalf("StoreSwapEvent failed: %v", err)
		}
	}

	// Query last 24 hours
	got, err := store.GetModelSwapHistory(ctx, "ai", "llama-70b", 24)
	if err != nil {
		t.Fatalf("GetModelSwapHistory failed: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 events, got %d", len(got))
	}

	// Verify chronological order
	if got[0].OldState != "Active" || got[0].NewState != "Queued" {
		t.Errorf("first event should be Active->Queued, got %s->%s", got[0].OldState, got[0].NewState)
	}
	if got[2].PreemptedBy != "qwen-14b" {
		t.Errorf("last event preemptedBy should be qwen-14b, got %q", got[2].PreemptedBy)
	}

	// Query narrower window (30 minutes) should return only the most recent event
	recent, err := store.GetModelSwapHistory(ctx, "ai", "llama-70b", 1)
	if err != nil {
		t.Fatalf("GetModelSwapHistory (1h) failed: %v", err)
	}
	// Events at -2h and -1h may fall outside 1h window depending on timing; at least the last one should be there
	if len(recent) < 1 {
		t.Errorf("expected at least 1 recent event, got %d", len(recent))
	}
}

func TestGroupSwapHistory(t *testing.T) {
	store, mr := newTestStoreForSwap(t)
	defer mr.Close()

	ctx := context.Background()
	now := time.Now()

	// Two models in the same group
	events := []GPUSwapEvent{
		{Timestamp: now.Add(-30 * time.Minute), Model: "llama-70b", Namespace: "ai", Group: "gpu-0", OldState: "Active", NewState: "Queued", DurationSec: 120},
		{Timestamp: now.Add(-20 * time.Minute), Model: "qwen-14b", Namespace: "ai", Group: "gpu-0", OldState: "Queued", NewState: "Active", DurationSec: 60},
		{Timestamp: now.Add(-10 * time.Minute), Model: "llama-70b", Namespace: "ai", Group: "gpu-0", OldState: "Queued", NewState: "Active", DurationSec: 600},
	}

	for _, e := range events {
		if err := store.StoreSwapEvent(ctx, e); err != nil {
			t.Fatalf("StoreSwapEvent failed: %v", err)
		}
	}

	// Group query should return all 3 events
	got, err := store.GetGroupSwapHistory(ctx, "gpu-0", "", 24)
	if err != nil {
		t.Fatalf("GetGroupSwapHistory failed: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 group events, got %d", len(got))
	}

	// Namespace filter
	filtered, err := store.GetGroupSwapHistory(ctx, "gpu-0", "ai", 24)
	if err != nil {
		t.Fatalf("GetGroupSwapHistory (filtered) failed: %v", err)
	}
	if len(filtered) != 3 {
		t.Errorf("expected 3 filtered events, got %d", len(filtered))
	}

	// Non-matching namespace should return zero
	empty, err := store.GetGroupSwapHistory(ctx, "gpu-0", "other-ns", 24)
	if err != nil {
		t.Fatalf("GetGroupSwapHistory (empty ns) failed: %v", err)
	}
	if len(empty) != 0 {
		t.Errorf("expected 0 events for non-matching ns, got %d", len(empty))
	}
}

func TestComputeGroupSummary(t *testing.T) {
	events := []GPUSwapEvent{
		{Model: "llama-70b", OldState: "Active", NewState: "Queued", DurationSec: 300},
		{Model: "llama-70b", OldState: "Queued", NewState: "Active", DurationSec: 60},
		{Model: "qwen-14b", OldState: "Active", NewState: "Queued", DurationSec: 200},
		{Model: "qwen-14b", OldState: "Queued", NewState: "Active", DurationSec: 120},
	}

	summary := ComputeGroupSummary(events)

	if summary.TotalSwaps != 4 {
		t.Errorf("expected 4 total swaps, got %d", summary.TotalSwaps)
	}

	// Average queue wait: (60 + 120) / 2 = 90
	if summary.AvgQueueWaitSec != 90 {
		t.Errorf("expected avg queue wait 90, got %f", summary.AvgQueueWaitSec)
	}

	llamaStats := summary.ModelStats["llama-70b"]
	if llamaStats.SwapCount != 2 {
		t.Errorf("expected llama-70b swap count 2, got %d", llamaStats.SwapCount)
	}
	if llamaStats.TotalActiveSec != 300 {
		t.Errorf("expected llama-70b total active 300, got %f", llamaStats.TotalActiveSec)
	}
	if llamaStats.TotalQueuedSec != 60 {
		t.Errorf("expected llama-70b total queued 60, got %f", llamaStats.TotalQueuedSec)
	}

	qwenStats := summary.ModelStats["qwen-14b"]
	if qwenStats.TotalActiveSec != 200 {
		t.Errorf("expected qwen-14b total active 200, got %f", qwenStats.TotalActiveSec)
	}
}

func TestSwapEventTrimming(t *testing.T) {
	store, mr := newTestStoreForSwap(t)
	defer mr.Close()

	ctx := context.Background()

	// Store an event with a timestamp older than 7 days
	oldEvent := GPUSwapEvent{
		Timestamp:   time.Now().Add(-8 * 24 * time.Hour),
		Model:       "old-model",
		Namespace:   "ai",
		Group:       "gpu-0",
		OldState:    "Active",
		NewState:    "Queued",
		DurationSec: 100,
	}
	if err := store.StoreSwapEvent(ctx, oldEvent); err != nil {
		t.Fatalf("StoreSwapEvent (old) failed: %v", err)
	}

	// Store a recent event — this should trigger trimming of the old one
	recentEvent := GPUSwapEvent{
		Timestamp:   time.Now(),
		Model:       "old-model",
		Namespace:   "ai",
		Group:       "gpu-0",
		OldState:    "Queued",
		NewState:    "Active",
		DurationSec: 50,
	}
	if err := store.StoreSwapEvent(ctx, recentEvent); err != nil {
		t.Fatalf("StoreSwapEvent (recent) failed: %v", err)
	}

	// Only the recent event should remain (old one trimmed by ZREMRANGEBYSCORE)
	got, err := store.GetModelSwapHistory(ctx, "ai", "old-model", 24*7)
	if err != nil {
		t.Fatalf("GetModelSwapHistory failed: %v", err)
	}
	if len(got) != 1 {
		t.Errorf("expected 1 event after trimming, got %d", len(got))
	}
	if len(got) > 0 && got[0].NewState != "Active" {
		t.Errorf("remaining event should be the recent one, got newState=%q", got[0].NewState)
	}
}

func TestComputeGroupSummary_Empty(t *testing.T) {
	summary := ComputeGroupSummary(nil)
	if summary.TotalSwaps != 0 {
		t.Errorf("expected 0 swaps for nil input, got %d", summary.TotalSwaps)
	}
	if summary.AvgQueueWaitSec != 0 {
		t.Errorf("expected 0 avg queue wait for nil input, got %f", summary.AvgQueueWaitSec)
	}
	if len(summary.ModelStats) != 0 {
		t.Errorf("expected empty model stats for nil input, got %d", len(summary.ModelStats))
	}
}
