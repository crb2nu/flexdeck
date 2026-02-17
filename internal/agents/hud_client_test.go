package agents

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestHUDClientPushOnlyUsesPushStore(t *testing.T) {
	t.Parallel()

	store := NewHUDPushStore(60 * time.Second)
	store.Store(
		[]PresenceInfo{
			{
				AgentID:   "codex-1",
				AgentType: "codex",
				Status:    "active",
			},
		},
		[]SessionInfo{
			{
				ID:        "s-1",
				AgentID:   "codex-1",
				Status:    "active",
				StartedAt: "2026-02-17T15:00:00Z",
			},
		},
	)

	client := NewHUDClient("")
	client.SetPushStore(store)

	presence, err := client.GetPresence(context.Background())
	if err != nil {
		t.Fatalf("expected push-only presence to work, got error: %v", err)
	}
	if len(presence.Agents) != 1 {
		t.Fatalf("expected 1 pushed presence agent, got %d", len(presence.Agents))
	}

	sessions, err := client.GetSessions(context.Background())
	if err != nil {
		t.Fatalf("expected push-only sessions to work, got error: %v", err)
	}
	if len(sessions.Sessions) != 1 {
		t.Fatalf("expected 1 pushed session, got %d", len(sessions.Sessions))
	}

	agentsList, err := client.GetAgents(context.Background())
	if err != nil {
		t.Fatalf("expected push-only GetAgents to work, got error: %v", err)
	}
	if len(agentsList) != 1 {
		t.Fatalf("expected 1 HUD agent, got %d", len(agentsList))
	}
	if agentsList[0].ID != "hud-codex-1" {
		t.Fatalf("unexpected HUD agent ID: %s", agentsList[0].ID)
	}
}

func TestHUDClientWithoutURLOrPushDataReturnsError(t *testing.T) {
	t.Parallel()

	client := NewHUDClient("")

	_, err := client.GetPresence(context.Background())
	if err == nil {
		t.Fatal("expected error when pull URL is empty and no push data is present")
	}
	if !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("unexpected error: %v", err)
	}

	_, err = client.GetSessions(context.Background())
	if err == nil {
		t.Fatal("expected sessions error when pull URL is empty and no push data is present")
	}
	if !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("unexpected error: %v", err)
	}
}
