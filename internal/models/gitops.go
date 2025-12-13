package models

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"text/template"
)

// DeploymentConfig holds configuration for deploying a model
type DeploymentConfig struct {
	Name           string            `json:"name"`
	Namespace      string            `json:"namespace"`
	Replicas       int               `json:"replicas"`
	Image          string            `json:"image"`           // e.g., "vllm/vllm-openai:latest"
	ModelPath      string            `json:"model_path"`      // Path to model files
	GPUCount       int               `json:"gpu_count"`
	GPUType        string            `json:"gpu_type"`        // e.g., "nvidia.com/gpu"
	MaxModelLen    int               `json:"max_model_len"`   // Max sequence length
	TensorParallel int               `json:"tensor_parallel"` // Number of GPUs for tensor parallelism
	Port           int               `json:"port"`
	Env            map[string]string `json:"env"`
	Resources      ResourceConfig    `json:"resources"`
}

// ResourceConfig defines resource requests/limits
type ResourceConfig struct {
	CPURequest    string `json:"cpu_request"`
	CPULimit      string `json:"cpu_limit"`
	MemoryRequest string `json:"memory_request"`
	MemoryLimit   string `json:"memory_limit"`
}

// GitOpsGenerator generates Kubernetes manifests for model deployments
type GitOpsGenerator struct {
	repoPath  string
	namespace string
}

// NewGitOpsGenerator creates a new GitOps manifest generator
func NewGitOpsGenerator(repoPath, namespace string) *GitOpsGenerator {
	return &GitOpsGenerator{
		repoPath:  repoPath,
		namespace: namespace,
	}
}

// GenerateDeployment creates a deployment manifest for a model
func (g *GitOpsGenerator) GenerateDeployment(model *Model, config DeploymentConfig) (string, error) {
	if config.Namespace == "" {
		config.Namespace = g.namespace
	}
	if config.Name == "" {
		config.Name = sanitizeName(model.Name)
	}
	if config.Replicas == 0 {
		config.Replicas = 1
	}
	if config.Port == 0 {
		config.Port = 8000
	}
	if config.GPUType == "" {
		config.GPUType = "nvidia.com/gpu"
	}
	if config.Image == "" {
		config.Image = g.inferImage(model)
	}

	tmpl, err := template.New("deployment").Parse(deploymentTemplate)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	data := map[string]any{
		"model":  model,
		"config": config,
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}

	return buf.String(), nil
}

// GenerateService creates a service manifest for a model deployment
func (g *GitOpsGenerator) GenerateService(model *Model, config DeploymentConfig) (string, error) {
	if config.Namespace == "" {
		config.Namespace = g.namespace
	}
	if config.Name == "" {
		config.Name = sanitizeName(model.Name)
	}
	if config.Port == 0 {
		config.Port = 8000
	}

	tmpl, err := template.New("service").Parse(serviceTemplate)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	data := map[string]any{
		"model":  model,
		"config": config,
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}

	return buf.String(), nil
}

// GenerateKustomization creates a kustomization.yaml for the model
func (g *GitOpsGenerator) GenerateKustomization(model *Model, config DeploymentConfig) (string, error) {
	if config.Name == "" {
		config.Name = sanitizeName(model.Name)
	}
	if config.Namespace == "" {
		config.Namespace = g.namespace
	}

	tmpl, err := template.New("kustomization").Parse(kustomizationTemplate)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	data := map[string]any{
		"model":  model,
		"config": config,
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}

	return buf.String(), nil
}

// WriteManifests writes all manifests to the GitOps repository
func (g *GitOpsGenerator) WriteManifests(model *Model, config DeploymentConfig) error {
	if g.repoPath == "" {
		return fmt.Errorf("gitops repo path not configured")
	}

	if config.Name == "" {
		config.Name = sanitizeName(model.Name)
	}

	// Create model directory
	modelDir := filepath.Join(g.repoPath, config.Name)
	if err := os.MkdirAll(modelDir, 0755); err != nil {
		return fmt.Errorf("create directory: %w", err)
	}

	// Generate and write deployment
	deployment, err := g.GenerateDeployment(model, config)
	if err != nil {
		return fmt.Errorf("generate deployment: %w", err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "deployment.yaml"), []byte(deployment), 0644); err != nil {
		return fmt.Errorf("write deployment: %w", err)
	}

	// Generate and write service
	service, err := g.GenerateService(model, config)
	if err != nil {
		return fmt.Errorf("generate service: %w", err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "service.yaml"), []byte(service), 0644); err != nil {
		return fmt.Errorf("write service: %w", err)
	}

	// Generate and write kustomization
	kustomization, err := g.GenerateKustomization(model, config)
	if err != nil {
		return fmt.Errorf("generate kustomization: %w", err)
	}
	if err := os.WriteFile(filepath.Join(modelDir, "kustomization.yaml"), []byte(kustomization), 0644); err != nil {
		return fmt.Errorf("write kustomization: %w", err)
	}

	return nil
}

// inferImage determines the best container image for a model type
func (g *GitOpsGenerator) inferImage(model *Model) string {
	switch model.Type {
	case TypeLLM:
		return "vllm/vllm-openai:latest"
	case TypeDiffusion:
		return "stabilityai/stable-diffusion:latest"
	case TypeEmbedding:
		return "sentence-transformers/all-MiniLM-L6-v2:latest"
	default:
		return "vllm/vllm-openai:latest"
	}
}

func sanitizeName(name string) string {
	// Convert to lowercase and replace special chars with dashes
	name = strings.ToLower(name)
	name = strings.ReplaceAll(name, "/", "-")
	name = strings.ReplaceAll(name, "_", "-")
	name = strings.ReplaceAll(name, " ", "-")
	name = strings.ReplaceAll(name, ".", "-")

	// Remove consecutive dashes
	for strings.Contains(name, "--") {
		name = strings.ReplaceAll(name, "--", "-")
	}

	// Trim dashes from ends
	name = strings.Trim(name, "-")

	// Truncate to max K8s name length
	if len(name) > 63 {
		name = name[:63]
	}

	return name
}

const deploymentTemplate = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .config.Name }}
  namespace: {{ .config.Namespace }}
  labels:
    app: {{ .config.Name }}
    app.kubernetes.io/name: {{ .config.Name }}
    app.kubernetes.io/component: model-server
    flexdeck.io/model-id: {{ .model.ID }}
    flexdeck.io/model-type: {{ .model.Type }}
spec:
  replicas: {{ .config.Replicas }}
  selector:
    matchLabels:
      app: {{ .config.Name }}
  template:
    metadata:
      labels:
        app: {{ .config.Name }}
        flexdeck.io/model-id: {{ .model.ID }}
    spec:
      containers:
      - name: model-server
        image: {{ .config.Image }}
        ports:
        - containerPort: {{ .config.Port }}
          name: http
        env:
        - name: MODEL_PATH
          value: "{{ .config.ModelPath }}"
        {{- if .config.MaxModelLen }}
        - name: MAX_MODEL_LEN
          value: "{{ .config.MaxModelLen }}"
        {{- end }}
        {{- if .config.TensorParallel }}
        - name: TENSOR_PARALLEL_SIZE
          value: "{{ .config.TensorParallel }}"
        {{- end }}
        {{- range $key, $value := .config.Env }}
        - name: {{ $key }}
          value: "{{ $value }}"
        {{- end }}
        resources:
          requests:
            {{- if .config.Resources.CPURequest }}
            cpu: "{{ .config.Resources.CPURequest }}"
            {{- else }}
            cpu: "1"
            {{- end }}
            {{- if .config.Resources.MemoryRequest }}
            memory: "{{ .config.Resources.MemoryRequest }}"
            {{- else }}
            memory: "8Gi"
            {{- end }}
            {{- if .config.GPUCount }}
            {{ .config.GPUType }}: {{ .config.GPUCount }}
            {{- end }}
          limits:
            {{- if .config.Resources.CPULimit }}
            cpu: "{{ .config.Resources.CPULimit }}"
            {{- else }}
            cpu: "4"
            {{- end }}
            {{- if .config.Resources.MemoryLimit }}
            memory: "{{ .config.Resources.MemoryLimit }}"
            {{- else }}
            memory: "32Gi"
            {{- end }}
            {{- if .config.GPUCount }}
            {{ .config.GPUType }}: {{ .config.GPUCount }}
            {{- end }}
        readinessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 30
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 60
          periodSeconds: 30
        volumeMounts:
        - name: model-storage
          mountPath: /models
        - name: shm
          mountPath: /dev/shm
      volumes:
      - name: model-storage
        persistentVolumeClaim:
          claimName: model-storage
      - name: shm
        emptyDir:
          medium: Memory
          sizeLimit: 8Gi
`

const serviceTemplate = `apiVersion: v1
kind: Service
metadata:
  name: {{ .config.Name }}
  namespace: {{ .config.Namespace }}
  labels:
    app: {{ .config.Name }}
    flexdeck.io/model-id: {{ .model.ID }}
spec:
  selector:
    app: {{ .config.Name }}
  ports:
  - name: http
    port: 80
    targetPort: {{ .config.Port }}
  type: ClusterIP
`

const kustomizationTemplate = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

namespace: {{ .config.Namespace }}

resources:
- deployment.yaml
- service.yaml

commonLabels:
  app.kubernetes.io/managed-by: flexdeck
  flexdeck.io/model-id: {{ .model.ID }}
`
