package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestRouterPublicAPIOnlyHealthIsSanitized(t *testing.T) {
	router := NewRouterWithDeps(&config.Config{
		PublicAPIOnly:  true,
		AllowedOrigins: []string{"*"},
		K8s:            config.K8sConfig{Disabled: true},
		RBAC:           config.RBACConfig{Disabled: true},
	}, nil, nil, nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode public health response: %v", err)
	}
	want := map[string]any{"ok": true, "service": "flexdeck-public"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("public health response = %#v, want sanitized payload %#v", got, want)
	}
}

func TestRouterPublicAPIOnlyRegistersStrictAllowlist(t *testing.T) {
	router := NewRouterWithDeps(&config.Config{
		PublicAPIOnly:  true,
		AllowedOrigins: []string{"*"},
		StaticDir:      t.TempDir(),
		K8s:            config.K8sConfig{Disabled: true},
		RBAC:           config.RBACConfig{Disabled: true},
		Audit:          config.AuditConfig{Disabled: true},
		MultiCluster:   config.MultiClusterConfig{Disabled: true},
	}, nil, nil, nil, nil)

	var got []string
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		got = append(got, fmt.Sprintf("%s %s", method, route))
		return nil
	}); err != nil {
		t.Fatalf("walk public-only router: %v", err)
	}
	sort.Strings(got)

	want := []string{
		"GET /api/health",
		"GET /api/public/benchmarks",
		"GET /api/public/ci/status",
		"GET /api/public/metrics/summary",
		"GET /api/public/models/status",
		"GET /api/public/topology",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("public-only routes = %v, want exact allowlist %v", got, want)
	}
}

func TestRouterPublicAPIOnlyRejectsPrivateSurfaces(t *testing.T) {
	router := NewRouterWithDeps(&config.Config{
		PublicAPIOnly:  true,
		AllowedOrigins: []string{"*"},
		StaticDir:      t.TempDir(),
		K8s:            config.K8sConfig{Disabled: true},
		RBAC:           config.RBACConfig{Disabled: true},
		Audit:          config.AuditConfig{Disabled: true},
		MultiCluster:   config.MultiClusterConfig{Disabled: true},
	}, nil, nil, nil, nil)

	for _, test := range []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodGet, path: "/api/health", want: http.StatusOK},
		{method: http.MethodGet, path: "/api/public/benchmarks", want: http.StatusOK},
		{method: http.MethodGet, path: "/metrics", want: http.StatusNotFound},
		{method: http.MethodGet, path: "/", want: http.StatusNotFound},
		{method: http.MethodGet, path: "/api/dashboard/summary", want: http.StatusNotFound},
		{method: http.MethodGet, path: "/api/k8s/pods", want: http.StatusNotFound},
		{method: http.MethodPost, path: "/api/k8s/deployments/default/app/restart", want: http.StatusNotFound},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			req := httptest.NewRequest(test.method, test.path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != test.want {
				t.Fatalf("status = %d, want %d; body: %s", rec.Code, test.want, rec.Body.String())
			}
		})
	}
}
