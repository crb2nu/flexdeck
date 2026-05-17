package models

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"sigs.k8s.io/yaml"
)

func TestGitOpsGeneratorDefaultsAndWritesManifests(t *testing.T) {
	tempDir := t.TempDir()
	generator := NewGitOpsGenerator(tempDir, "ai")
	model := &Model{
		ID:   "hf-llama-3",
		Name: "Meta/Llama 3.1 Instruct",
		Type: TypeLLM,
	}
	config := DeploymentConfig{
		ModelPath:      "/models/llama",
		GPUCount:       2,
		MaxModelLen:    8192,
		TensorParallel: 2,
		Env: map[string]string{
			"SERVED_MODEL_NAME": "llama-3",
		},
	}

	if err := generator.WriteManifests(model, config); err != nil {
		t.Fatalf("WriteManifests() returned error: %v", err)
	}

	modelDir := filepath.Join(tempDir, "meta-llama-3-1-instruct")
	for _, file := range []string{"deployment.yaml", "service.yaml", "kustomization.yaml"} {
		if _, err := os.Stat(filepath.Join(modelDir, file)); err != nil {
			t.Fatalf("expected %s to be written: %v", file, err)
		}
	}

	deploymentBytes, err := os.ReadFile(filepath.Join(modelDir, "deployment.yaml"))
	if err != nil {
		t.Fatalf("read deployment manifest: %v", err)
	}

	var deployment map[string]any
	if err := yaml.Unmarshal(deploymentBytes, &deployment); err != nil {
		t.Fatalf("deployment manifest is not valid YAML: %v", err)
	}

	metadata := deployment["metadata"].(map[string]any)
	if metadata["name"] != "meta-llama-3-1-instruct" {
		t.Fatalf("expected sanitized deployment name, got %q", metadata["name"])
	}
	if metadata["namespace"] != "ai" {
		t.Fatalf("expected default namespace ai, got %q", metadata["namespace"])
	}

	spec := deployment["spec"].(map[string]any)
	if spec["replicas"] != float64(1) {
		t.Fatalf("expected default replica count 1, got %#v", spec["replicas"])
	}
	template := spec["template"].(map[string]any)
	podSpec := template["spec"].(map[string]any)
	containers := podSpec["containers"].([]any)
	container := containers[0].(map[string]any)
	if container["image"] != "vllm/vllm-openai:latest" {
		t.Fatalf("expected inferred LLM image, got %q", container["image"])
	}
	env := container["env"].([]any)
	if !envContains(env, "MODEL_PATH", "/models/llama") ||
		!envContains(env, "MAX_MODEL_LEN", "8192") ||
		!envContains(env, "TENSOR_PARALLEL_SIZE", "2") ||
		!envContains(env, "SERVED_MODEL_NAME", "llama-3") {
		t.Fatalf("deployment env did not include expected model settings: %#v", env)
	}
}

func TestGitOpsGeneratorReturnsErrorWhenRepoPathMissing(t *testing.T) {
	generator := NewGitOpsGenerator("", "ai")
	err := generator.WriteManifests(&Model{ID: "model", Name: "Model", Type: TypeLLM}, DeploymentConfig{})
	if err == nil || !strings.Contains(err.Error(), "gitops repo path not configured") {
		t.Fatalf("expected repo path error, got %v", err)
	}
}

func TestSanitizeNameTrimsAndTruncatesForKubernetes(t *testing.T) {
	name := sanitizeName("  Org/Model_Name.With  Spaces---And-Very-Long-Suffix-That-Exceeds-The-Kubernetes-DNS-Limit  ")
	if strings.Contains(name, "--") {
		t.Fatalf("expected consecutive dashes to be collapsed, got %q", name)
	}
	if strings.HasPrefix(name, "-") || strings.HasSuffix(name, "-") {
		t.Fatalf("expected boundary dashes to be trimmed, got %q", name)
	}
	if len(name) > 63 {
		t.Fatalf("expected name to fit Kubernetes DNS label limit, got %d chars", len(name))
	}
}

func envContains(env []any, name, value string) bool {
	for _, entry := range env {
		item, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		if item["name"] == name && item["value"] == value {
			return true
		}
	}
	return false
}
