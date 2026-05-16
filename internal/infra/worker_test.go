package infra

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/flexinfer/flexdeck/internal/cache"
	"github.com/flexinfer/flexdeck/internal/config"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/rest"
)

func TestBuildSnapshotUsesFakesForCompleteClusterState(t *testing.T) {
	ctx := context.Background()
	worker := newTestWorker(&fakeKubernetesReader{
		nodes: &corev1.NodeList{Items: []corev1.Node{{
			ObjectMeta: metav1.ObjectMeta{
				Name: "node-a",
				Labels: map[string]string{
					"node-role.kubernetes.io/control-plane": "",
				},
			},
			Status: corev1.NodeStatus{
				Capacity: corev1.ResourceList{
					corev1.ResourceMemory: resource.MustParse("16Gi"),
				},
				Conditions: []corev1.NodeCondition{{
					Type:   corev1.NodeReady,
					Status: corev1.ConditionTrue,
				}},
			},
		}}},
		pods: &corev1.PodList{Items: []corev1.Pod{
			{
				ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "apps"},
				Spec:       corev1.PodSpec{NodeName: "node-a"},
				Status:     corev1.PodStatus{Phase: corev1.PodRunning},
			},
			{
				ObjectMeta: metav1.ObjectMeta{Name: "worker", Namespace: "apps"},
				Spec:       corev1.PodSpec{NodeName: "node-a"},
				Status: corev1.PodStatus{
					Phase: corev1.PodFailed,
					ContainerStatuses: []corev1.ContainerStatus{{
						Name:         "worker",
						RestartCount: 2,
						LastTerminationState: corev1.ContainerState{
							Terminated: &corev1.ContainerStateTerminated{
								Reason:     "OOMKilled",
								FinishedAt: metav1.NewTime(time.Date(2026, 5, 16, 12, 0, 0, 0, time.UTC)),
							},
						},
					}},
				},
			},
		}},
		pvcs: &corev1.PersistentVolumeClaimList{Items: []corev1.PersistentVolumeClaim{{
			ObjectMeta: metav1.ObjectMeta{Name: "models", Namespace: "ai"},
			Spec: corev1.PersistentVolumeClaimSpec{
				StorageClassName: stringPtr("longhorn"),
				VolumeName:       "pvc-models",
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("10Gi")},
				},
			},
			Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound},
		}}},
		ingresses: &networkingv1.IngressList{Items: []networkingv1.Ingress{{
			ObjectMeta: metav1.ObjectMeta{Name: "flexdeck", Namespace: "apps"},
			Spec: networkingv1.IngressSpec{
				Rules: []networkingv1.IngressRule{{Host: "flexdeck.test"}},
			},
		}}},
		networkPolicies: &networkingv1.NetworkPolicyList{},
	})

	snap, err := worker.BuildSnapshot(ctx)
	if err != nil {
		t.Fatalf("BuildSnapshot returned error: %v", err)
	}

	if snap.Compute.TotalNodes != 1 || snap.Compute.ReadyNodes != 1 {
		t.Fatalf("expected one ready node, got total=%d ready=%d", snap.Compute.TotalNodes, snap.Compute.ReadyNodes)
	}
	if snap.Compute.TotalPods != 2 || snap.Compute.RunningPods != 1 || snap.Compute.OOMKilledCount != 1 {
		t.Fatalf("unexpected pod rollup: total=%d running=%d oom=%d", snap.Compute.TotalPods, snap.Compute.RunningPods, snap.Compute.OOMKilledCount)
	}
	if got := snap.Compute.Nodes[0].Roles; len(got) != 1 || got[0] != "control-plane" {
		t.Fatalf("expected extracted control-plane role, got %v", got)
	}
	if snap.Storage.TotalVolumes != 1 || snap.Storage.TotalCapacityGi != 10 {
		t.Fatalf("unexpected storage rollup: volumes=%d capacityGi=%f", snap.Storage.TotalVolumes, snap.Storage.TotalCapacityGi)
	}
	if got := snap.Networking.PolicyGaps; len(got) != 1 || got[0] != "apps" {
		t.Fatalf("expected apps namespace policy gap, got %v", got)
	}
	if snap.GitOps.DriftCount != 1 || snap.GitOps.SuspendedCount != 1 || len(snap.GitOps.Sources) != 1 {
		t.Fatalf("unexpected gitops rollup: drift=%d suspended=%d sources=%d", snap.GitOps.DriftCount, snap.GitOps.SuspendedCount, len(snap.GitOps.Sources))
	}
	if snap.LastUpdated <= 0 {
		t.Fatalf("expected lastUpdated to be set")
	}
}

func TestBuildSnapshotKeepsPartialStateWhenOneRefreshFails(t *testing.T) {
	worker := newTestWorker(&fakeKubernetesReader{
		nodesErr: errors.New("nodes unavailable"),
		pods:     &corev1.PodList{},
		pvcs: &corev1.PersistentVolumeClaimList{Items: []corev1.PersistentVolumeClaim{{
			ObjectMeta: metav1.ObjectMeta{Name: "data", Namespace: "apps"},
			Spec: corev1.PersistentVolumeClaimSpec{
				Resources: corev1.VolumeResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("2Gi")},
				},
			},
			Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound},
		}}},
		ingresses:       &networkingv1.IngressList{},
		networkPolicies: &networkingv1.NetworkPolicyList{},
	})

	snap, err := worker.BuildSnapshot(context.Background())
	if err != nil {
		t.Fatalf("BuildSnapshot returned error: %v", err)
	}

	if snap.Compute.TotalNodes != 0 {
		t.Fatalf("expected compute refresh to remain empty after node failure, got %d nodes", snap.Compute.TotalNodes)
	}
	if snap.Storage.TotalVolumes != 1 || snap.Storage.TotalCapacityGi != 2 {
		t.Fatalf("expected storage refresh to survive compute failure, got volumes=%d capacity=%f", snap.Storage.TotalVolumes, snap.Storage.TotalCapacityGi)
	}
}

func TestStartReturnsAfterCancelledWarmup(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	worker := newTestWorker(&fakeKubernetesReader{
		nodes:           &corev1.NodeList{},
		pods:            &corev1.PodList{},
		pvcs:            &corev1.PersistentVolumeClaimList{},
		ingresses:       &networkingv1.IngressList{},
		networkPolicies: &networkingv1.NetworkPolicyList{},
	})

	done := make(chan struct{})
	go func() {
		defer close(done)
		worker.Start(ctx)
	}()

	select {
	case <-done:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("worker did not stop after cancelled context")
	}
}

func TestMergeAndStoreWritesInfraSnapshot(t *testing.T) {
	ctx := context.Background()
	worker := newTestWorker(&fakeKubernetesReader{})
	worker.cache = newTestCache(t)
	worker.compute = ComputeSnapshot{TotalNodes: 2, ReadyNodes: 1}
	worker.storage = StorageSnapshot{TotalVolumes: 3}

	worker.mergeAndStore(ctx)

	data, err := worker.cache.Get(ctx, snapshotKey)
	if err != nil {
		t.Fatalf("cache get failed: %v", err)
	}
	if len(data) == 0 {
		t.Fatal("expected snapshot to be cached")
	}

	var snap InfraSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		t.Fatalf("cached snapshot was not JSON: %v", err)
	}
	if snap.Compute.TotalNodes != 2 || snap.Storage.TotalVolumes != 3 {
		t.Fatalf("unexpected cached snapshot: %+v", snap)
	}
}

func newTestWorker(kc *fakeKubernetesReader) *Worker {
	return &Worker{
		k8s:   kc,
		cfg:   &config.Config{Prom: config.PrometheusConfig{Disabled: true}},
		cache: nil,
		newDynamicClient: func(*rest.Config) (dynamic.Interface, error) {
			listKinds := map[schema.GroupVersionResource]string{
				ksGVR: "KustomizationList",
				hrGVR: "HelmReleaseList",
				grGVR: "GitRepositoryList",
				reGVR: "HelmRepositoryList",
			}
			return dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), listKinds,
				fluxObject("kustomize.toolkit.fluxcd.io/v1", "Kustomization", "apps", "app", false, false),
				fluxObject("helm.toolkit.fluxcd.io/v2", "HelmRelease", "apps", "chart", true, true),
				fluxSource("source.toolkit.fluxcd.io/v1", "GitRepository", "flux-system", "repo", true),
			), nil
		},
	}
}

func newTestCache(t *testing.T) *cache.Cache {
	t.Helper()

	server, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(server.Close)

	client, err := cache.NewRedisClient(config.RedisConfig{URL: "redis://" + server.Addr()})
	if err != nil {
		t.Fatalf("failed to create redis client: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	return cache.New(client, "flexdeck:test:")
}

type fakeKubernetesReader struct {
	nodes           *corev1.NodeList
	nodesErr        error
	pods            *corev1.PodList
	podsErr         error
	pvcs            *corev1.PersistentVolumeClaimList
	pvcsErr         error
	ingresses       *networkingv1.IngressList
	ingressesErr    error
	networkPolicies *networkingv1.NetworkPolicyList
	networkErr      error
}

func (f *fakeKubernetesReader) GetNodes(ctx context.Context) (*corev1.NodeList, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.nodesErr != nil {
		return nil, f.nodesErr
	}
	if f.nodes == nil {
		return &corev1.NodeList{}, nil
	}
	return f.nodes, nil
}

func (f *fakeKubernetesReader) GetPods(ctx context.Context, _ string) (*corev1.PodList, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.podsErr != nil {
		return nil, f.podsErr
	}
	if f.pods == nil {
		return &corev1.PodList{}, nil
	}
	return f.pods, nil
}

func (f *fakeKubernetesReader) GetPVCs(ctx context.Context, _ string) (*corev1.PersistentVolumeClaimList, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.pvcsErr != nil {
		return nil, f.pvcsErr
	}
	if f.pvcs == nil {
		return &corev1.PersistentVolumeClaimList{}, nil
	}
	return f.pvcs, nil
}

func (f *fakeKubernetesReader) GetIngresses(ctx context.Context, _ string) (*networkingv1.IngressList, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.ingressesErr != nil {
		return nil, f.ingressesErr
	}
	if f.ingresses == nil {
		return &networkingv1.IngressList{}, nil
	}
	return f.ingresses, nil
}

func (f *fakeKubernetesReader) GetNetworkPolicies(ctx context.Context, _ string) (*networkingv1.NetworkPolicyList, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.networkErr != nil {
		return nil, f.networkErr
	}
	if f.networkPolicies == nil {
		return &networkingv1.NetworkPolicyList{}, nil
	}
	return f.networkPolicies, nil
}

func (f *fakeKubernetesReader) Config() *rest.Config {
	return &rest.Config{Host: "https://kubernetes.invalid"}
}

func fluxObject(apiVersion, kind, namespace, name string, ready bool, suspended bool) *unstructured.Unstructured {
	status := "False"
	if ready {
		status = "True"
	}
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": apiVersion,
		"kind":       kind,
		"metadata": map[string]interface{}{
			"name":      name,
			"namespace": namespace,
		},
		"spec": map[string]interface{}{
			"suspend": suspended,
			"sourceRef": map[string]interface{}{
				"kind": "GitRepository",
				"name": "repo",
			},
		},
		"status": map[string]interface{}{
			"conditions": []interface{}{
				map[string]interface{}{
					"type":               "Ready",
					"status":             status,
					"message":            "synthetic",
					"lastTransitionTime": "2026-05-16T12:00:00Z",
				},
			},
		},
	}}
}

func fluxSource(apiVersion, kind, namespace, name string, ready bool) *unstructured.Unstructured {
	status := "False"
	if ready {
		status = "True"
	}
	return &unstructured.Unstructured{Object: map[string]interface{}{
		"apiVersion": apiVersion,
		"kind":       kind,
		"metadata": map[string]interface{}{
			"name":      name,
			"namespace": namespace,
		},
		"spec": map[string]interface{}{
			"url": "https://git.example/repo.git",
		},
		"status": map[string]interface{}{
			"conditions": []interface{}{
				map[string]interface{}{
					"type":   "Ready",
					"status": status,
				},
			},
		},
	}}
}

func stringPtr(s string) *string {
	return &s
}
