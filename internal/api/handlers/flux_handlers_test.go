package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/flexinfer/flexdeck/internal/config"
)

func TestResolveFluxGVR(t *testing.T) {
	cases := []struct {
		kind     string
		ok       bool
		group    string
		version  string
		resource string
	}{
		{"kustomization", true, "kustomize.toolkit.fluxcd.io", "v1", "kustomizations"},
		{"ks", true, "kustomize.toolkit.fluxcd.io", "v1", "kustomizations"},
		{"helmrelease", true, "helm.toolkit.fluxcd.io", "v2", "helmreleases"},
		{"hr", true, "helm.toolkit.fluxcd.io", "v2", "helmreleases"},
		{"gitrepository", true, "source.toolkit.fluxcd.io", "v1", "gitrepositories"},
		{"gitrepo", true, "source.toolkit.fluxcd.io", "v1", "gitrepositories"},
		{"helmrepository", true, "source.toolkit.fluxcd.io", "v1", "helmrepositories"},
		{"helmrepo", true, "source.toolkit.fluxcd.io", "v1", "helmrepositories"},
		{"unknown", false, "", "", ""},
		{"", false, "", "", ""},
	}

	for _, tc := range cases {
		t.Run(tc.kind, func(t *testing.T) {
			gvr, ok := resolveFluxGVR(tc.kind)
			if ok != tc.ok {
				t.Fatalf("kind %q: expected ok=%v, got %v", tc.kind, tc.ok, ok)
			}
			if !tc.ok {
				return
			}
			if gvr.Group != tc.group || gvr.Version != tc.version || gvr.Resource != tc.resource {
				t.Fatalf("kind %q: expected %s/%s/%s, got %s/%s/%s",
					tc.kind, tc.group, tc.version, tc.resource, gvr.Group, gvr.Version, gvr.Resource)
			}
		})
	}
}

func TestExtractFluxStatus(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]any{
		"metadata": map[string]any{"name": "apps", "namespace": "flux-system"},
		"spec": map[string]any{
			"suspend":   true,
			"sourceRef": map[string]any{"kind": "GitRepository", "name": "flux-system", "namespace": "flux-system"},
			"dependsOn": []any{
				map[string]any{"name": "infra"},
				map[string]any{"name": ""}, // skipped
				"not-a-map",                // skipped
			},
		},
		"status": map[string]any{
			"lastAppliedRevision": "main@sha1:abc",
			"conditions": []any{
				map[string]any{"type": "Ready", "status": "True", "message": "Applied revision", "reason": "ReconciliationSucceeded"},
			},
		},
	}}

	st := extractFluxStatus(obj, "kustomization")

	if st.Name != "apps" || st.Namespace != "flux-system" || st.Kind != "kustomization" {
		t.Fatalf("unexpected identity: %+v", st)
	}
	if !st.Suspended {
		t.Error("expected Suspended=true")
	}
	if st.SourceRef == nil || st.SourceRef.Kind != "GitRepository" || st.SourceRef.Name != "flux-system" {
		t.Errorf("unexpected sourceRef: %+v", st.SourceRef)
	}
	if len(st.DependsOn) != 1 || st.DependsOn[0] != "infra" {
		t.Errorf("expected DependsOn=[infra], got %v", st.DependsOn)
	}
	if !st.Ready {
		t.Error("expected Ready=true from Ready/True condition")
	}
	if st.Message != "Applied revision" {
		t.Errorf("expected message from Ready condition, got %q", st.Message)
	}
	if st.LastApplied != "main@sha1:abc" {
		t.Errorf("unexpected lastApplied: %q", st.LastApplied)
	}
	if len(st.Conditions) != 1 {
		t.Errorf("expected 1 condition, got %d", len(st.Conditions))
	}
}

func TestExtractFluxStatus_NotReady(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]any{
		"metadata": map[string]any{"name": "broken", "namespace": "flux-system"},
		"status": map[string]any{
			"conditions": []any{
				map[string]any{"type": "Ready", "status": "False", "message": "build failed"},
			},
		},
	}}

	st := extractFluxStatus(obj, "helmrelease")
	if st.Ready {
		t.Error("expected Ready=false for Ready/False condition")
	}
	if st.Suspended {
		t.Error("expected Suspended=false when spec.suspend absent")
	}
	if st.SourceRef != nil {
		t.Errorf("expected nil sourceRef when absent, got %+v", st.SourceRef)
	}
}

func TestExtractFluxSource(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]any{
		"metadata": map[string]any{"name": "flux-system", "namespace": "flux-system"},
		"spec": map[string]any{
			"url": "https://example.test/repo.git",
			"ref": map[string]any{"branch": "main"},
		},
		"status": map[string]any{
			"artifact": map[string]any{"revision": "main@sha1:def", "lastUpdateTime": "2026-06-01T00:00:00Z"},
			"conditions": []any{
				map[string]any{"type": "Ready", "status": "True"},
			},
		},
	}}

	src := extractFluxSource(obj, "gitrepository")

	if src.Name != "flux-system" || src.Kind != "gitrepository" {
		t.Fatalf("unexpected identity: %+v", src)
	}
	if src.URL != "https://example.test/repo.git" {
		t.Errorf("unexpected url: %q", src.URL)
	}
	if src.Branch != "main" {
		t.Errorf("expected branch=main, got %q", src.Branch)
	}
	if src.Revision != "main@sha1:def" {
		t.Errorf("unexpected revision: %q", src.Revision)
	}
	if src.LastFetched != "2026-06-01T00:00:00Z" {
		t.Errorf("unexpected lastFetched: %q", src.LastFetched)
	}
	if !src.Ready {
		t.Error("expected Ready=true")
	}
}

// When no Kubernetes client is configured, every Flux handler must refuse with
// 503 rather than panic on a nil client. clusterManager is nil so k8sForRequest
// returns the (nil) legacy client.
func TestFluxHandlers_NoK8sClientReturn503(t *testing.T) {
	h := &Handler{cfg: &config.Config{}}

	handlers := map[string]http.HandlerFunc{
		"FluxListKustomizations": h.FluxListKustomizations,
		"FluxListHelmReleases":   h.FluxListHelmReleases,
		"FluxListSources":        h.FluxListSources,
		"FluxReconcile":          h.FluxReconcile,
		"FluxSuspend":            h.FluxSuspend,
		"FluxHelmReleaseValues":  h.FluxHelmReleaseValues,
		"FluxHelmReleaseHistory": h.FluxHelmReleaseHistory,
	}

	for name, fn := range handlers {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/flux/"+name, nil)
			w := httptest.NewRecorder()
			fn(w, req)
			if w.Code != http.StatusServiceUnavailable {
				t.Fatalf("%s: expected 503 with no k8s client, got %d", name, w.Code)
			}
		})
	}
}
