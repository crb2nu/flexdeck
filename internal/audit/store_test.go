package audit

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestStore_RecordQuery(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := NewStore(client, 1)

	ctx := context.Background()
	entry := Entry{
		Action:     "test-action",
		Method:     "POST",
		Path:       "/api/test",
		Status:     200,
		UserID:     "user-1",
		Username:   "testuser",
	}

	err := store.Record(ctx, entry)
	if err != nil {
		t.Fatalf("failed to record entry: %v", err)
	}

	// Query entries
	entries, total, err := store.Query(ctx, QueryOpts{})
	if err != nil {
		t.Fatalf("failed to query entries: %v", err)
	}

	if total != 1 {
		t.Errorf("expected 1 entry, got %d", total)
	}

	if len(entries) != 1 {
		t.Fatalf("expected 1 entry in list, got %d", len(entries))
	}

	if entries[0].Action != "test-action" || entries[0].Username != "testuser" {
		t.Errorf("unexpected entry data: %+v", entries[0])
	}

	// Test filters
	entries, _, _ = store.Query(ctx, QueryOpts{Action: "other"})
	if len(entries) != 0 {
		t.Errorf("expected 0 entries for mismatched action filter")
	}

	entries, _, _ = store.Query(ctx, QueryOpts{UserID: "user-1"})
	if len(entries) != 1 {
		t.Errorf("expected 1 entry for matching user filter")
	}
}

func TestStore_Stats(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	store := NewStore(client, 7)

	ctx := context.Background()
	_ = store.Record(ctx, Entry{Action: "create", Username: "alice"})
	_ = store.Record(ctx, Entry{Action: "delete", Username: "alice"})
	_ = store.Record(ctx, Entry{Action: "create", Username: "bob"})

	stats, err := store.Stats(ctx)
	if err != nil {
		t.Fatalf("failed to get stats: %v", err)
	}

	if stats["total"].(int64) != 3 {
		t.Errorf("expected total 3, got %v", stats["total"])
	}

	byAction := stats["byAction"].(map[string]int)
	if byAction["create"] != 2 || byAction["delete"] != 1 {
		t.Errorf("unexpected byAction stats: %+v", byAction)
	}

	byUser := stats["byUser"].(map[string]int)
	if byUser["alice"] != 2 || byUser["bob"] != 1 {
		t.Errorf("unexpected byUser stats: %+v", byUser)
	}
}
