package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"

	"github.com/flexinfer/flexdeck/internal/models"
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
	Source     string          `json:"source"`     // "live" | "demo"
}

func publicAllowDemoFallback() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("PUBLIC_API_ALLOW_DEMO")))
	return v == "1" || v == "true" || v == "yes"
}

// sanitizeNodeName converts real node names to generic display names
func sanitizeNodeName(realName string, labels map[string]string, capacity corev1.ResourceList) string {
	lower := strings.ToLower(realName)
	hash := sha256.Sum256([]byte(realName))
	suffix := hex.EncodeToString(hash[:])[:4]

	// Most reliable: check GPU capacity/extended resources
	if capacity != nil {
		if q, ok := capacity[corev1.ResourceName("nvidia.com/gpu")]; ok && q.Value() > 0 {
			return fmt.Sprintf("gpu-worker-%s", suffix)
		}
		if q, ok := capacity[corev1.ResourceName("amd.com/gpu")]; ok && q.Value() > 0 {
			return fmt.Sprintf("gpu-worker-%s", suffix)
		}
	}

	// Check for GPU via labels first (most reliable)
	if labels != nil {
		// Common GPU node labels
		if _, ok := labels["nvidia.com/gpu.present"]; ok {
			return fmt.Sprintf("gpu-worker-%s", suffix)
		}
		if _, ok := labels["amd.com/gpu"]; ok {
			return fmt.Sprintf("gpu-worker-%s", suffix)
		}
		if v, ok := labels["node.kubernetes.io/instance-type"]; ok && strings.Contains(strings.ToLower(v), "gpu") {
			return fmt.Sprintf("gpu-worker-%s", suffix)
		}
		// Check for GPU capacity label
		if v, ok := labels["feature.node.kubernetes.io/pci-0300_1002.present"]; ok && v == "true" {
			// AMD GPU (vendor 1002)
			return fmt.Sprintf("gpu-worker-%s", suffix)
		}
		if v, ok := labels["feature.node.kubernetes.io/pci-0300_10de.present"]; ok && v == "true" {
			// NVIDIA GPU (vendor 10de)
			return fmt.Sprintf("gpu-worker-%s", suffix)
		}
	}

	// Detect node type from name patterns
	if strings.Contains(lower, "control") || strings.Contains(lower, "master") {
		return fmt.Sprintf("control-plane-%s", suffix)
	}
	if strings.Contains(lower, "gpu") || strings.Contains(lower, "7900") || strings.Contains(lower, "nvidia") || strings.Contains(lower, "amd") {
		return fmt.Sprintf("gpu-worker-%s", suffix)
	}
	if strings.Contains(lower, "worker") || strings.Contains(lower, "w-") {
		return fmt.Sprintf("worker-%s", suffix)
	}

	// Fallback: generic node name based on hash
	return fmt.Sprintf("node-%s", suffix)
}

// Package-level compiled regexes for pod name sanitization.
var (
	podHashRe     = regexp.MustCompile(`-[a-f0-9]{8,10}(-[a-z0-9]{5})?$`)
	podStatefulRe = regexp.MustCompile(`-\d+$`)
)

// sanitizePodName strips the random suffixes from pod names
func sanitizePodName(realName string) string {
	cleaned := podHashRe.ReplaceAllString(realName, "")
	cleaned = podStatefulRe.ReplaceAllString(cleaned, "")
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
func detectNodeType(name string, roles []string, labels map[string]string) string {
	for _, role := range roles {
		if role == "control-plane" || role == "master" {
			return "control-plane"
		}
	}

	// Check for GPU via labels (most reliable)
	if labels != nil {
		if _, ok := labels["nvidia.com/gpu.present"]; ok {
			return "gpu-worker"
		}
		if _, ok := labels["amd.com/gpu"]; ok {
			return "gpu-worker"
		}
		if v, ok := labels["feature.node.kubernetes.io/pci-0300_1002.present"]; ok && v == "true" {
			return "gpu-worker"
		}
		if v, ok := labels["feature.node.kubernetes.io/pci-0300_10de.present"]; ok && v == "true" {
			return "gpu-worker"
		}
	}

	lower := strings.ToLower(name)
	if strings.Contains(lower, "gpu") || strings.Contains(lower, "7900") || strings.Contains(lower, "nvidia") || strings.Contains(lower, "amd") {
		return "gpu-worker"
	}
	return "worker"
}

// hasGPU checks if a node has GPU capability via labels or name
func hasGPU(name string, labels map[string]string, capacity corev1.ResourceList) bool {
	if capacity != nil {
		if q, ok := capacity[corev1.ResourceName("nvidia.com/gpu")]; ok && q.Value() > 0 {
			return true
		}
		if q, ok := capacity[corev1.ResourceName("amd.com/gpu")]; ok && q.Value() > 0 {
			return true
		}
	}
	if labels != nil {
		if _, ok := labels["nvidia.com/gpu.present"]; ok {
			return true
		}
		if _, ok := labels["amd.com/gpu"]; ok {
			return true
		}
		if v, ok := labels["feature.node.kubernetes.io/pci-0300_1002.present"]; ok && v == "true" {
			return true
		}
		if v, ok := labels["feature.node.kubernetes.io/pci-0300_10de.present"]; ok && v == "true" {
			return true
		}
	}
	lower := strings.ToLower(name)
	return strings.Contains(lower, "gpu") || strings.Contains(lower, "7900") || strings.Contains(lower, "nvidia") || strings.Contains(lower, "amd")
}

func (h *Handler) PublicTopology(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		if publicAllowDemoFallback() {
			respondJSON(w, http.StatusOK, getPublicTopologyDemo())
			return
		}
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "k8s client unavailable",
		})
		return
	}

	ctx := r.Context()

	// Fetch real data
	nodes, err := h.k8s.GetNodes(ctx)
	if err != nil {
		slog.Error("failed to fetch nodes for public API", "error", err)
		if publicAllowDemoFallback() {
			respondJSON(w, http.StatusOK, getPublicTopologyDemo())
			return
		}
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "failed to fetch cluster nodes",
		})
		return
	}

	pods, err := h.k8s.GetPods(ctx, "")
	if err != nil {
		slog.Error("failed to fetch pods for public API", "error", err)
		if publicAllowDemoFallback() {
			respondJSON(w, http.StatusOK, getPublicTopologyDemo())
			return
		}
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "failed to fetch cluster pods",
		})
		return
	}

	services, err := h.k8s.GetServices(ctx, "")
	if err != nil {
		slog.Error("failed to fetch services for public API", "error", err)
		if publicAllowDemoFallback() {
			respondJSON(w, http.StatusOK, getPublicTopologyDemo())
			return
		}
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "failed to fetch cluster services",
		})
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

		// Check for GPU using the improved detection
		if hasGPU(nodeName, node.Labels, node.Status.Capacity) {
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
			Name:   sanitizeNodeName(nodeName, node.Labels, node.Status.Capacity),
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
	// Limit to avoid overwhelming the public visualization.
	// This is intentionally a sample, not a full pod inventory.
	maxPods := 200
	if v := strings.TrimSpace(os.Getenv("PUBLIC_TOPOLOGY_MAX_PODS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxPods = n
		}
	}

	// Bucket pods so the sample includes more than just the first namespace returned by the API.
	buckets := map[string][]corev1.Pod{
		"ai":         {},
		"app":        {},
		"monitoring": {},
		"infra":      {},
	}

	for _, pod := range pods.Items {
		// Skip system pods that aren't interesting
		if pod.Namespace == "kube-system" && !strings.Contains(pod.Name, "coredns") {
			continue
		}
		category := categorizePod(pod.Namespace, pod.Name)
		if _, ok := buckets[category]; !ok {
			category = "app"
		}
		buckets[category] = append(buckets[category], pod)
	}

	categoryOrder := []string{"ai", "app", "monitoring", "infra"}
	nextIdx := map[string]int{"ai": 0, "app": 0, "monitoring": 0, "infra": 0}

	for len(publicPods) < maxPods {
		madeProgress := false
		for _, category := range categoryOrder {
			i := nextIdx[category]
			if i >= len(buckets[category]) {
				continue
			}
			pod := buckets[category][i]
			nextIdx[category] = i + 1
			madeProgress = true

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
				Category:  category,
			})

			if len(publicPods) >= maxPods {
				break
			}
		}
		if !madeProgress {
			break
		}
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
		Source:     "live",
	}

	respondJSON(w, http.StatusOK, resp)
}

// getPublicTopologyDemo returns demo data when K8s is unavailable
func getPublicTopologyDemo() PublicTopologyResponse {
	return PublicTopologyResponse{
		Nodes: []PublicNode{
			{ID: "node-1", Name: "control-plane-a1b2", Type: "control-plane", Status: "Ready", Roles: []string{"control-plane"},
				Capacity: struct {
					CPU    string `json:"cpu"`
					Memory string `json:"memory"`
					GPU    string `json:"gpu,omitempty"`
				}{CPU: "8", Memory: "32Gi"}},
			{ID: "node-2", Name: "control-plane-c3d4", Type: "control-plane", Status: "Ready", Roles: []string{"control-plane"},
				Capacity: struct {
					CPU    string `json:"cpu"`
					Memory string `json:"memory"`
					GPU    string `json:"gpu,omitempty"`
				}{CPU: "8", Memory: "32Gi"}},
			{ID: "node-3", Name: "control-plane-e5f6", Type: "control-plane", Status: "Ready", Roles: []string{"control-plane"},
				Capacity: struct {
					CPU    string `json:"cpu"`
					Memory string `json:"memory"`
					GPU    string `json:"gpu,omitempty"`
				}{CPU: "8", Memory: "32Gi"}},
			{ID: "node-4", Name: "gpu-worker-7890", Type: "gpu-worker", Status: "Ready", Roles: []string{"worker"},
				Capacity: struct {
					CPU    string `json:"cpu"`
					Memory string `json:"memory"`
					GPU    string `json:"gpu,omitempty"`
				}{CPU: "16", Memory: "64Gi", GPU: "1"}},
			{ID: "node-5", Name: "gpu-worker-abcd", Type: "gpu-worker", Status: "Ready", Roles: []string{"worker"},
				Capacity: struct {
					CPU    string `json:"cpu"`
					Memory string `json:"memory"`
					GPU    string `json:"gpu,omitempty"`
				}{CPU: "16", Memory: "64Gi", GPU: "1"}},
			{ID: "node-6", Name: "worker-a1b2", Type: "worker", Status: "Ready", Roles: []string{"worker"},
				Capacity: struct {
					CPU    string `json:"cpu"`
					Memory string `json:"memory"`
					GPU    string `json:"gpu,omitempty"`
				}{CPU: "4", Memory: "16Gi"}},
		},
		Pods: []PublicPod{
			{ID: "pod-001", Name: "llm-server", Namespace: "ai", NodeID: "node-4", Status: "Running", Category: "ai"},
			{ID: "pod-002", Name: "vllm-inference", Namespace: "ai", NodeID: "node-5", Status: "Running", Category: "ai"},
			{ID: "pod-003", Name: "prometheus", Namespace: "monitoring", NodeID: "node-6", Status: "Running", Category: "monitoring"},
			{ID: "pod-004", Name: "grafana", Namespace: "monitoring", NodeID: "node-6", Status: "Running", Category: "monitoring"},
			{ID: "pod-005", Name: "flexinfer-site", Namespace: "flexinfer", NodeID: "node-6", Status: "Running", Category: "app"},
			{ID: "pod-006", Name: "ingress-nginx", Namespace: "ingress-nginx", NodeID: "node-1", Status: "Running", Category: "infra"},
			{ID: "pod-007", Name: "coredns", Namespace: "kube-system", NodeID: "node-2", Status: "Running", Category: "infra"},
			{ID: "pod-008", Name: "etcd", Namespace: "kube-system", NodeID: "node-3", Status: "Running", Category: "infra"},
		},
		Services: []PublicService{
			{ID: "svc-001", Name: "llm-api", Type: "ClusterIP", Category: "ai"},
			{ID: "svc-002", Name: "prometheus", Type: "ClusterIP", Category: "monitoring"},
			{ID: "svc-003", Name: "grafana", Type: "ClusterIP", Category: "monitoring"},
		},
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
		ClusterAge: "2+ years",
		Source:     "demo",
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
	ID         string          `json:"id"`
	Project    string          `json:"project"` // Sanitized project name
	Ref        string          `json:"ref"`     // Branch name (these are usually fine)
	Status     string          `json:"status"`
	Visibility string          `json:"visibility"` // "public", "internal", "private"
	Stages     []PublicCIStage `json:"stages"`
	CreatedAt  string          `json:"createdAt"`
	Duration   float64         `json:"duration"`
}

type PublicCIResponse struct {
	Pipelines []PublicCIPipeline `json:"pipelines"`
	UpdatedAt string             `json:"updatedAt"`
	Source    string             `json:"source"` // "live" | "demo"
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
		if publicAllowDemoFallback() {
			respondJSON(w, http.StatusOK, getPublicCIDemo())
			return
		}
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "gitlab token not configured",
		})
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}

	// Fetch projects (order by recent activity, exclude forks)
	apiURL := fmt.Sprintf("%s/api/v4/projects?simple=true&per_page=5&order_by=last_activity_at", gitlabURL)
	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		slog.Error("failed to create GitLab request", "error", err)
		if publicAllowDemoFallback() {
			respondJSON(w, http.StatusOK, getPublicCIDemo())
			return
		}
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "failed to create gitlab request",
		})
		return
	}
	req.Header.Set("PRIVATE-TOKEN", token)

	resp, err := client.Do(req)
	if err != nil {
		slog.Error("failed to fetch GitLab projects", "error", err)
		if publicAllowDemoFallback() {
			respondJSON(w, http.StatusOK, getPublicCIDemo())
			return
		}
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "failed to fetch gitlab projects",
		})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if publicAllowDemoFallback() {
			respondJSON(w, http.StatusOK, getPublicCIDemo())
			return
		}
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": fmt.Sprintf("gitlab returned %d", resp.StatusCode),
		})
		return
	}

	var projects []struct {
		ID                int    `json:"id"`
		PathWithNamespace string `json:"path_with_namespace"`
		DefaultBranch     string `json:"default_branch"`
		Visibility        string `json:"visibility"` // "public", "internal", "private"
	}
	if err := json.NewDecoder(resp.Body).Decode(&projects); err != nil {
		if publicAllowDemoFallback() {
			respondJSON(w, http.StatusOK, getPublicCIDemo())
			return
		}
		respondJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error": "failed to decode gitlab project list",
		})
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
			ID:         fmt.Sprintf("%d", pipeline.ID),
			Project:    sanitizeProjectName(proj.PathWithNamespace),
			Ref:        pipeline.Ref,
			Status:     pipeline.Status,
			Visibility: proj.Visibility,
			Stages:     stages,
			CreatedAt:  pipeline.CreatedAt.Format(time.RFC3339),
			Duration:   totalDuration,
		})
	}

	respondJSON(w, http.StatusOK, PublicCIResponse{
		Pipelines: pipelines,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
		Source:    "live",
	})
}

// getPublicCIDemo returns demo pipeline data
func getPublicCIDemo() PublicCIResponse {
	return PublicCIResponse{
		Pipelines: []PublicCIPipeline{
			{
				ID:         "demo-1",
				Project:    "flexdeck",
				Ref:        "main",
				Status:     "success",
				Visibility: "public",
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
				ID:         "demo-2",
				Project:    "flexinfer-site",
				Ref:        "main",
				Status:     "running",
				Visibility: "public",
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
		Source:    "demo",
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
	Source    string `json:"source"` // "live" | "demo" | "mixed"
}

func (h *Handler) PublicMetricsSummary(w http.ResponseWriter, r *http.Request) {
	summary := PublicMetricsSummary{}
	summary.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	summary.Source = "mixed"

	// Try to gather real metrics
	if h.k8s != nil {
		ctx := r.Context()
		if nodes, err := h.k8s.GetNodes(ctx); err == nil {
			summary.Cluster.NodeCount = len(nodes.Items)
			// Count GPU nodes using improved detection
			for _, n := range nodes.Items {
				if hasGPU(n.Name, n.Labels, n.Status.Capacity) {
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

	if summary.Cluster.NodeCount > 0 || summary.Cluster.PodCount > 0 {
		summary.Source = "live"
	}

	// These would require Prometheus queries - use reasonable demo values
	summary.Cluster.CPUPercent = 35.5
	summary.Cluster.MemPercent = 62.3
	summary.Cluster.GPUPercent = 78.2

	// AI metrics: prefer real sources when available
	if h.modelsRegistry != nil {
		for _, m := range h.modelsRegistry.List() {
			if m.DeploymentStatus == models.DeploymentDeployed {
				summary.AI.ModelsLoaded++
			}
		}
	}

	if h.metricsStore != nil {
		ctx := r.Context()
		throughput, err := h.metricsStore.GetThroughput(ctx)
		if err == nil && len(throughput) > 0 {
			var totalReqPerMin float64
			var latencyWeighted float64
			for _, t := range throughput {
				totalReqPerMin += t.RequestsPerMin
				latencyWeighted += t.AvgLatencyMs * t.RequestsPerMin
			}
			if totalReqPerMin > 0 {
				summary.AI.InferenceCount = int(totalReqPerMin + 0.5) // requests/min as an integer
				summary.AI.AvgLatencyMs = latencyWeighted / totalReqPerMin
			}
			if summary.AI.ModelsLoaded == 0 {
				summary.AI.ModelsLoaded = len(throughput)
			}
		}
	}

	respondJSON(w, http.StatusOK, summary)
}

// =============================================================================
// PUBLIC MODELS STATUS - What AI models are running
// =============================================================================

type PublicModelInfo struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Type       string   `json:"type"` // "llm", "embedding", "image"
	Status     string   `json:"status"`
	Parameters string   `json:"parameters"` // "7B", "70B", etc
	Engine     string   `json:"engine,omitempty"`
	Hardware   string   `json:"hardware,omitempty"`
	Aliases    []string `json:"aliases,omitempty"`
}

type PublicModelsResponse struct {
	Models    []PublicModelInfo `json:"models"`
	UpdatedAt string            `json:"updatedAt"`
	Source    string            `json:"source"` // "live" | "demo"
}

func (h *Handler) PublicModelsStatus(w http.ResponseWriter, r *http.Request) {
	now := time.Now().UTC().Format(time.RFC3339)

	// Prefer the local models registry when available (reflects actual deployments)
	if h.modelsRegistry != nil {
		items := h.modelsRegistry.List()
		out := make([]PublicModelInfo, 0, len(items))

		for _, m := range items {
			if m == nil {
				continue
			}

			modelType := "llm"
			switch m.Type {
			case models.TypeEmbedding:
				modelType = "embedding"
			case models.TypeDiffusion:
				modelType = "image"
			}

			status := "unknown"
			switch m.DeploymentStatus {
			case models.DeploymentDeployed:
				status = "running"
			case models.DeploymentPending:
				status = "pending"
			case models.DeploymentStopped:
				status = "stopped"
			case models.DeploymentFailed:
				status = "failed"
			default:
				// Keep "unknown" (e.g. not deployed yet)
			}

			out = append(out, PublicModelInfo{
				ID:         m.ID,
				Name:       m.Name,
				Type:       modelType,
				Status:     status,
				Parameters: inferModelParameters(m),
				Engine:     inferModelEngine(m),
				Hardware:   inferModelHardware(m),
				Aliases:    inferModelAliases(m),
			})
		}

		respondJSON(w, http.StatusOK, PublicModelsResponse{
			Models:    out,
			UpdatedAt: now,
			Source:    "live",
		})
		return
	}

	// Next best: ask LiteLLM for its active model list (OpenAI-compatible).
	if h.litellm != nil {
		ctx := r.Context()
		modelIDs, err := h.litellm.ListModels(ctx)
		if err == nil && len(modelIDs) > 0 {
			out := make([]PublicModelInfo, 0, len(modelIDs))
			for _, id := range modelIDs {
				// Preserve the actual model id so the portfolio site can show stable keys.
				out = append(out, PublicModelInfo{
					ID:         id,
					Name:       id,
					Type:       "llm",
					Status:     "running",
					Parameters: inferModelParameters(&models.Model{Name: id}),
				})
			}
			respondJSON(w, http.StatusOK, PublicModelsResponse{
				Models:    out,
				UpdatedAt: now,
				Source:    "live",
			})
			return
		}
	}

	// Fallback: infer active models from LiteLLM metrics (if configured)
	if h.metricsStore != nil {
		ctx := r.Context()
		throughput, err := h.metricsStore.GetThroughput(ctx)
		if err == nil {
			out := make([]PublicModelInfo, 0, len(throughput))
			for i, t := range throughput {
				out = append(out, PublicModelInfo{
					ID:         fmt.Sprintf("m-%d", i+1),
					Name:       t.Model,
					Type:       "llm",
					Status:     "running",
					Parameters: "",
				})
			}
			respondJSON(w, http.StatusOK, PublicModelsResponse{
				Models:    out,
				UpdatedAt: now,
				Source:    "live",
			})
			return
		}
	}

	if publicAllowDemoFallback() {
		respondJSON(w, http.StatusOK, PublicModelsResponse{
			Models:    []PublicModelInfo{},
			UpdatedAt: now,
			Source:    "demo",
		})
		return
	}

	respondJSON(w, http.StatusServiceUnavailable, map[string]any{
		"error": "models status unavailable",
	})
}

func getModelMetadataString(m *models.Model, key string) string {
	if m == nil || m.Metadata == nil {
		return ""
	}
	v, ok := m.Metadata[key]
	if !ok || v == nil {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(s)
}

func parseAliases(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out = append(out, p)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func inferModelAliases(m *models.Model) []string {
	if m == nil || m.Metadata == nil {
		return nil
	}
	if v := getModelMetadataString(m, "aliases"); v != "" {
		return parseAliases(v)
	}
	// If upstream stored aliases as a slice, pass it through as-is.
	if raw, ok := m.Metadata["aliases"]; ok {
		if list, ok := raw.([]string); ok && len(list) > 0 {
			out := make([]string, 0, len(list))
			for _, a := range list {
				a = strings.TrimSpace(a)
				if a == "" {
					continue
				}
				out = append(out, a)
			}
			if len(out) > 0 {
				return out
			}
		}
		// json.Unmarshal into map[string]any yields []any for arrays.
		if list, ok := raw.([]any); ok && len(list) > 0 {
			out := make([]string, 0, len(list))
			for _, v := range list {
				s, ok := v.(string)
				if !ok {
					continue
				}
				s = strings.TrimSpace(s)
				if s == "" {
					continue
				}
				out = append(out, s)
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	return nil
}

func inferModelEngine(m *models.Model) string {
	if m == nil {
		return ""
	}

	// Prefer explicit engine, then backend (synced from k8s labels).
	engine := getModelMetadataString(m, "engine")
	if engine == "" {
		engine = getModelMetadataString(m, "backend")
	}

	// Heuristic fallback: infer from deployment or model name.
	if engine == "" {
		candidate := strings.ToLower(m.DeploymentName + " " + m.Name + " " + m.ID)
		switch {
		case strings.Contains(candidate, "vllm"):
			engine = "vllm"
		case strings.Contains(candidate, "tgi"):
			engine = "tgi"
		case strings.Contains(candidate, "ollama"):
			engine = "ollama"
		case strings.Contains(candidate, "llamacpp") || strings.Contains(candidate, "llama.cpp") || strings.Contains(candidate, "gguf"):
			engine = "llamacpp"
		case strings.Contains(candidate, "mlc"):
			engine = "mlc"
		case strings.Contains(candidate, "comfyui"):
			engine = "comfyui"
		case strings.Contains(candidate, "stable-diffusion") || strings.Contains(candidate, "sdxl"):
			engine = "stable-diffusion"
		}
	}

	// Normalize for display.
	switch strings.ToLower(strings.TrimSpace(engine)) {
	case "vllm":
		return "vLLM"
	case "tgi":
		return "TGI"
	case "ollama":
		return "Ollama"
	case "llamacpp", "llama.cpp":
		return "llama.cpp"
	case "mlc", "mlc-llm", "mlc_llm":
		return "MLC"
	case "tensorrt-llm", "tensorrtllm", "trt-llm", "trtllm":
		return "TensorRT-LLM"
	case "comfyui":
		return "ComfyUI"
	case "stable-diffusion", "sdxl":
		return "Stable Diffusion"
	default:
		return strings.TrimSpace(engine)
	}
}

func inferModelHardware(m *models.Model) string {
	if m == nil {
		return ""
	}
	if v := getModelMetadataString(m, "hardware"); v != "" {
		return v
	}

	// Best-effort mapping from gpu_group (if set by syncModelsFromK8s).
	if g := strings.ToLower(getModelMetadataString(m, "gpu_group")); g != "" {
		if strings.Contains(g, "7900") {
			return "AMD 7900 XTX"
		}
		if strings.Contains(g, "980") {
			return "NVIDIA GTX 980 Ti"
		}
		return strings.TrimSpace(g)
	}

	// If the node label was captured, do a lightweight mapping. Avoid emitting raw hostnames.
	if n := strings.ToLower(getModelMetadataString(m, "node")); n != "" {
		if strings.Contains(n, "7900") {
			return "AMD 7900 XTX"
		}
		if strings.Contains(n, "980") {
			return "NVIDIA GTX 980 Ti"
		}
	}

	return ""
}

func inferModelParameters(m *models.Model) string {
	if m == nil {
		return ""
	}

	// Look for common metadata keys
	if m.Metadata != nil {
		for _, key := range []string{"parameters", "params", "parameter_count", "param_count", "size_label"} {
			if v, ok := m.Metadata[key]; ok {
				switch vv := v.(type) {
				case string:
					if vv != "" {
						return vv
					}
				case float64:
					if vv > 0 {
						// Best-effort: treat as a raw count and abbreviate
						if vv >= 1_000_000_000 {
							return fmt.Sprintf("%.0fB", vv/1_000_000_000)
						}
						if vv >= 1_000_000 {
							return fmt.Sprintf("%.0fM", vv/1_000_000)
						}
						if vv >= 1_000 {
							return fmt.Sprintf("%.0fK", vv/1_000)
						}
						return fmt.Sprintf("%.0f", vv)
					}
				}
			}
		}
	}

	// Scan tags for parameter-like tokens (e.g. "7B", "72B", "137M")
	for _, tag := range m.Tags {
		if p := extractParamToken(tag); p != "" {
			return p
		}
	}
	if p := extractParamToken(m.Name); p != "" {
		return p
	}

	return ""
}

func extractParamToken(s string) string {
	re := regexp.MustCompile(`(?i)\b(\d+(?:\.\d+)?)([bmk])\b`)
	matches := re.FindStringSubmatch(s)
	if len(matches) != 3 {
		return ""
	}
	return strings.ToUpper(matches[1] + matches[2])
}
