package k8s

import (
	"context"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
)

func newFakeClient(objects ...runtime.Object) *Client {
	return &Client{clientset: fake.NewSimpleClientset(objects...)}
}

func TestClientListHelpersScopeAndSelectors(t *testing.T) {
	ctx := context.Background()
	client := newFakeClient(
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "llm-a", Namespace: "ai", Labels: map[string]string{"app": "llm"}},
			Spec:       corev1.PodSpec{NodeName: "gpu-a"},
			Status:     corev1.PodStatus{Phase: corev1.PodRunning},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: "web-a", Namespace: "apps", Labels: map[string]string{"app": "web"}},
			Status:     corev1.PodStatus{Phase: corev1.PodPending},
		},
		&batchv1.Job{
			ObjectMeta: metav1.ObjectMeta{Name: "quantize-a", Namespace: "ai", Labels: map[string]string{"flexinfer.ai/model": "llm-a"}},
		},
		&corev1.Service{
			ObjectMeta: metav1.ObjectMeta{Name: "llm", Namespace: "ai"},
			Spec:       corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP},
		},
		&networkingv1.Ingress{ObjectMeta: metav1.ObjectMeta{Name: "llm", Namespace: "ai"}},
		&networkingv1.NetworkPolicy{ObjectMeta: metav1.ObjectMeta{Name: "deny-by-default", Namespace: "ai"}},
		&corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "models", Namespace: "ai"}},
		&corev1.PersistentVolume{ObjectMeta: metav1.ObjectMeta{Name: "pv-models"}},
		&storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "longhorn"}},
		&corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "settings", Namespace: "ai"}},
		&corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "token", Namespace: "ai"}},
		&corev1.Event{
			ObjectMeta:     metav1.ObjectMeta{Name: "pulling", Namespace: "ai"},
			InvolvedObject: corev1.ObjectReference{Name: "llm-a", Kind: "Pod"},
			Reason:         "Pulling",
		},
	)

	allPods, err := client.GetPods(ctx, "")
	if err != nil {
		t.Fatalf("GetPods all namespaces returned error: %v", err)
	}
	if len(allPods.Items) != 2 {
		t.Fatalf("expected two pods across all namespaces, got %d", len(allPods.Items))
	}

	aiPods, err := client.GetPods(ctx, "ai")
	if err != nil {
		t.Fatalf("GetPods namespace returned error: %v", err)
	}
	if len(aiPods.Items) != 1 || aiPods.Items[0].Name != "llm-a" {
		t.Fatalf("expected ai pod llm-a, got %+v", aiPods.Items)
	}

	selectedPods, err := client.ListPodsByLabel(ctx, "ai", "app=llm")
	if err != nil {
		t.Fatalf("ListPodsByLabel returned error: %v", err)
	}
	if len(selectedPods) != 1 || selectedPods[0].Name != "llm-a" {
		t.Fatalf("expected one selected pod, got %+v", selectedPods)
	}

	selectedJobs, err := client.ListJobsByLabel(ctx, "ai", "flexinfer.ai/model=llm-a")
	if err != nil {
		t.Fatalf("ListJobsByLabel returned error: %v", err)
	}
	if len(selectedJobs) != 1 || selectedJobs[0].Name != "quantize-a" {
		t.Fatalf("expected one selected job, got %+v", selectedJobs)
	}

	checkList := map[string]func() (int, error){
		"services": func() (int, error) {
			list, err := client.GetServices(ctx, "")
			return len(list.Items), err
		},
		"ingresses": func() (int, error) {
			list, err := client.GetIngresses(ctx, "ai")
			return len(list.Items), err
		},
		"networkPolicies": func() (int, error) {
			list, err := client.GetNetworkPolicies(ctx, "ai")
			return len(list.Items), err
		},
		"pvcs": func() (int, error) {
			list, err := client.GetPVCs(ctx, "ai")
			return len(list.Items), err
		},
		"pvs": func() (int, error) {
			list, err := client.GetPVs(ctx)
			return len(list.Items), err
		},
		"storageClasses": func() (int, error) {
			list, err := client.GetStorageClasses(ctx)
			return len(list.Items), err
		},
		"configMaps": func() (int, error) {
			list, err := client.GetConfigMaps(ctx, "ai")
			return len(list.Items), err
		},
		"secrets": func() (int, error) {
			list, err := client.GetSecrets(ctx, "ai")
			return len(list.Items), err
		},
	}
	for name, call := range checkList {
		t.Run(name, func(t *testing.T) {
			count, err := call()
			if err != nil {
				t.Fatalf("%s returned error: %v", name, err)
			}
			if count != 1 {
				t.Fatalf("expected one %s item, got %d", name, count)
			}
		})
	}

	eventList, err := client.GetEvents(ctx, "ai", "involvedObject.name=llm-a")
	if err != nil {
		t.Fatalf("GetEvents returned error: %v", err)
	}
	if len(eventList.Items) != 1 || eventList.Items[0].Reason != "Pulling" {
		t.Fatalf("expected pulling event, got %+v", eventList.Items)
	}
}

func TestClientWorkloadHelpers(t *testing.T) {
	ctx := context.Background()
	replicas := int32(2)
	client := newFakeClient(
		&corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "gpu-a"},
			Status: corev1.NodeStatus{Capacity: corev1.ResourceList{
				corev1.ResourceCPU:                 resource.MustParse("8"),
				corev1.ResourceMemory:              resource.MustParse("32Gi"),
				corev1.ResourceName("amd.com/gpu"): resource.MustParse("1"),
			}},
		},
		&appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{Name: "llm", Namespace: "ai"},
			Spec: appsv1.DeploymentSpec{
				Replicas: &replicas,
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "llm"}},
				Template: corev1.PodTemplateSpec{
					ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "llm"}},
					Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "llm", Image: "vllm"}}},
				},
			},
		},
		&appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Name: "cache", Namespace: "ai"}},
		&appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Name: "exporter", Namespace: "ai"}},
		&batchv1.CronJob{ObjectMeta: metav1.ObjectMeta{Name: "refresh", Namespace: "ai"}},
	)

	nodes, err := client.GetNodes(ctx)
	if err != nil {
		t.Fatalf("GetNodes returned error: %v", err)
	}
	if len(nodes.Items) != 1 || nodes.Items[0].Name != "gpu-a" {
		t.Fatalf("expected gpu-a node, got %+v", nodes.Items)
	}

	deployment, err := client.GetDeployment(ctx, "ai", "llm")
	if err != nil {
		t.Fatalf("GetDeployment returned error: %v", err)
	}
	if deployment.Name != "llm" {
		t.Fatalf("expected deployment llm, got %q", deployment.Name)
	}

	if err := client.RestartDeployment(ctx, "ai", "llm"); err != nil {
		t.Fatalf("RestartDeployment returned error: %v", err)
	}
	restarted, err := client.GetDeployment(ctx, "ai", "llm")
	if err != nil {
		t.Fatalf("GetDeployment after restart returned error: %v", err)
	}
	if restarted.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] == "" {
		t.Fatalf("expected restartedAt annotation after restart, got %+v", restarted.Spec.Template.Annotations)
	}

	checkList := map[string]func() (int, error){
		"deployments": func() (int, error) {
			list, err := client.GetDeployments(ctx, "ai")
			return len(list.Items), err
		},
		"statefulSets": func() (int, error) {
			list, err := client.GetStatefulSets(ctx, "ai")
			return len(list.Items), err
		},
		"daemonSets": func() (int, error) {
			list, err := client.GetDaemonSets(ctx, "ai")
			return len(list.Items), err
		},
		"cronJobs": func() (int, error) {
			list, err := client.GetCronJobs(ctx, "ai")
			return len(list.Items), err
		},
	}
	for name, call := range checkList {
		t.Run(name, func(t *testing.T) {
			count, err := call()
			if err != nil {
				t.Fatalf("%s returned error: %v", name, err)
			}
			if count != 1 {
				t.Fatalf("expected one %s item, got %d", name, count)
			}
		})
	}
}
