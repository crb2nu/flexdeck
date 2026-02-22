package k8s

import (
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

func TestParseModelMapsFields(t *testing.T) {
	created := time.Date(2026, 2, 20, 12, 30, 0, 0, time.UTC)
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
				"gpu": map[string]any{
					"vendor": "nvidia",
					"shared": "true",
				},
			},
			"status": map[string]any{
				"phase":    "Ready",
				"endpoint": "http://llama-3.ai.svc.cluster.local",
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
	if model.CreationTimestamp != created.Format("2006-01-02T15:04:05Z") {
		t.Fatalf("expected normalized creation timestamp, got %q", model.CreationTimestamp)
	}
	if model.Spec.Backend != "vllm" {
		t.Fatalf("expected backend vllm, got %q", model.Spec.Backend)
	}
	if model.Status.Phase != "Ready" {
		t.Fatalf("expected phase Ready, got %q", model.Status.Phase)
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
