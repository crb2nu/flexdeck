package agents

import (
	"sync"
	"testing"
	"time"
)

func TestHUDPushStore_StoreAndGet(t *testing.T) {
	store := NewHUDPushStore(5 * time.Second)

	agents := []PresenceInfo{
		{AgentID: "claude-code", Status: "active", AgentType: "claude-code"},
	}
	sessions := []SessionInfo{
		{ID: "sess-1", AgentID: "claude-code", Status: "active"},
	}

	store.Store(agents, sessions)

	// GetPresence should return fresh data.
	resp, ok := store.GetPresence()
	if !ok {
		t.Fatal("expected GetPresence to return fresh data")
	}
	if len(resp.Agents) != 1 {
		t.Fatalf("expected 1 agent, got %d", len(resp.Agents))
	}
	if resp.Agents[0].AgentID != "claude-code" {
		t.Errorf("expected agent_id claude-code, got %s", resp.Agents[0].AgentID)
	}

	// GetSessions should return fresh data.
	sessResp, ok := store.GetSessions()
	if !ok {
		t.Fatal("expected GetSessions to return fresh data")
	}
	if len(sessResp.Sessions) != 1 {
		t.Fatalf("expected 1 session, got %d", len(sessResp.Sessions))
	}
}

func TestHUDPushStore_TTLExpiry(t *testing.T) {
	store := NewHUDPushStore(10 * time.Millisecond)

	store.Store(
		[]PresenceInfo{{AgentID: "test"}},
		[]SessionInfo{{ID: "s1"}},
	)

	// Data should be fresh immediately.
	if _, ok := store.GetPresence(); !ok {
		t.Fatal("expected fresh data immediately after store")
	}

	// Wait for TTL to expire.
	time.Sleep(20 * time.Millisecond)

	if _, ok := store.GetPresence(); ok {
		t.Fatal("expected expired data after TTL")
	}
	if _, ok := store.GetSessions(); ok {
		t.Fatal("expected expired sessions after TTL")
	}
}

func TestHUDPushStore_EmptyBeforeFirstStore(t *testing.T) {
	store := NewHUDPushStore(5 * time.Second)

	if _, ok := store.GetPresence(); ok {
		t.Fatal("expected no data before first Store")
	}
	if _, ok := store.GetSessions(); ok {
		t.Fatal("expected no session data before first Store")
	}
}

func TestHUDPushStore_ConcurrentAccess(t *testing.T) {
	store := NewHUDPushStore(5 * time.Second)

	var wg sync.WaitGroup
	const goroutines = 50

	// Concurrent writers.
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			store.Store(
				[]PresenceInfo{{AgentID: "agent"}},
				[]SessionInfo{{ID: "sess"}},
			)
		}()
	}

	// Concurrent readers.
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			store.GetPresence()
			store.GetSessions()
		}()
	}

	wg.Wait()
}

func TestHUDPushStore_OverwritesPreviousData(t *testing.T) {
	store := NewHUDPushStore(5 * time.Second)

	store.Store(
		[]PresenceInfo{{AgentID: "first"}},
		nil,
	)
	store.Store(
		[]PresenceInfo{{AgentID: "second"}},
		nil,
	)

	resp, ok := store.GetPresence()
	if !ok {
		t.Fatal("expected data")
	}
	if len(resp.Agents) != 1 || resp.Agents[0].AgentID != "second" {
		t.Errorf("expected overwritten data with agent 'second', got %v", resp.Agents)
	}
}
