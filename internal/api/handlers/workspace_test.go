package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/workspace"
)

func TestWorkspaceReposReturnsInventory(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	writeWorkspaceFile(t, filepath.Join(root, "services", "api", "go.mod"), "module example.com/api\n")
	writeWorkspaceFile(t, filepath.Join(root, "libs", "ui", "package.json"), `{"name":"ui"}`)

	handler := &Handler{cfg: &config.Config{WorkspaceDir: root}}
	req := httptest.NewRequest(http.MethodGet, "/api/workspace/repos", nil)
	rec := httptest.NewRecorder()

	handler.WorkspaceRepos(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var inv workspace.Inventory
	if err := json.Unmarshal(rec.Body.Bytes(), &inv); err != nil {
		t.Fatalf("response is not inventory JSON: %v", err)
	}
	if inv.Totals.Repositories != 2 || inv.Totals.Services != 1 || inv.Totals.Libs != 1 {
		t.Fatalf("unexpected totals: %#v", inv.Totals)
	}
}

func TestWorkspaceReposReturnsUnavailableForMissingRoot(t *testing.T) {
	t.Parallel()

	handler := &Handler{cfg: &config.Config{WorkspaceDir: filepath.Join(t.TempDir(), "missing")}}
	req := httptest.NewRequest(http.MethodGet, "/api/workspace/repos", nil)
	rec := httptest.NewRecorder()

	handler.WorkspaceRepos(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected status 503, got %d: %s", rec.Code, rec.Body.String())
	}
}

func writeWorkspaceFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("failed to create parent dir for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write %s: %v", path, err)
	}
}
