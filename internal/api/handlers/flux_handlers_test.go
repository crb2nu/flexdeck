package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/rest"

	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/k8s"
)

var (
	fluxKustomizationGVR = schema.GroupVersionResource{
		Group: "kustomize.toolkit.fluxcd.io", Version: "v1", Resource: "kustomizations",
	}
	fluxHelmReleaseGVR = schema.GroupVersionResource{
		Group: "helm.toolkit.fluxcd.io", Version: "v2", Resource: "helmreleases",
	}
	fluxGitRepositoryGVR = schema.GroupVersionResource{
		Group: "source.toolkit.fluxcd.io", Version: "v1", Resource: "gitrepositories",
	}
	fluxHelmRepositoryGVR = schema.GroupVersionResource{
		Group: "source.toolkit.fluxcd.io", Version: "v1", Resource: "helmrepositories",
	}
)

func newFluxTestHandler(t *testing.T, dyn dynamic.Interface) *Handler {
	t.Helper()

	kc, err := k8s.NewClient(config.K8sConfig{
		Host:          "https://kubernetes.test",
		Token:         "test-token",
		SkipTLSVerify: true,
	})
	if err != nil {
		t.Fatalf("new k8s client: %v", err)
	}

	return &Handler{
		cfg: &config.Config{},
		k8s: kc,
		dynamicClientForConfig: func(*rest.Config) (dynamic.Interface, error) {
			return dyn, nil
		},
	}
}

func newFluxDynamicClient(objects ...runtime.Object) dynamic.Interface {
	return dynamicfake.NewSimpleDynamicClientWithCustomListKinds(
		runtime.NewScheme(),
		map[schema.GroupVersionResource]string{
			fluxKustomizationGVR:  "KustomizationList",
			fluxHelmReleaseGVR:    "HelmReleaseList",
			fluxGitRepositoryGVR:  "GitRepositoryList",
			fluxHelmRepositoryGVR: "HelmRepositoryList",
		},
		objects...,
	)
}

func requestWithFluxParams(method, target string, body []byte, params map[string]string) *http.Request {
	req := httptest.NewRequest(method, target, bytes.NewReader(body))
	routeCtx := chi.NewRouteContext()
	for key, value := range params {
		routeCtx.URLParams.Add(key, value)
	}
	return req.WithContext(contextWithRouteCtx(req, routeCtx))
}

func contextWithRouteCtx(req *http.Request, routeCtx *chi.Context) context.Context {
	return context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx)
}

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

func TestFluxListKustomizationsWithDynamicClient(t *testing.T) {
	dyn := newFluxDynamicClient(&unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "kustomize.toolkit.fluxcd.io/v1",
		"kind":       "Kustomization",
		"metadata":   map[string]any{"name": "apps", "namespace": "flux-system"},
		"status": map[string]any{
			"lastAppliedRevision": "main@sha1:abc",
			"conditions": []any{
				map[string]any{"type": "Ready", "status": "True", "message": "applied"},
			},
		},
	}})
	h := newFluxTestHandler(t, dyn)

	req := httptest.NewRequest(http.MethodGet, "/api/flux/kustomizations", nil)
	w := httptest.NewRecorder()
	h.FluxListKustomizations(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got []FluxStatus
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected one kustomization, got %+v", got)
	}
	if got[0].Name != "apps" || got[0].Namespace != "flux-system" || !got[0].Ready {
		t.Fatalf("unexpected kustomization status: %+v", got[0])
	}
	if got[0].LastApplied != "main@sha1:abc" {
		t.Fatalf("expected last applied revision, got %q", got[0].LastApplied)
	}
}

func TestFluxSuspendUpdatesResourceSpec(t *testing.T) {
	dyn := newFluxDynamicClient(&unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "kustomize.toolkit.fluxcd.io/v1",
		"kind":       "Kustomization",
		"metadata":   map[string]any{"name": "apps", "namespace": "flux-system"},
	}})
	h := newFluxTestHandler(t, dyn)

	req := requestWithFluxParams(
		http.MethodPatch,
		"/api/flux/kustomization/flux-system/apps/suspend",
		[]byte(`{"suspend":true}`),
		map[string]string{"kind": "kustomization", "namespace": "flux-system", "name": "apps"},
	)
	w := httptest.NewRecorder()
	h.FluxSuspend(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	updated, err := dyn.Resource(fluxKustomizationGVR).Namespace("flux-system").Get(
		context.Background(), "apps", metav1.GetOptions{},
	)
	if err != nil {
		t.Fatalf("get updated kustomization: %v", err)
	}
	suspended, found, err := unstructured.NestedBool(updated.Object, "spec", "suspend")
	if err != nil || !found || !suspended {
		t.Fatalf("expected spec.suspend=true, found=%v value=%v err=%v object=%+v", found, suspended, err, updated.Object)
	}
}

func TestFluxHelmReleaseValuesReturnsValuesAndValuesFrom(t *testing.T) {
	dyn := newFluxDynamicClient(&unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "helm.toolkit.fluxcd.io/v2",
		"kind":       "HelmRelease",
		"metadata":   map[string]any{"name": "api", "namespace": "apps"},
		"spec": map[string]any{
			"values": map[string]any{"replicaCount": int64(3)},
			"valuesFrom": []any{
				map[string]any{"kind": "ConfigMap", "name": "api-values"},
			},
		},
	}})
	h := newFluxTestHandler(t, dyn)

	req := requestWithFluxParams(
		http.MethodGet,
		"/api/flux/helmreleases/apps/api/values",
		nil,
		map[string]string{"namespace": "apps", "name": "api"},
	)
	w := httptest.NewRecorder()
	h.FluxHelmReleaseValues(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got struct {
		Name       string           `json:"name"`
		Namespace  string           `json:"namespace"`
		Values     map[string]int64 `json:"values"`
		ValuesFrom []map[string]any `json:"valuesFrom"`
	}
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode values response: %v", err)
	}
	if got.Name != "api" || got.Namespace != "apps" || got.Values["replicaCount"] != 3 {
		t.Fatalf("unexpected values response: %+v", got)
	}
	if len(got.ValuesFrom) != 1 || got.ValuesFrom[0]["name"] != "api-values" {
		t.Fatalf("unexpected valuesFrom: %+v", got.ValuesFrom)
	}
}

func TestFluxListSourcesCombinesGitAndHelmRepositories(t *testing.T) {
	dyn := newFluxDynamicClient(
		&unstructured.Unstructured{Object: map[string]any{
			"apiVersion": "source.toolkit.fluxcd.io/v1",
			"kind":       "GitRepository",
			"metadata":   map[string]any{"name": "platform", "namespace": "flux-system"},
			"spec":       map[string]any{"url": "https://example.test/platform.git", "ref": map[string]any{"branch": "main"}},
			"status": map[string]any{
				"artifact": map[string]any{"revision": "main@sha1:abc"},
				"conditions": []any{
					map[string]any{"type": "Ready", "status": "True"},
				},
			},
		}},
		&unstructured.Unstructured{Object: map[string]any{
			"apiVersion": "source.toolkit.fluxcd.io/v1",
			"kind":       "HelmRepository",
			"metadata":   map[string]any{"name": "charts", "namespace": "flux-system"},
			"spec":       map[string]any{"url": "https://charts.example.test"},
		}},
	)
	h := newFluxTestHandler(t, dyn)

	req := httptest.NewRequest(http.MethodGet, "/api/flux/sources", nil)
	w := httptest.NewRecorder()
	h.FluxListSources(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var got []FluxSource
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode sources response: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected two sources, got %+v", got)
	}
	if got[0].Kind != "GitRepository" || got[0].URL != "https://example.test/platform.git" || !got[0].Ready {
		t.Fatalf("unexpected git source: %+v", got[0])
	}
	if got[1].Kind != "HelmRepository" || got[1].URL != "https://charts.example.test" {
		t.Fatalf("unexpected helm source: %+v", got[1])
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
