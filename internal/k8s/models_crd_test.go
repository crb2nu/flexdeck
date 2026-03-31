package k8s

import (
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
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
