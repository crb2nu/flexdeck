package cluster

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestRegistry(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "cluster-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	regPath := filepath.Join(tempDir, "clusters.json")
	cfg := config.MultiClusterConfig{RegistryPath: regPath}
	defaultK8s := config.K8sConfig{Disabled: true}

	r, err := NewRegistry(cfg, defaultK8s)
	if err != nil {
		t.Fatalf("failed to create registry: %v", err)
	}

	// Test Create
	c1 := &ClusterInfo{Name: "cluster-1", Host: "https://c1.local", Token: "t1"}
	err = r.Create(c1)
	if err != nil {
		t.Fatalf("failed to create cluster: %v", err)
	}

	if c1.ID == "" {
		t.Errorf("expected ID to be set")
	}

	// Test List
	list := r.List()
	if len(list) != 1 {
		t.Errorf("expected 1 cluster, got %d", len(list))
	}
	if list[0].Token != "****" {
		t.Errorf("expected token to be redacted in List(), got %q", list[0].Token)
	}

	// Test Get
	got, err := r.Get(c1.ID)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.Name != "cluster-1" {
		t.Errorf("expected name cluster-1, got %q", got.Name)
	}
	if got.Token != "****" {
		t.Errorf("expected token to be redacted in Get(), got %q", got.Token)
	}

	// Test GetRaw
	raw, err := r.GetRaw(c1.ID)
	if err != nil {
		t.Fatalf("GetRaw failed: %v", err)
	}
	if raw.Token != "t1" {
		t.Errorf("expected token t1, got %q", raw.Token)
	}

	// Test Update
	c1.Name = "updated-1"
	err = r.Update(c1)
	if err != nil {
		t.Fatalf("Update failed: %v", err)
	}

	got, _ = r.Get(c1.ID)
	if got.Name != "updated-1" {
		t.Errorf("expected name updated-1, got %q", got.Name)
	}

	// Test SetDefault
	err = r.SetDefault(c1.ID)
	if err != nil {
		t.Fatalf("SetDefault failed: %v", err)
	}
	def := r.GetDefault()
	if def == nil || def.ID != c1.ID {
		t.Errorf("expected default cluster to be %s", c1.ID)
	}

	// Test Delete
	err = r.Delete(c1.ID)
	if err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if len(r.List()) != 0 {
		t.Errorf("expected 0 clusters after delete")
	}
}

func TestRegistry_AutoRegister(t *testing.T) {
	tempDir, _ := os.MkdirTemp("", "cluster-auto-*")
	defer os.RemoveAll(tempDir)

	regPath := filepath.Join(tempDir, "clusters.json")
	cfg := config.MultiClusterConfig{RegistryPath: regPath}
	defaultK8s := config.K8sConfig{
		Disabled: false,
		Host:     "https://k8s.local",
		Token:    "secret",
	}

	r, err := NewRegistry(cfg, defaultK8s)
	if err != nil {
		t.Fatalf("NewRegistry failed: %v", err)
	}

	list := r.List()
	if len(list) != 1 {
		t.Fatalf("expected 1 auto-registered cluster, got %d", len(list))
	}

	if list[0].Name != "default" || list[0].Host != "https://k8s.local" {
		t.Errorf("unexpected auto-registered cluster data: %+v", list[0])
	}
}
