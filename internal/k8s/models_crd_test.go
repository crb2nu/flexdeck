package k8s

import (
	"context"
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

func TestParseModelMapsFields(t *testing.T) {
	created := time.Date(2026, 2, 20, 7, 30, 0, 0, time.UTC)
	reconfiguredAt := time.Date(2026, 2, 20, 8, 15, 0, 0, time.UTC).Format(time.RFC3339)
	obj := &unstructured.Unstructured{
		Object: map[string]any{
			"metadata": map[string]any{
				"name":              "llama-3",
				"namespace":         "ai",
				"creationTimestamp": created.Format(time.RFC3339),
				"labels": map[string]any{
					"team": "platform",
				},
				"annotations": map[string]any{
					"note": "baseline",
				},
			},
			"spec": map[string]any{
				"backend":       "vllm",
				"source":        "hf://meta-llama/Llama-3.1-8B-Instruct",
				"serviceLabels": []any{"chat", "llm"},
				"config": map[string]any{
					"tensorParallelSize":   int64(2),
					"enableChunkedPrefill": true,
				},
				"resources": map[string]any{
					"requests": map[string]any{
						"cpu":    "4",
						"memory": "16Gi",
					},
					"limits": map[string]any{
						"cpu":    "8",
						"memory": "32Gi",
					},
				},
				"tolerations": []any{
					map[string]any{
						"key":      "dedicated",
						"operator": "Equal",
						"value":    "gpu",
						"effect":   "NoSchedule",
					},
				},
				"gpu": map[string]any{
					"vendor":       "nvidia",
					"shared":       "true",
					"swapCooldown": "5m",
				},
				"cache": map[string]any{
					"strategy": "Local",
					"hostPath": "/var/lib/flexinfer/models",
					"compilationCache": map[string]any{
						"enabled":   true,
						"hostPath":  "/var/lib/flexinfer/compile-cache",
						"sizeLimit": "2Gi",
					},
					"flashLoader": map[string]any{
						"enabled":        true,
						"concurrency":    int64(8),
						"tmpfsSizeLimit": "24Gi",
						"bufferSizeKB":   int64(8192),
					},
				},
				"kvCache": map[string]any{
					"pressurePolicy":      "Reconfigure",
					"highWatermark":       "85%",
					"lowWatermark":        "60%",
					"maxBlockSize":        int64(32),
					"swapSpace":           "16Gi",
					"reconfigureCooldown": "5m",
				},
				"capabilities": map[string]any{
					"toolCalling":     true,
					"vision":          true,
					"imageGeneration": false,
				},
				"quantize": map[string]any{
					"format":         "GPTQ",
					"bits":           int64(4),
					"groupSize":      int64(128),
					"useGPU":         true,
					"maxMemoryGB":    int64(48),
					"timeoutSeconds": int64(7200),
					"calibration": map[string]any{
						"maxSeqLen": int64(4096),
						"dataset":   "mit-han-lab/pile-val-backup",
					},
				},
			},
			"status": map[string]any{
				"phase":    "Ready",
				"endpoint": "http://llama-3.ai.svc.cluster.local",
				"cache": map[string]any{
					"strategy": "Local",
					"ready":    true,
					"quantization": map[string]any{
						"format":           "GPTQ",
						"type":             "INT4",
						"compressionRatio": "3.50",
						"progress":         int64(100),
						"progressDetail":   "completed",
						"failureMessage":   "",
						"startedAt":        created.Format(time.RFC3339),
						"completedAt":      reconfiguredAt,
					},
				},
				"kvCache": map[string]any{
					"pressure":               true,
					"reconfigured":           true,
					"reconfiguredAt":         reconfiguredAt,
					"originalMaxNumSeqs":     int64(16),
					"reconfiguredMaxNumSeqs": int64(8),
					"evicted":                false,
				},
			},
		},
	}

	model, err := parseModel(obj)
	if err != nil {
		t.Fatalf("parseModel() returned error: %v", err)
	}

	if model.Name != "llama-3" {
		t.Fatalf("expected name llama-3, got %q", model.Name)
	}
	if model.Namespace != "ai" {
		t.Fatalf("expected namespace ai, got %q", model.Namespace)
	}
	if model.Spec.Backend != "vllm" {
		t.Fatalf("expected backend vllm, got %q", model.Spec.Backend)
	}
	if model.Status.Phase != "Ready" {
		t.Fatalf("expected phase Ready, got %q", model.Status.Phase)
	}
	if model.Spec.Config["tensorParallelSize"] != float64(2) {
		t.Fatalf("expected config tensorParallelSize=2, got %#v", model.Spec.Config)
	}
	if model.Spec.Resources == nil || model.Spec.Resources.Requests["cpu"] != "4" || model.Spec.Resources.Limits["memory"] != "32Gi" {
		t.Fatalf("expected resources to round-trip, got %+v", model.Spec.Resources)
	}
	if len(model.Spec.Tolerations) != 1 || model.Spec.Tolerations[0].Key != "dedicated" {
		t.Fatalf("expected tolerations to round-trip, got %+v", model.Spec.Tolerations)
	}
	if model.Spec.GPU == nil || model.Spec.GPU.SwapCooldown != "5m" {
		t.Fatalf("expected gpu.swapCooldown=5m, got %+v", model.Spec.GPU)
	}
	if model.Spec.Cache == nil || model.Spec.Cache.HostPath != "/var/lib/flexinfer/models" {
		t.Fatalf("expected cache.hostPath to round-trip, got %+v", model.Spec.Cache)
	}
	if model.Spec.Cache.CompilationCache == nil || model.Spec.Cache.CompilationCache.SizeLimit != "2Gi" {
		t.Fatalf("expected compilation cache to round-trip, got %+v", model.Spec.Cache)
	}
	if model.Spec.Cache.FlashLoader == nil || model.Spec.Cache.FlashLoader.TmpfsSizeLimit != "24Gi" {
		t.Fatalf("expected flash loader to round-trip, got %+v", model.Spec.Cache)
	}
	if model.Spec.KVCache == nil || model.Spec.KVCache.ReconfigureCooldown != "5m" || model.Spec.KVCache.MaxBlockSize == nil || *model.Spec.KVCache.MaxBlockSize != 32 {
		t.Fatalf("expected kvCache expansion fields to round-trip, got %+v", model.Spec.KVCache)
	}
	if model.Spec.Capabilities == nil || model.Spec.Capabilities.ToolCalling == nil || !*model.Spec.Capabilities.ToolCalling || model.Spec.Capabilities.Vision == nil || !*model.Spec.Capabilities.Vision {
		t.Fatalf("expected capabilities to round-trip, got %+v", model.Spec.Capabilities)
	}
	if model.Spec.Quantize == nil || model.Spec.Quantize.Calibration == nil || model.Spec.Quantize.Calibration.Dataset == nil || *model.Spec.Quantize.Calibration.Dataset != "mit-han-lab/pile-val-backup" {
		t.Fatalf("expected quantize.calibration to round-trip, got %+v", model.Spec.Quantize)
	}
	if model.Status.Cache == nil || model.Status.Cache.Quantization == nil || model.Status.Cache.Quantization.Format != "GPTQ" {
		t.Fatalf("expected cache.quantization to round-trip, got %+v", model.Status.Cache)
	}
	if model.Status.KVCache == nil || !model.Status.KVCache.Reconfigured || model.Status.KVCache.ReconfiguredAt != reconfiguredAt {
		t.Fatalf("expected kvCache.reconfigured fields to round-trip, got %+v", model.Status.KVCache)
	}
	if model.Labels["team"] != "platform" {
		t.Fatalf("expected label team=platform, got %v", model.Labels)
	}
	if model.Annotations["note"] != "baseline" {
		t.Fatalf("expected annotation note=baseline, got %v", model.Annotations)
	}
}

func TestParseModelListSkipsInvalidEntries(t *testing.T) {
	valid := unstructured.Unstructured{
		Object: map[string]any{
			"metadata": map[string]any{
				"name":      "valid-model",
				"namespace": "ai",
			},
			"spec": map[string]any{
				"backend": "vllm",
				"source":  "hf://org/model",
			},
		},
	}
	invalid := unstructured.Unstructured{
		Object: map[string]any{
			"metadata": map[string]any{
				"name":      "invalid-model",
				"namespace": "ai",
			},
			"spec": "not-an-object",
		},
	}

	list := &unstructured.UnstructuredList{
		Items: []unstructured.Unstructured{valid, invalid},
	}

	models, err := parseModelList(list)
	if err != nil {
		t.Fatalf("parseModelList() returned error: %v", err)
	}
	if len(models) != 1 {
		t.Fatalf("expected one valid model, got %d", len(models))
	}
	if models[0].Name != "valid-model" {
		t.Fatalf("unexpected model parsed: %+v", models[0])
	}
}

func TestListFlexInferModelsSkipsMalformedCRDs(t *testing.T) {
	client := newDynamicFlexInferClient(
		modelObject("valid-model", "ai", map[string]any{
			"backend": "vllm",
			"source":  "hf://org/model",
		}, map[string]any{
			"phase": "Ready",
		}),
		&unstructured.Unstructured{
			Object: map[string]any{
				"apiVersion": "ai.flexinfer/v1alpha2",
				"kind":       "Model",
				"metadata": map[string]any{
					"name":      "invalid-model",
					"namespace": "ai",
				},
				"spec": "not-an-object",
			},
		},
	)

	models, err := client.ListFlexInferModels(context.Background(), "ai")
	if err != nil {
		t.Fatalf("ListFlexInferModels() returned error: %v", err)
	}
	if len(models) != 1 {
		t.Fatalf("expected one valid model, got %d", len(models))
	}
	if models[0].Name != "valid-model" || models[0].Status.Phase != "Ready" {
		t.Fatalf("unexpected model parsed: %+v", models[0])
	}
}

func TestFlexInferModelPatchOperations(t *testing.T) {
	client := newDynamicFlexInferClient(modelObject("llama-3", "ai", map[string]any{
		"backend": "vllm",
		"source":  "hf://meta-llama/Llama-3",
	}, nil))

	if err := client.ScaleFlexInferModel(context.Background(), "ai", "llama-3", 3); err != nil {
		t.Fatalf("ScaleFlexInferModel() returned error: %v", err)
	}
	obj := getDynamicObject(t, client, modelGVR, "ai", "llama-3")
	minReplicas, found, err := unstructured.NestedInt64(obj.Object, "spec", "serverless", "minReplicas")
	if err != nil || !found || minReplicas != 3 {
		t.Fatalf("expected minReplicas patch to be applied, found=%v value=%d err=%v object=%v", found, minReplicas, err, obj.Object)
	}

	if err := client.PatchFlexInferModelSpec(context.Background(), "ai", "llama-3", map[string]any{
		"backend": "llamacpp",
		"gpu": map[string]any{
			"vendor": "amd",
		},
	}); err != nil {
		t.Fatalf("PatchFlexInferModelSpec() returned error: %v", err)
	}
	obj = getDynamicObject(t, client, modelGVR, "ai", "llama-3")
	backend, found, err := unstructured.NestedString(obj.Object, "spec", "backend")
	if err != nil || !found || backend != "llamacpp" {
		t.Fatalf("expected backend patch to be applied, found=%v value=%q err=%v", found, backend, err)
	}
	vendor, found, err := unstructured.NestedString(obj.Object, "spec", "gpu", "vendor")
	if err != nil || !found || vendor != "amd" {
		t.Fatalf("expected gpu vendor patch to be applied, found=%v value=%q err=%v", found, vendor, err)
	}

	if err := client.RestartFlexInferModel(context.Background(), "ai", "llama-3"); err != nil {
		t.Fatalf("RestartFlexInferModel() returned error: %v", err)
	}
	obj = getDynamicObject(t, client, modelGVR, "ai", "llama-3")
	restartedAt, found, err := unstructured.NestedString(obj.Object, "metadata", "annotations", "flexinfer.ai/restartedAt")
	if err != nil || !found || restartedAt == "" {
		t.Fatalf("expected restart annotation to be applied, found=%v value=%q err=%v", found, restartedAt, err)
	}
}

func TestListLoRAAdaptersAndCatalogsUseDefaultsAndSkipMalformedEntries(t *testing.T) {
	client := newDynamicFlexInferClient(
		&unstructured.Unstructured{
			Object: map[string]any{
				"apiVersion": "ai.flexinfer/v1alpha2",
				"kind":       "LoRAAdapter",
				"metadata": map[string]any{
					"name":      "sql-adapter",
					"namespace": "ai",
				},
				"spec": map[string]any{
					"modelRef":      "llama-3",
					"adapterSource": "hf://org/sql-adapter",
				},
				"status": map[string]any{},
			},
		},
		&unstructured.Unstructured{
			Object: map[string]any{
				"apiVersion": "ai.flexinfer/v1alpha2",
				"kind":       "LoRAAdapter",
				"metadata": map[string]any{
					"name":      "bad-adapter",
					"namespace": "ai",
				},
				"spec": "not-an-object",
			},
		},
		&unstructured.Unstructured{
			Object: map[string]any{
				"apiVersion": "ai.flexinfer/v1alpha2",
				"kind":       "ModelCatalog",
				"metadata": map[string]any{
					"name":      "hf-catalog",
					"namespace": "ai",
				},
				"spec": map[string]any{
					"source": "HuggingFace",
					"models": []any{
						map[string]any{
							"name": "llama-3",
							"size": "8B",
							"tags": []any{"chat", "llm"},
						},
					},
				},
				"status": map[string]any{
					"lastSyncTime": "2026-05-17T10:00:00Z",
				},
			},
		},
		&unstructured.Unstructured{
			Object: map[string]any{
				"apiVersion": "ai.flexinfer/v1alpha2",
				"kind":       "ModelCatalog",
				"metadata": map[string]any{
					"name":      "bad-catalog",
					"namespace": "ai",
				},
				"spec": "not-an-object",
			},
		},
	)

	adapters, err := client.ListLoRAAdapters(context.Background(), "ai")
	if err != nil {
		t.Fatalf("ListLoRAAdapters() returned error: %v", err)
	}
	if len(adapters) != 1 {
		t.Fatalf("expected one valid adapter, got %d", len(adapters))
	}
	if adapters[0].State != "Pending" {
		t.Fatalf("expected adapter without status to default Pending, got %q", adapters[0].State)
	}
	if adapters[0].ModelRef != "llama-3" || adapters[0].AdapterSource != "hf://org/sql-adapter" {
		t.Fatalf("adapter fields did not round-trip: %+v", adapters[0])
	}

	catalogs, err := client.ListModelCatalogs(context.Background(), "ai")
	if err != nil {
		t.Fatalf("ListModelCatalogs() returned error: %v", err)
	}
	if len(catalogs) != 1 {
		t.Fatalf("expected one valid catalog, got %d", len(catalogs))
	}
	if catalogs[0].Source != "HuggingFace" || catalogs[0].LastSyncTime == "" {
		t.Fatalf("catalog fields did not round-trip: %+v", catalogs[0])
	}
	if len(catalogs[0].Models) != 1 || catalogs[0].Models[0].Name != "llama-3" || len(catalogs[0].Models[0].Tags) != 2 {
		t.Fatalf("catalog model refs did not round-trip: %+v", catalogs[0].Models)
	}
}

func newDynamicFlexInferClient(objects ...runtime.Object) *Client {
	scheme := runtime.NewScheme()
	dynClient := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, map[schema.GroupVersionResource]string{
		modelGVR:         "ModelList",
		loraAdapterGVR:   "LoRAAdapterList",
		modelCatalogGVR:  "ModelCatalogList",
		gamingSessionGVR: "GamingSessionList",
	}, objects...)
	return &Client{dynClient: dynClient}
}

func modelObject(name, namespace string, spec map[string]any, status map[string]any) *unstructured.Unstructured {
	obj := map[string]any{
		"apiVersion": "ai.flexinfer/v1alpha2",
		"kind":       "Model",
		"metadata": map[string]any{
			"name":      name,
			"namespace": namespace,
		},
		"spec": spec,
	}
	if status != nil {
		obj["status"] = status
	}
	return &unstructured.Unstructured{Object: obj}
}

func getDynamicObject(t *testing.T, client *Client, gvr schema.GroupVersionResource, namespace, name string) *unstructured.Unstructured {
	t.Helper()

	obj, err := client.dynClient.Resource(gvr).Namespace(namespace).Get(context.Background(), name, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get dynamic object %s/%s: %v", namespace, name, err)
	}
	return obj
}
