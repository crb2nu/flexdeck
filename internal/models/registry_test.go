package models

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestRegistry(t *testing.T) {
	tempDir, _ := os.MkdirTemp("", "models-test-*")
	defer os.RemoveAll(tempDir)

	regPath := filepath.Join(tempDir, "registry.json")
	cfg := config.ModelsConfig{RegistryPath: regPath}

	r, err := NewRegistry(cfg)
	if err != nil {
		t.Fatalf("NewRegistry failed: %v", err)
	}

	// Test Register
	m1 := &Model{
		ID:     "model-1",
		Name:   "Llama 3",
		Source: SourceHuggingFace,
		Type:   TypeLLM,
	}
	err = r.Register(m1)
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}

	// Test Get
	got, err := r.Get("model-1")
	if err != nil || got.Name != "Llama 3" {
		t.Errorf("Get failed or returned wrong data")
	}

	// Test List
	list := r.List()
	if len(list) != 1 {
		t.Errorf("expected 1 model, got %d", len(list))
	}

	// Test UpdateDownloadStatus
	err = r.UpdateDownloadStatus("model-1", StatusCompleted, 100, "")
	if err != nil {
		t.Fatalf("UpdateDownloadStatus failed: %v", err)
	}
	got, _ = r.Get("model-1")
	if got.DownloadStatus != StatusCompleted || got.DownloadedAt == nil {
		t.Errorf("download status update failed")
	}

	// Test UpdateDeploymentStatus
	err = r.UpdateDeploymentStatus("model-1", DeploymentDeployed, "llama-dep", "ai", 1)
	if err != nil {
		t.Fatalf("UpdateDeploymentStatus failed: %v", err)
	}
	got, _ = r.Get("model-1")
	if got.DeploymentStatus != DeploymentDeployed || got.DeploymentName != "llama-dep" {
		t.Errorf("deployment status update failed")
	}

	// Test FindBySource
	hfModels := r.FindBySource(SourceHuggingFace)
	if len(hfModels) != 1 {
		t.Errorf("expected 1 HF model")
	}

	// Test FindByType
	llmModels := r.FindByType(TypeLLM)
	if len(llmModels) != 1 {
		t.Errorf("expected 1 LLM model")
	}

	// Test Delete
	err = r.Delete("model-1")
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if len(r.List()) != 0 {
		t.Errorf("expected 0 models after delete")
	}
}
