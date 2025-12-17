package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
)

// Public API handlers expose sanitized, read-only data for the public portfolio site.
// These endpoints intentionally exclude sensitive information like:
// - Real hostnames and IP addresses
// - Pod/deployment names with hashes
// - Logs and traces
// - Secrets and environment variables
// - Internal service endpoints

// =============================================================================
// PUBLIC TOPOLOGY - Sanitized K8s cluster view
// =============================================================================

type PublicNode struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Type     string   `json:"type"` // "control-plane", "worker", "gpu-worker"
	Status   string   `json:"status"`
	Roles    []string `json:"roles"`
	Capacity struct {
		CPU    string `json:"cpu"`
		Memory string `json:"memory"`
		GPU    string `json:"gpu,omitempty"`
	} `json:"capacity"`
}

type PublicPod struct {
	ID        string `json:"id"`
	Name      string `json:"name"` // Sanitized: "llm-server", not "llm-server-7d8f9c-abc123"
	Namespace string `json:"namespace"`
	NodeID    string `json:"nodeId"`
	Status    string `json:"status"`
	Category  string `json:"category"` // "ai", "infra", "app", "monitoring"
}

type PublicService struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"` // "ClusterIP", "LoadBalancer", etc
	Category string `json:"category"`
}

type PublicTopologyResponse struct {
	Nodes      []PublicNode    `json:"nodes"`
	Pods       []PublicPod     `json:"pods"`
	Services   []PublicService `json:"services"`
	UpdatedAt  string          `json:"updatedAt"`
	ClusterAge string          `json:"clusterAge"` // "2+ years" etc
}

// sanitizeNodeName converts real node names to generic display names
func sanitizeNodeName(realName string) string {
	lower := strings.ToLower(realName)

	// Detect node type from common patterns
	if strings.Contains(lower, "control") || strings.Contains(lower, "master") {
		return "control-plane"
	}
	if strings.Contains(lower, "gpu") || strings.Contains(lower, "7900") || strings.Contains(lower, "nvidia") {
		return "gpu-worker"
	}
	if strings.Contains(lower, "worker") || strings.Contains(lower, "w-") {
		// Generate consistent but anonymous worker name
		hash := sha256.Sum256([]byte(realName))
		return fmt.Sprintf("worker-%s", hex.EncodeToString(hash[:])[:4])
	}

	// Fallback: generic node name based on hash
	hash := sha256.Sum256([]byte(realName))
	return fmt.Sprintf("node-%s", hex.EncodeToString(hash[:])[:4])
}

// sanitizePodName strips the random suffixes from pod names
func sanitizePodName(realName string) string {
	// Common patterns: name-hash-hash, name-hash
	// Remove UUID-like suffixes and ReplicaSet hashes
	re := regexp.MustCompile(`-[a-f0-9]{8,10}(-[a-z0-9]{5})?$`)
	cleaned := re.ReplaceAllString(realName, "")

	// Also handle statefulset names like pod-0, pod-1
	reStateful := regexp.MustCompile(`-\d+$`)
	cleaned = reStateful.ReplaceAllString(cleaned, "")

	return cleaned
}

// categorizePod determines the category based on namespace and name
func categorizePod(namespace, name string) string {
	ns := strings.ToLower(namespace)
	n := strings.ToLower(name)

	switch {
	case ns == "ai" || strings.Contains(n, "llm") || strings.Contains(n, "vllm") ||
		strings.Contains(n, "model") || strings.Contains(n, "inference"):
		return "ai"
	case ns == "monitoring" || ns == "logging" || strings.Contains(n, "prometheus") ||
		strings.Contains(n, "grafana") || strings.Contains(n, "loki"):
		return "monitoring"
	case ns == "flux-system" || ns == "kube-system" || ns == "cert-manager" ||
		ns == "ingress-nginx" || ns == "longhorn-system":
		return "infra"
	default:
		return "app"
	}
}

// detectNodeType determines node type from labels/name
func detectNodeType(name string, roles []string) string {
	for _, role := range roles {
		if role == "control-plane" || role == "master" {
			return "control-plane"
		}
	}
	lower := strings.ToLower(name)
	if strings.Contains(lower, "gpu") || strings.Contains(lower, "7900") {
		return "gpu-worker"
	}
	return "worker"
}

func (h *Handler) PublicTopology(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		// Return demo data if K8s is disabled
		respondJSON(w, http.StatusOK, getPublicTopologyDemo())
		return
	}

	ctx := r.Context()

	// Fetch real data
	nodes, err := h.k8s.GetNodes(ctx)
	if err != nil {
		slog.Error("failed to fetch nodes for public API", "error", err)
		respondJSON(w, http.StatusOK, getPublicTopologyDemo())
		return
	}

	pods, err := h.k8s.GetPods(ctx, "")
	if err != nil {
		slog.Error("failed to fetch pods for public API", "error", err)
		respondJSON(w, http.StatusOK, getPublicTopologyDemo())
		return
	}

	services, err := h.k8s.GetServices(ctx, "")
	if err != nil {
		slog.Error("failed to fetch services for public API", "error", err)
		respondJSON(w, http.StatusOK, getPublicTopologyDemo())
		return
	}

	// Transform to public format with sanitization
	publicNodes := make([]PublicNode, 0, len(nodes.Items))
	nodeIDMap := make(map[string]string) // real name -> public ID

	for i, node := range nodes.Items {
		roles := []string{}
		nodeType := "worker"
		nodeName := node.Name

		// Extract roles from labels
		for labelKey := range node.Labels {
			if strings.Contains(labelKey, "node-role.kubernetes.io/") {
				role := strings.TrimPrefix(labelKey, "node-role.kubernetes.io/")
				roles = append(roles, role)
				if role == "control-plane" || role == "master" {
					nodeType = "control-plane"
				}
			}
		}

		if strings.Contains(strings.ToLower(nodeName), "gpu") ||
			strings.Contains(strings.ToLower(nodeName), "7900") {
			nodeType = "gpu-worker"
		}

		publicID := fmt.Sprintf("node-%d", i+1)
		nodeIDMap[nodeName] = publicID

		// Get node status
		nodeStatus := "Unknown"
		for _, cond := range node.Status.Conditions {
			if cond.Type == corev1.NodeReady {
				if cond.Status == corev1.ConditionTrue {
					nodeStatus = "Ready"
				} else {
					nodeStatus = "NotReady"
				}
				break
			}
		}

		pNode := PublicNode{
			ID:     publicID,
			Name:   sanitizeNodeName(nodeName),
			Type:   nodeType,
			Status: nodeStatus,
			Roles:  roles,
		}
		pNode.Capacity.CPU = node.Status.Capacity.Cpu().String()
		pNode.Capacity.Memory = node.Status.Capacity.Memory().String()

		publicNodes = append(publicNodes, pNode)
	}

	// Transform pods
	publicPods := make([]PublicPod, 0)
	// Limit to avoid overwhelming the visualization
	maxPods := 50
	podCount := 0

	for _, pod := range pods.Items {
		if podCount >= maxPods {
			break
		}

		// Skip system pods that aren't interesting
		if pod.Namespace == "kube-system" && !strings.Contains(pod.Name, "coredns") {
			continue
		}

		nodeID := nodeIDMap[pod.Spec.NodeName]
		if nodeID == "" {
			nodeID = "unknown"
		}

		// Generate consistent pod ID from namespace + sanitized name
		sanitizedName := sanitizePodName(pod.Name)
		hash := sha256.Sum256([]byte(pod.Namespace + "/" + sanitizedName))
		podID := fmt.Sprintf("pod-%s", hex.EncodeToString(hash[:])[:8])

		publicPods = append(publicPods, PublicPod{
			ID:        podID,
			Name:      sanitizedName,
			Namespace: pod.Namespace,
			NodeID:    nodeID,
			Status:    string(pod.Status.Phase),
			Category:  categorizePod(pod.Namespace, pod.Name),
		})
		podCount++
	}

	// Transform services
	publicServices := make([]PublicService, 0)
	maxServices := 30

	for i, svc := range services.Items {
		if i >= maxServices {
			break
		}

		hash := sha256.Sum256([]byte(svc.Namespace + "/" + svc.Name))
		svcID := fmt.Sprintf("svc-%s", hex.EncodeToString(hash[:])[:8])

		publicServices = append(publicServices, PublicService{
			ID:       svcID,
			Name:     svc.Name, // Service names are usually fine
			Type:     string(svc.Spec.Type),
			Category: categorizePod(svc.Namespace, svc.Name),
		})
	}

	resp := PublicTopologyResponse{
		Nodes:      publicNodes,
		Pods:       publicPods,
		Services:   publicServices,
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
		ClusterAge: "2+ years",
	}

	respondJSON(w, http.StatusOK, resp)
}

// getPublicTopologyDemo returns demo data when K8s is unavailable
func getPublicTopologyDemo() PublicTopologyResponse {
	return PublicTopologyResponse{
		Nodes: []PublicNode{
			{ID: "node-1", Name: "control-plane", Type: "control-plane", Status: "Ready", Roles: []string{"control-plane"},
				Capacity: struct {
					CPU    string `json:"cpu"`
					Memory string `json:"memory"`
					GPU    string `json:"gpu,omitempty"`
				}{CPU: "8", Memory: "32Gi"}},
			{ID: "node-2", Name: "gpu-worker", Type: "gpu-worker", Status: "Ready", Roles: []string{"worker"},
				Capacity: struct {
					CPU    string `json:"cpu"`
					Memory string `json:"memory"`
					GPU    string `json:"gpu,omitempty"`
				}{CPU: "16", Memory: "64Gi", GPU: "1"}},
			{ID: "node-3", Name: "worker-a1b2", Type: "worker", Status: "Ready", Roles: []string{"worker"},
				Capacity: struct {
					CPU    string `json:"cpu"`
					Memory string `json:"memory"`
					GPU    string `json:"gpu,omitempty"`
				}{CPU: "4", Memory: "16Gi"}},
		},
		Pods: []PublicPod{
			{ID: "pod-001", Name: "llm-server", Namespace: "ai", NodeID: "node-2", Status: "Running", Category: "ai"},
			{ID: "pod-002", Name: "vllm-inference", Namespace: "ai", NodeID: "node-2", Status: "Running", Category: "ai"},
			{ID: "pod-003", Name: "prometheus", Namespace: "monitoring", NodeID: "node-3", Status: "Running", Category: "monitoring"},
			{ID: "pod-004", Name: "grafana", Namespace: "monitoring", NodeID: "node-3", Status: "Running", Category: "monitoring"},
			{ID: "pod-005", Name: "flexinfer-site", Namespace: "flexinfer", NodeID: "node-3", Status: "Running", Category: "app"},
			{ID: "pod-006", Name: "ingress-nginx", Namespace: "ingress-nginx", NodeID: "node-1", Status: "Running", Category: "infra"},
		},
		Services: []PublicService{
			{ID: "svc-001", Name: "llm-api", Type: "ClusterIP", Category: "ai"},
			{ID: "svc-002", Name: "prometheus", Type: "ClusterIP", Category: "monitoring"},
			{ID: "svc-003", Name: "grafana", Type: "ClusterIP", Category: "monitoring"},
		},
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
		ClusterAge: "2+ years",
	}
}

// =============================================================================
// PUBLIC CI STATUS - Pipeline visibility without logs/secrets
// =============================================================================

type PublicCIJob struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Stage    string  `json:"stage"`
	Status   string  `json:"status"` // "success", "failed", "running", "pending", "skipped"
	Duration float64 `json:"duration"`
}

type PublicCIStage struct {
	Name   string        `json:"name"`
	Status string        `json:"status"`
	Jobs   []PublicCIJob `json:"jobs"`
}

type PublicCIPipeline struct {
	ID        string          `json:"id"`
	Project   string          `json:"project"` // Sanitized project name
	Ref       string          `json:"ref"`     // Branch name (these are usually fine)
	Status    string          `json:"status"`
	Stages    []PublicCIStage `json:"stages"`
	CreatedAt string          `json:"createdAt"`
	Duration  float64         `json:"duration"`
}

type PublicCIResponse struct {
	Pipelines []PublicCIPipeline `json:"pipelines"`
	UpdatedAt string             `json:"updatedAt"`
}

// sanitizeProjectName keeps project names generic
func sanitizeProjectName(fullPath string) string {
	// Extract just the project name from path
	parts := strings.Split(fullPath, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return "project"
}

func (h *Handler) PublicCIStatus(w http.ResponseWriter, r *http.Request) {
	gitlabURL := h.cfg.GitLab.URL
	token := h.cfg.GitLab.Token

	if token == "" {
		// Return demo data if GitLab is not configured
		respondJSON(w, http.StatusOK, getPublicCIDemo())
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}

	// Fetch projects
	apiURL := fmt.Sprintf("%s/api/v4/projects?membership=true&simple=true&per_page=5", gitlabURL)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		slog.Error("failed to create GitLab request", "error", err)
		respondJSON(w, http.StatusOK, getPublicCIDemo())
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		slog.Error("failed to fetch GitLab projects", "error", err)
		respondJSON(w, http.StatusOK, getPublicCIDemo())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respondJSON(w, http.StatusOK, getPublicCIDemo())
		return
	}

	var projects []struct {
		ID                int    `json:"id"`
		PathWithNamespace string `json:"path_with_namespace"`
		DefaultBranch     string `json:"default_branch"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&projects); err != nil {
		respondJSON(w, http.StatusOK, getPublicCIDemo())
		return
	}

	// Fetch latest pipeline for each project
	pipelines := make([]PublicCIPipeline, 0)

	for _, proj := range projects {
		// Get latest pipeline
		pipelineURL := fmt.Sprintf("%s/api/v4/projects/%d/pipelines?per_page=1", gitlabURL, proj.ID)
		pReq, _ := http.NewRequest("GET", pipelineURL, nil)
		pReq.Header.Set("PRIVATE-TOKEN", token)

		pResp, err := client.Do(pReq)
		if err != nil || pResp.StatusCode != http.StatusOK {
			if pResp != nil {
				pResp.Body.Close()
			}
			continue
		}

		var pipelineList []struct {
			ID        int       `json:"id"`
			Status    string    `json:"status"`
			Ref       string    `json:"ref"`
			CreatedAt time.Time `json:"created_at"`
		}
		if err := json.NewDecoder(pResp.Body).Decode(&pipelineList); err != nil || len(pipelineList) == 0 {
			pResp.Body.Close()
			continue
		}
		pResp.Body.Close()

		pipeline := pipelineList[0]

		// Get jobs for this pipeline
		jobsURL := fmt.Sprintf("%s/api/v4/projects/%d/pipelines/%d/jobs", gitlabURL, proj.ID, pipeline.ID)
		jReq, _ := http.NewRequest("GET", jobsURL, nil)
		jReq.Header.Set("PRIVATE-TOKEN", token)

		jResp, err := client.Do(jReq)
		if err != nil || jResp.StatusCode != http.StatusOK {
			if jResp != nil {
				jResp.Body.Close()
			}
			continue
		}

		var jobs []struct {
			ID       int     `json:"id"`
			Name     string  `json:"name"`
			Stage    string  `json:"stage"`
			Status   string  `json:"status"`
			Duration float64 `json:"duration"`
		}
		json.NewDecoder(jResp.Body).Decode(&jobs)
		jResp.Body.Close()

		// Group jobs by stage
		stageMap := make(map[string][]PublicCIJob)
		stageOrder := []string{}
		stageStatus := make(map[string]string)

		for _, j := range jobs {
			if _, exists := stageMap[j.Stage]; !exists {
				stageMap[j.Stage] = []PublicCIJob{}
				stageOrder = append(stageOrder, j.Stage)
				stageStatus[j.Stage] = "success"
			}

			stageMap[j.Stage] = append(stageMap[j.Stage], PublicCIJob{
				ID:       fmt.Sprintf("%d", j.ID),
				Name:     j.Name,
				Stage:    j.Stage,
				Status:   j.Status,
				Duration: j.Duration,
			})

			// Update stage status (failed > running > pending > success)
			if j.Status == "failed" {
				stageStatus[j.Stage] = "failed"
			} else if j.Status == "running" && stageStatus[j.Stage] != "failed" {
				stageStatus[j.Stage] = "running"
			} else if j.Status == "pending" && stageStatus[j.Stage] == "success" {
				stageStatus[j.Stage] = "pending"
			}
		}

		stages := make([]PublicCIStage, 0, len(stageOrder))
		for _, stageName := range stageOrder {
			stages = append(stages, PublicCIStage{
				Name:   stageName,
				Status: stageStatus[stageName],
				Jobs:   stageMap[stageName],
			})
		}

		var totalDuration float64
		for _, j := range jobs {
			totalDuration += j.Duration
		}

		pipelines = append(pipelines, PublicCIPipeline{
			ID:        fmt.Sprintf("%d", pipeline.ID),
			Project:   sanitizeProjectName(proj.PathWithNamespace),
			Ref:       pipeline.Ref,
			Status:    pipeline.Status,
			Stages:    stages,
			CreatedAt: pipeline.CreatedAt.Format(time.RFC3339),
			Duration:  totalDuration,
		})
	}

	respondJSON(w, http.StatusOK, PublicCIResponse{
		Pipelines: pipelines,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	})
}

// getPublicCIDemo returns demo pipeline data
func getPublicCIDemo() PublicCIResponse {
	return PublicCIResponse{
		Pipelines: []PublicCIPipeline{
			{
				ID:      "demo-1",
				Project: "flexdeck",
				Ref:     "main",
				Status:  "success",
				Stages: []PublicCIStage{
					{Name: "build", Status: "success", Jobs: []PublicCIJob{
						{ID: "1", Name: "docker_build", Stage: "build", Status: "success", Duration: 45.5},
					}},
					{Name: "test", Status: "success", Jobs: []PublicCIJob{
						{ID: "2", Name: "unit_tests", Stage: "test", Status: "success", Duration: 12.3},
						{ID: "3", Name: "lint", Stage: "test", Status: "success", Duration: 8.1},
					}},
					{Name: "deploy", Status: "success", Jobs: []PublicCIJob{
						{ID: "4", Name: "deploy_k8s", Stage: "deploy", Status: "success", Duration: 22.7},
					}},
				},
				CreatedAt: time.Now().Add(-1 * time.Hour).Format(time.RFC3339),
				Duration:  88.6,
			},
			{
				ID:      "demo-2",
				Project: "flexinfer-site",
				Ref:     "main",
				Status:  "running",
				Stages: []PublicCIStage{
					{Name: "verify", Status: "success", Jobs: []PublicCIJob{
						{ID: "5", Name: "lint_code", Stage: "verify", Status: "success", Duration: 15.2},
						{ID: "6", Name: "unit_tests", Stage: "verify", Status: "success", Duration: 25.8},
					}},
					{Name: "build", Status: "running", Jobs: []PublicCIJob{
						{ID: "7", Name: "build_app", Stage: "build", Status: "running", Duration: 0},
					}},
					{Name: "docker-build", Status: "pending", Jobs: []PublicCIJob{
						{ID: "8", Name: "docker_build", Stage: "docker-build", Status: "pending", Duration: 0},
					}},
				},
				CreatedAt: time.Now().Add(-5 * time.Minute).Format(time.RFC3339),
				Duration:  41.0,
			},
		},
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
}

// =============================================================================
// PUBLIC METRICS SUMMARY - Aggregate stats only
// =============================================================================

type PublicMetricsSummary struct {
	Cluster struct {
		NodeCount   int     `json:"nodeCount"`
		PodCount    int     `json:"podCount"`
		CPUPercent  float64 `json:"cpuPercent"`
		MemPercent  float64 `json:"memPercent"`
		GPUCount    int     `json:"gpuCount"`
		GPUPercent  float64 `json:"gpuPercent"`
		HealthScore int     `json:"healthScore"` // 0-100
	} `json:"cluster"`
	AI struct {
		ModelsLoaded   int     `json:"modelsLoaded"`
		InferenceCount int     `json:"inferenceCount"`
		AvgLatencyMs   float64 `json:"avgLatencyMs"`
	} `json:"ai"`
	UpdatedAt string `json:"updatedAt"`
}

func (h *Handler) PublicMetricsSummary(w http.ResponseWriter, r *http.Request) {
	summary := PublicMetricsSummary{}
	summary.UpdatedAt = time.Now().UTC().Format(time.RFC3339)

	// Try to gather real metrics
	if h.k8s != nil {
		ctx := r.Context()
		if nodes, err := h.k8s.GetNodes(ctx); err == nil {
			summary.Cluster.NodeCount = len(nodes.Items)
			// Count GPU nodes
			for _, n := range nodes.Items {
				if strings.Contains(strings.ToLower(n.Name), "gpu") ||
					strings.Contains(strings.ToLower(n.Name), "7900") {
					summary.Cluster.GPUCount++
				}
			}
		}

		if pods, err := h.k8s.GetPods(ctx, ""); err == nil {
			runningCount := 0
			for _, p := range pods.Items {
				if p.Status.Phase == corev1.PodRunning {
					runningCount++
				}
			}
			summary.Cluster.PodCount = len(pods.Items)
			// Health score based on running pods ratio
			if len(pods.Items) > 0 {
				summary.Cluster.HealthScore = int(float64(runningCount) / float64(len(pods.Items)) * 100)
			}
		}
	}

	// Fill in demo values for metrics we can't easily expose
	if summary.Cluster.NodeCount == 0 {
		summary.Cluster.NodeCount = 5
		summary.Cluster.PodCount = 45
		summary.Cluster.GPUCount = 1
		summary.Cluster.HealthScore = 98
	}

	// These would require Prometheus queries - use reasonable demo values
	summary.Cluster.CPUPercent = 35.5
	summary.Cluster.MemPercent = 62.3
	summary.Cluster.GPUPercent = 78.2

	summary.AI.ModelsLoaded = 3
	summary.AI.InferenceCount = 1247
	summary.AI.AvgLatencyMs = 245.8

	respondJSON(w, http.StatusOK, summary)
}

// =============================================================================
// PUBLIC MODELS STATUS - What AI models are running
// =============================================================================

type PublicModelInfo struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Type       string `json:"type"` // "llm", "embedding", "image"
	Status     string `json:"status"`
	Parameters string `json:"parameters"` // "7B", "70B", etc
}

type PublicModelsResponse struct {
	Models    []PublicModelInfo `json:"models"`
	UpdatedAt string            `json:"updatedAt"`
}

func (h *Handler) PublicModelsStatus(w http.ResponseWriter, r *http.Request) {
	// For now, return a curated list of what's running
	// In the future, this could query vLLM or litellm for real model status
	models := []PublicModelInfo{
		{ID: "1", Name: "Qwen 2.5 72B", Type: "llm", Status: "running", Parameters: "72B"},
		{ID: "2", Name: "Mistral 7B", Type: "llm", Status: "running", Parameters: "7B"},
		{ID: "3", Name: "Nomic Embed", Type: "embedding", Status: "running", Parameters: "137M"},
	}

	respondJSON(w, http.StatusOK, PublicModelsResponse{
		Models:    models,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	})
}
