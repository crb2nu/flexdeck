package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/flexinfer/flexdeck/internal/api/handlers"
	"github.com/flexinfer/flexdeck/internal/audit"
	"github.com/flexinfer/flexdeck/internal/cluster"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/rbac"
)

const phase4AdminToken = "phase4-admin-secret"

func TestRouter_Phase4RoutesRegisterWhenEnabled(t *testing.T) {
	t.Parallel()

	router := newPhase4Router(t, false)

	assertHealthFeatures(t, router, map[string]bool{
		"rbac":          true,
		"audit":         true,
		"multi_cluster": true,
	})

	assertAuthenticatedStatus(t, router, http.MethodGet, "/api/rbac/me", http.StatusOK)
	assertAuthenticatedStatus(t, router, http.MethodGet, "/api/rbac/roles", http.StatusOK)
	assertAuthenticatedStatus(t, router, http.MethodGet, "/api/audit/stats", http.StatusOK)
	assertAuthenticatedStatus(t, router, http.MethodGet, "/api/clusters/", http.StatusOK)
}

func TestRouter_Phase4RoutesStayUnavailableWhenDisabled(t *testing.T) {
	t.Parallel()

	router := newPhase4Router(t, true)

	assertHealthFeatures(t, router, map[string]bool{
		"rbac":          false,
		"audit":         false,
		"multi_cluster": false,
	})

	assertStatus(t, router, http.MethodGet, "/api/rbac/me", http.StatusNotFound)
	assertStatus(t, router, http.MethodGet, "/api/rbac/roles", http.StatusNotFound)
	assertStatus(t, router, http.MethodGet, "/api/audit/stats", http.StatusNotFound)
	assertStatus(t, router, http.MethodGet, "/api/clusters/", http.StatusNotFound)
}

func newPhase4Router(t *testing.T, disabled bool) http.Handler {
	t.Helper()

	tempDir := t.TempDir()
	cfg := &config.Config{
		AllowedOrigins: []string{"*"},
		StaticDir:      tempDir,
		TokenCookie:    "flexdeck_token",
		TokenCookieTTL: 24 * time.Hour,
		K8s: config.K8sConfig{
			Disabled: true,
		},
		RBAC: config.RBACConfig{
			Disabled:   disabled,
			UsersPath:  filepath.Join(tempDir, "users.json"),
			AdminToken: phase4AdminToken,
		},
		Audit: config.AuditConfig{
			Disabled: disabled,
			TTLDays:  7,
		},
		MultiCluster: config.MultiClusterConfig{
			Disabled:     disabled,
			RegistryPath: filepath.Join(tempDir, "clusters.json"),
		},
	}

	if disabled {
		return NewRouterWithDeps(cfg, nil, nil, nil, nil)
	}

	rbacRegistry, err := rbac.NewRegistry(cfg.RBAC)
	if err != nil {
		t.Fatalf("failed to create RBAC registry: %v", err)
	}

	redisServer, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start Redis test server: %v", err)
	}
	t.Cleanup(redisServer.Close)

	redisClient := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() {
		_ = redisClient.Close()
	})

	clusterRegistry, err := cluster.NewRegistry(cfg.MultiCluster, cfg.K8s)
	if err != nil {
		t.Fatalf("failed to create cluster registry: %v", err)
	}

	deps := &handlers.HandlerDeps{
		RBACRegistry:    rbacRegistry,
		AuditStore:      audit.NewStore(redisClient, cfg.Audit.TTLDays),
		ClusterRegistry: clusterRegistry,
		ClusterManager:  cluster.NewManager(clusterRegistry),
	}

	return NewRouterWithDeps(cfg, nil, nil, nil, deps)
}

func assertHealthFeatures(t *testing.T, router http.Handler, want map[string]bool) {
	t.Helper()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("health status = %d, want %d", rec.Code, http.StatusOK)
	}

	var payload struct {
		Features map[string]struct {
			Enabled bool `json:"enabled"`
		} `json:"features"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("health response is not valid JSON: %v", err)
	}

	for feature, enabled := range want {
		got, ok := payload.Features[feature]
		if !ok {
			t.Fatalf("health response missing %q feature: %#v", feature, payload.Features)
		}
		if got.Enabled != enabled {
			t.Fatalf("health feature %q enabled = %v, want %v", feature, got.Enabled, enabled)
		}
	}
}

func assertAuthenticatedStatus(t *testing.T, router http.Handler, method string, path string, want int) {
	t.Helper()

	req := httptest.NewRequest(method, path, nil)
	req.Header.Set("Authorization", "Bearer "+phase4AdminToken)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s %s status = %d, want %d; body: %s", method, path, rec.Code, want, rec.Body.String())
	}
}

func assertStatus(t *testing.T, router http.Handler, method string, path string, want int) {
	t.Helper()

	req := httptest.NewRequest(method, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != want {
		t.Fatalf("%s %s status = %d, want %d; body: %s", method, path, rec.Code, want, rec.Body.String())
	}
}
