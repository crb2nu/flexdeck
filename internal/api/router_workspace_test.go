package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestWorkspaceReposRouteUsesAuthGroup(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "services", "api"), 0o755); err != nil {
		t.Fatalf("failed to create service dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "services", "api", "go.mod"), []byte("module example.com/api\n"), 0o644); err != nil {
		t.Fatalf("failed to write go.mod: %v", err)
	}

	cfg := &config.Config{
		AllowedOrigins: []string{"*"},
		StaticDir:      t.TempDir(),
		WorkspaceDir:   root,
		Token:          "workspace-secret",
		TokenCookie:    "flexdeck_token",
		TokenCookieTTL: 24 * time.Hour,
		K8s: config.K8sConfig{
			Disabled: true,
		},
		RBAC: config.RBACConfig{
			Disabled: true,
		},
		Audit: config.AuditConfig{
			Disabled: true,
		},
		MultiCluster: config.MultiClusterConfig{
			Disabled: true,
		},
	}

	router := NewRouterWithDeps(cfg, nil, nil, nil, nil)
	assertWorkspaceRouteStatus(t, router, "", http.StatusUnauthorized)
	assertWorkspaceRouteStatus(t, router, "Bearer workspace-secret", http.StatusOK)
}

func assertWorkspaceRouteStatus(t *testing.T, router http.Handler, authHeader string, want int) {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, "/api/workspace/repos", nil)
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("workspace route status = %d, want %d; body: %s", rec.Code, want, rec.Body.String())
	}
	if want == http.StatusOK && !strings.Contains(rec.Body.String(), `"repositories"`) {
		t.Fatalf("expected inventory response, got %s", rec.Body.String())
	}
}
