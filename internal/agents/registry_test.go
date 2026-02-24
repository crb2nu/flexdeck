package agents

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestRegistry(t *testing.T) {
	tempDir, _ := os.MkdirTemp("", "agents-test-*")
	defer os.RemoveAll(tempDir)

	regPath := filepath.Join(tempDir, "agents.json")
	cfg := config.AgentsConfig{RegistryPath: regPath}

	r, err := NewRegistry(cfg)
	if err != nil {
		t.Fatalf("NewRegistry failed: %v", err)
	}

	// Test Register
	a1 := &Agent{
		ID:   "agent-1",
		Name: "Test Agent",
		URL:  "http://agent-1.local",
	}
	err = r.Register(a1)
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}

	// Test Get
	got, err := r.Get("agent-1")
	if err != nil || got.Name != "Test Agent" {
		t.Errorf("Get failed")
	}

	// Test List
	list := r.List()
	if len(list) != 1 {
		t.Errorf("expected 1 agent, got %d", len(list))
	}

	// Test RecordUsage / GetUsage
	r.RecordUsage("agent-1", 100, 500)
	usage, err := r.GetUsage("agent-1")
	if err != nil || usage.TotalTokens != 100 || usage.RequestCount != 1 {
		t.Errorf("usage tracking failed")
	}

	// Test CheckHealth
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer ts.Close()

	a1.URL = ts.URL
	_ = r.Update(a1)

	status, err := r.CheckHealth(context.Background(), "agent-1")
	if err != nil || status != AgentStatusHealthy {
		t.Errorf("health check failed: %v, status: %s", err, status)
	}

	// Test Delete
	err = r.Delete("agent-1")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if len(r.List()) != 0 {
		t.Errorf("expected 0 agents after delete")
	}
}
