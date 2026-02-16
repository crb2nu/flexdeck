package handlers

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/flexinfer/flexdeck/internal/api/handlers/apiutil"
	"github.com/flexinfer/flexdeck/internal/k8s"
)

func (h *Handler) K8sServices(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	cacheKey := fmt.Sprintf("k8s:services:%s", ns)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), cacheKey, 30*time.Second, func() (any, error) {
			return h.k8s.GetServices(r.Context(), ns)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	services, err := h.k8s.GetServices(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(services)
}

func (h *Handler) K8sNodes(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), "k8s:nodes", 15*time.Second, func() (any, error) {
			return h.k8s.GetNodes(r.Context())
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	nodes, err := h.k8s.GetNodes(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(nodes)
}

func (h *Handler) K8sDeployments(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	cacheKey := fmt.Sprintf("k8s:deployments:%s", ns)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), cacheKey, 15*time.Second, func() (any, error) {
			return h.k8s.GetDeployments(r.Context(), ns)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	deployments, err := h.k8s.GetDeployments(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(deployments)
}

func (h *Handler) K8sPods(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	cacheKey := fmt.Sprintf("k8s:pods:%s", ns)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), cacheKey, 10*time.Second, func() (any, error) {
			return h.k8s.GetPods(r.Context(), ns)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	pods, err := h.k8s.GetPods(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pods)
}

func (h *Handler) K8sIngresses(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	ingresses, err := h.k8s.GetIngresses(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ingresses)
}

func (h *Handler) K8sStatefulSets(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	statefulsets, err := h.k8s.GetStatefulSets(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(statefulsets)
}

func (h *Handler) K8sDaemonSets(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	daemonsets, err := h.k8s.GetDaemonSets(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(daemonsets)
}

func (h *Handler) K8sJobs(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	jobs, err := h.k8s.GetJobs(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

func (h *Handler) K8sCronJobs(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	cronjobs, err := h.k8s.GetCronJobs(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cronjobs)
}

func (h *Handler) K8sEvents(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	fieldSelector := r.URL.Query().Get("fieldSelector")
	events, err := h.k8s.GetEvents(r.Context(), ns, fieldSelector)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(events)
}

// K8sPodLogs returns logs for a specific pod
func (h *Handler) K8sPodLogs(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	opts := k8s.PodLogOptions{
		Container:  r.URL.Query().Get("container"),
		Previous:   r.URL.Query().Get("previous") == "true",
		Timestamps: r.URL.Query().Get("timestamps") == "true",
	}

	if tailStr := r.URL.Query().Get("tail"); tailStr != "" {
		tail, err := strconv.ParseInt(tailStr, 10, 64)
		if err == nil {
			opts.TailLines = &tail
		}
	}

	stream, err := h.k8s.GetPodLogs(r.Context(), ns, name, opts)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer stream.Close()

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	io.Copy(w, stream)
}

// K8sPodLogsSSE streams pod logs via Server-Sent Events
func (h *Handler) K8sPodLogsSSE(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	opts := k8s.PodLogOptions{
		Container:  r.URL.Query().Get("container"),
		Previous:   r.URL.Query().Get("previous") == "true",
		Timestamps: r.URL.Query().Get("timestamps") == "true",
		Follow:     true,
	}

	if tailStr := r.URL.Query().Get("tail"); tailStr != "" {
		tail, err := strconv.ParseInt(tailStr, 10, 64)
		if err == nil {
			opts.TailLines = &tail
		}
	}

	// Create cancellable context
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	stream, err := h.k8s.GetPodLogs(ctx, ns, name, opts)
	if err != nil {
		log.Printf("Failed to get pod logs: %v", err)
		fmt.Fprintf(w, "event: error\ndata: {\"error\":\"%s\"}\n\n", err.Error())
		flusher.Flush()
		return
	}
	defer stream.Close()

	// Send ready event
	fmt.Fprintf(w, "event: ready\ndata: {\"ok\":true}\n\n")
	flusher.Flush()

	// Handle client disconnect
	done := make(chan struct{})
	go func() {
		<-r.Context().Done()
		close(done)
		cancel()
	}()

	// Stream logs line by line
	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		select {
		case <-done:
			return
		default:
			line := scanner.Text()
			// Escape any special characters for SSE
			escapedLine := strings.ReplaceAll(line, "\n", "\\n")
			fmt.Fprintf(w, "event: log\ndata: %s\n\n", escapedLine)
			flusher.Flush()
		}
	}

	if err := scanner.Err(); err != nil {
		log.Printf("Error reading pod logs: %v", err)
	}
}

func (h *Handler) K8sScale(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")
	replicasStr := r.URL.Query().Get("replicas")

	replicas, err := strconv.ParseInt(replicasStr, 10, 32)
	if err != nil {
		http.Error(w, "invalid replicas parameter", http.StatusBadRequest)
		return
	}

	if err := h.k8s.ScaleDeployment(r.Context(), ns, name, int32(replicas)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":       true,
		"name":     name,
		"replicas": replicas,
	})
}

func (h *Handler) K8sRestart(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	if err := h.k8s.RestartDeployment(r.Context(), ns, name); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":   true,
		"name": name,
	})
}

// K8sNodeMetrics returns CPU and memory metrics for all nodes
func (h *Handler) K8sNodeMetrics(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		http.Error(w, "prometheus disabled", http.StatusServiceUnavailable)
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}

	// Query CPU usage per node
	cpuQuery := `100 - (avg by (node) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)`
	cpuURL := fmt.Sprintf("%s/api/v1/query?query=%s", h.cfg.Prom.URL, url.QueryEscape(cpuQuery))

	// Query memory usage per node
	memQuery := `(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100`
	memURL := fmt.Sprintf("%s/api/v1/query?query=%s", h.cfg.Prom.URL, url.QueryEscape(memQuery))

	// Fetch both in parallel
	type promResult struct {
		Data json.RawMessage `json:"data"`
		Err  error
	}

	cpuChan := make(chan promResult, 1)
	memChan := make(chan promResult, 1)

	go func() {
		resp, err := client.Get(cpuURL)
		if err != nil {
			cpuChan <- promResult{Err: err}
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		cpuChan <- promResult{Data: body}
	}()

	go func() {
		resp, err := client.Get(memURL)
		if err != nil {
			memChan <- promResult{Err: err}
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		memChan <- promResult{Data: body}
	}()

	cpuResult := <-cpuChan
	memResult := <-memChan

	if cpuResult.Err != nil {
		http.Error(w, cpuResult.Err.Error(), http.StatusBadGateway)
		return
	}
	if memResult.Err != nil {
		http.Error(w, memResult.Err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"cpu":    json.RawMessage(cpuResult.Data),
		"memory": json.RawMessage(memResult.Data),
	})
}

// K8sPodMetrics returns CPU and memory metrics for pods
func (h *Handler) K8sPodMetrics(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		http.Error(w, "prometheus disabled", http.StatusServiceUnavailable)
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}
	ns := r.URL.Query().Get("ns")

	// Build namespace filter if provided (escape to prevent PromQL injection)
	nsFilter := ""
	if ns != "" {
		nsFilter = fmt.Sprintf(`,namespace="%s"`, apiutil.EscapeLabelValue(ns))
	}

	// Query CPU usage per pod
	cpuQuery := fmt.Sprintf(`sum(rate(container_cpu_usage_seconds_total{container!=""%s}[5m])) by (pod, namespace) * 100`, nsFilter)
	cpuURL := fmt.Sprintf("%s/api/v1/query?query=%s", h.cfg.Prom.URL, url.QueryEscape(cpuQuery))

	// Query memory usage per pod
	memQuery := fmt.Sprintf(`sum(container_memory_working_set_bytes{container!=""%s}) by (pod, namespace)`, nsFilter)
	memURL := fmt.Sprintf("%s/api/v1/query?query=%s", h.cfg.Prom.URL, url.QueryEscape(memQuery))

	// Fetch both in parallel
	type promResult struct {
		Data json.RawMessage `json:"data"`
		Err  error
	}

	cpuChan := make(chan promResult, 1)
	memChan := make(chan promResult, 1)

	go func() {
		resp, err := client.Get(cpuURL)
		if err != nil {
			cpuChan <- promResult{Err: err}
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		cpuChan <- promResult{Data: body}
	}()

	go func() {
		resp, err := client.Get(memURL)
		if err != nil {
			memChan <- promResult{Err: err}
			return
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)
		memChan <- promResult{Data: body}
	}()

	cpuResult := <-cpuChan
	memResult := <-memChan

	if cpuResult.Err != nil {
		http.Error(w, cpuResult.Err.Error(), http.StatusBadGateway)
		return
	}
	if memResult.Err != nil {
		http.Error(w, memResult.Err.Error(), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"cpu":    json.RawMessage(cpuResult.Data),
		"memory": json.RawMessage(memResult.Data),
	})
}

// K8sGPUByModel returns GPU metrics correlated with flexinfer Model CRDs.
// It queries pods in the AI namespace with the flexinfer.ai/model label,
// determines which node each pod runs on, then queries GPU metrics for those nodes.
func (h *Handler) K8sGPUByModel(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}
	if h.cfg.Prom.Disabled || h.cfg.Prom.URL == "" {
		http.Error(w, "prometheus disabled", http.StatusServiceUnavailable)
		return
	}

	aiNS := strings.TrimSpace(h.cfg.Models.AINamespace)
	if aiNS == "" {
		aiNS = "ai"
	}

	cacheKey := fmt.Sprintf("k8s:gpu-by-model:%s", aiNS)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), cacheKey, 30*time.Second, func() (any, error) {
			return h.fetchGPUByModel(r.Context(), aiNS)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	result, err := h.fetchGPUByModel(r.Context(), aiNS)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

type modelGPUEntry struct {
	ModelID        string   `json:"modelId"`
	ModelName      string   `json:"modelName"`
	Node           string   `json:"node"`
	GPUUtilization *float64 `json:"gpuUtilization"`
	VRAMUsedPct    *float64 `json:"vramUsedPercent"`
	Temperature    *float64 `json:"temperature"`
	Power          *float64 `json:"power"`
}

func (h *Handler) fetchGPUByModel(ctx context.Context, namespace string) (map[string]any, error) {
	pods, err := h.k8s.GetPods(ctx, namespace)
	if err != nil {
		return nil, fmt.Errorf("list pods: %w", err)
	}

	// Collect pods that have the model label and are running on a node
	type podInfo struct {
		modelID   string
		modelName string
		node      string
	}
	var targets []podInfo
	for _, pod := range pods.Items {
		modelName := pod.Labels["flexinfer.ai/model"]
		if modelName == "" {
			continue
		}
		if pod.Spec.NodeName == "" {
			continue
		}
		targets = append(targets, podInfo{
			modelID:   string(pod.UID),
			modelName: modelName,
			node:      pod.Spec.NodeName,
		})
	}

	// Deduplicate nodes for GPU queries
	nodeSet := make(map[string]struct{})
	for _, t := range targets {
		nodeSet[t.node] = struct{}{}
	}

	client := &http.Client{Timeout: 15 * time.Second}

	// Query GPU metrics per unique node in parallel
	type nodeMetrics struct {
		utilization *float64
		vramPct     *float64
		temperature *float64
		power       *float64
	}

	nodeResults := make(map[string]*nodeMetrics)
	var mu sync.Mutex
	var wg sync.WaitGroup

	queryProm := func(query string) (*float64, error) {
		u := fmt.Sprintf("%s/api/v1/query?query=%s", h.cfg.Prom.URL, url.QueryEscape(query))
		resp, err := client.Get(u)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(resp.Body)

		var promResp struct {
			Data struct {
				Result []struct {
					Value []json.RawMessage `json:"value"`
				} `json:"result"`
			} `json:"data"`
		}
		if err := json.Unmarshal(body, &promResp); err != nil {
			return nil, nil
		}
		if len(promResp.Data.Result) == 0 {
			return nil, nil
		}
		var valStr string
		if err := json.Unmarshal(promResp.Data.Result[0].Value[1], &valStr); err != nil {
			return nil, nil
		}
		val, err := strconv.ParseFloat(valStr, 64)
		if err != nil {
			return nil, nil
		}
		return &val, nil
	}

	for node := range nodeSet {
		wg.Add(1)
		go func(node string) {
			defer wg.Done()
			nf := fmt.Sprintf(`instance=~".*%s.*"`, apiutil.EscapeLabelValue(node))

			// Try AMD first, then NVIDIA
			util, _ := queryProm(fmt.Sprintf(`amdgpu_gpu_busy_percent{%s}`, nf))
			if util == nil {
				util, _ = queryProm(fmt.Sprintf(`DCGM_FI_DEV_GPU_UTIL{%s}`, nf))
			}
			if util == nil {
				util, _ = queryProm(fmt.Sprintf(`nvidia_gpu_duty_cycle{%s}`, nf))
			}

			var vramPct *float64
			vramUsed, _ := queryProm(fmt.Sprintf(`amdgpu_vram_used_bytes{%s}`, nf))
			vramTotal, _ := queryProm(fmt.Sprintf(`amdgpu_vram_total_bytes{%s}`, nf))
			if vramUsed != nil && vramTotal != nil && *vramTotal > 0 {
				pct := (*vramUsed / *vramTotal) * 100
				vramPct = &pct
			} else {
				fbUsed, _ := queryProm(fmt.Sprintf(`DCGM_FI_DEV_FB_USED{%s}`, nf))
				fbFree, _ := queryProm(fmt.Sprintf(`DCGM_FI_DEV_FB_FREE{%s}`, nf))
				if fbUsed != nil && fbFree != nil && (*fbUsed+*fbFree) > 0 {
					pct := (*fbUsed / (*fbUsed + *fbFree)) * 100
					vramPct = &pct
				}
			}

			temp, _ := queryProm(fmt.Sprintf(`amdgpu_temperature_edge{%s}`, nf))
			if temp == nil {
				temp, _ = queryProm(fmt.Sprintf(`DCGM_FI_DEV_GPU_TEMP{%s}`, nf))
			}

			pwr, _ := queryProm(fmt.Sprintf(`amdgpu_power_average_watts{%s}`, nf))
			if pwr == nil {
				pwr, _ = queryProm(fmt.Sprintf(`DCGM_FI_DEV_POWER_USAGE{%s}`, nf))
			}

			mu.Lock()
			nodeResults[node] = &nodeMetrics{
				utilization: util,
				vramPct:     vramPct,
				temperature: temp,
				power:       pwr,
			}
			mu.Unlock()
		}(node)
	}
	wg.Wait()

	// Build response entries
	models := make([]modelGPUEntry, 0, len(targets))
	for _, t := range targets {
		entry := modelGPUEntry{
			ModelID:   t.modelID,
			ModelName: t.modelName,
			Node:      t.node,
		}
		if nm, ok := nodeResults[t.node]; ok {
			entry.GPUUtilization = nm.utilization
			entry.VRAMUsedPct = nm.vramPct
			entry.Temperature = nm.temperature
			entry.Power = nm.power
		}
		models = append(models, entry)
	}

	return map[string]any{"models": models}, nil
}

// K8sEventsSSE implements Server-Sent Events for real-time K8s events streaming.
// It watches Kubernetes events (warnings, normal events, etc.) and streams them to the client.
func (h *Handler) K8sEventsSSE(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	// Get optional filters
	ns := r.URL.Query().Get("ns")
	fieldSelector := r.URL.Query().Get("fieldSelector")

	// Create cancellable context
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Start events watcher
	eventsChan, err := h.k8s.WatchEvents(ctx, ns, fieldSelector)
	if err != nil {
		log.Printf("Failed to watch events: %v", err)
		fmt.Fprintf(w, "event: error\ndata: {\"error\":\"Failed to watch events\"}\n\n")
		flusher.Flush()
		return
	}

	// Send ready event
	fmt.Fprintf(w, "event: ready\ndata: {\"ok\":true}\n\n")
	flusher.Flush()

	// Handle client disconnect
	done := make(chan struct{})
	go func() {
		<-r.Context().Done()
		close(done)
		cancel()
	}()

	// Stream events to client
	for {
		select {
		case <-done:
			return
		case event, ok := <-eventsChan:
			if !ok {
				return
			}

			data, err := json.Marshal(event)
			if err != nil {
				log.Printf("Failed to marshal event: %v", err)
				continue
			}

			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.ObjectType, data)
			flusher.Flush()
		}
	}
}

// K8sWatchSSE implements Server-Sent Events for real-time K8s resource streaming.
// It watches nodes, pods, and services and streams changes to the client.
func (h *Handler) K8sWatchSSE(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	// Get optional namespace filter
	ns := r.URL.Query().Get("ns")

	// Create cancellable context
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Start watchers
	nodeEvents, err := h.k8s.WatchNodes(ctx)
	if err != nil {
		log.Printf("Failed to watch nodes: %v", err)
		fmt.Fprintf(w, "event: error\ndata: {\"error\":\"Failed to watch nodes\"}\n\n")
		flusher.Flush()
		return
	}

	podEvents, err := h.k8s.WatchPods(ctx, ns)
	if err != nil {
		log.Printf("Failed to watch pods: %v", err)
		fmt.Fprintf(w, "event: error\ndata: {\"error\":\"Failed to watch pods\"}\n\n")
		flusher.Flush()
		return
	}

	serviceEvents, err := h.k8s.WatchServices(ctx, ns)
	if err != nil {
		log.Printf("Failed to watch services: %v", err)
		fmt.Fprintf(w, "event: error\ndata: {\"error\":\"Failed to watch services\"}\n\n")
		flusher.Flush()
		return
	}

	// Send ready event
	fmt.Fprintf(w, "event: ready\ndata: {\"ok\":true}\n\n")
	flusher.Flush()

	// Merge all event channels
	merged := make(chan k8s.WatchEvent, 100)
	var wg sync.WaitGroup
	wg.Add(3)

	go func() {
		defer wg.Done()
		for event := range nodeEvents {
			merged <- event
		}
	}()

	go func() {
		defer wg.Done()
		for event := range podEvents {
			merged <- event
		}
	}()

	go func() {
		defer wg.Done()
		for event := range serviceEvents {
			merged <- event
		}
	}()

	// Close merged channel when all watchers are done
	go func() {
		wg.Wait()
		close(merged)
	}()

	// Handle client disconnect
	done := make(chan struct{})
	go func() {
		<-r.Context().Done()
		close(done)
		cancel()
	}()

	// Stream events to client
	for {
		select {
		case <-done:
			return
		case event, ok := <-merged:
			if !ok {
				return
			}

			data, err := json.Marshal(event)
			if err != nil {
				log.Printf("Failed to marshal event: %v", err)
				continue
			}

			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event.ObjectType, data)
			flusher.Flush()
		}
	}
}

// K8sPVCs returns PersistentVolumeClaims
func (h *Handler) K8sPVCs(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	cacheKey := fmt.Sprintf("k8s:pvcs:%s", ns)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), cacheKey, 30*time.Second, func() (any, error) {
			return h.k8s.GetPVCs(r.Context(), ns)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	pvcs, err := h.k8s.GetPVCs(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pvcs)
}

// K8sPVs returns PersistentVolumes
func (h *Handler) K8sPVs(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), "k8s:pvs", 30*time.Second, func() (any, error) {
			return h.k8s.GetPVs(r.Context())
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	pvs, err := h.k8s.GetPVs(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(pvs)
}

// K8sStorageClasses returns StorageClasses
func (h *Handler) K8sStorageClasses(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), "k8s:storageclasses", 60*time.Second, func() (any, error) {
			return h.k8s.GetStorageClasses(r.Context())
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	scs, err := h.k8s.GetStorageClasses(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(scs)
}

// K8sConfigMaps returns ConfigMaps (keys only, no data values)
func (h *Handler) K8sConfigMaps(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	cacheKey := fmt.Sprintf("k8s:configmaps:%s", ns)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), cacheKey, 30*time.Second, func() (any, error) {
			return h.fetchConfigMapsList(r.Context(), ns)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	result, err := h.fetchConfigMapsList(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) fetchConfigMapsList(ctx context.Context, ns string) ([]map[string]any, error) {
	cms, err := h.k8s.GetConfigMaps(ctx, ns)
	if err != nil {
		return nil, err
	}

	result := make([]map[string]any, 0, len(cms.Items))
	for _, cm := range cms.Items {
		keys := make([]string, 0, len(cm.Data))
		for k := range cm.Data {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		result = append(result, map[string]any{
			"name":      cm.Name,
			"namespace": cm.Namespace,
			"keys":      keys,
			"keyCount":  len(cm.Data),
			"age":       cm.CreationTimestamp.Format("2006-01-02T15:04:05Z"),
		})
	}
	return result, nil
}

// K8sConfigMapDetail returns full ConfigMap data
func (h *Handler) K8sConfigMapDetail(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	cm, err := h.k8s.GetConfigMap(r.Context(), ns, name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"name":      cm.Name,
		"namespace": cm.Namespace,
		"data":      cm.Data,
	})
}

// K8sSecrets returns Secrets (keys only, no values)
func (h *Handler) K8sSecrets(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := r.URL.Query().Get("ns")
	cacheKey := fmt.Sprintf("k8s:secrets:%s", ns)
	if h.cache != nil {
		cached, err := h.cache.GetOrFetch(r.Context(), cacheKey, 30*time.Second, func() (any, error) {
			return h.fetchSecretsList(r.Context(), ns)
		})
		if err == nil {
			w.Header().Set("Content-Type", "application/json")
			w.Write(cached)
			return
		}
	}

	result, err := h.fetchSecretsList(r.Context(), ns)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handler) fetchSecretsList(ctx context.Context, ns string) ([]map[string]any, error) {
	secrets, err := h.k8s.GetSecrets(ctx, ns)
	if err != nil {
		return nil, err
	}

	result := make([]map[string]any, 0, len(secrets.Items))
	for _, s := range secrets.Items {
		keys := make([]string, 0, len(s.Data))
		for k := range s.Data {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		result = append(result, map[string]any{
			"name":      s.Name,
			"namespace": s.Namespace,
			"type":      string(s.Type),
			"keys":      keys,
			"keyCount":  len(s.Data),
			"age":       s.CreationTimestamp.Format("2006-01-02T15:04:05Z"),
		})
	}
	return result, nil
}

// K8sSecretDetail returns Secret data (base64-encoded values)
func (h *Handler) K8sSecretDetail(w http.ResponseWriter, r *http.Request) {
	if h.k8s == nil {
		http.Error(w, "k8s disabled", http.StatusServiceUnavailable)
		return
	}

	ns := chi.URLParam(r, "ns")
	name := chi.URLParam(r, "name")

	secret, err := h.k8s.GetSecret(r.Context(), ns, name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}

	// K8s client returns decoded []byte — re-encode to base64 for the API response
	data := make(map[string]string, len(secret.Data))
	for k, v := range secret.Data {
		data[k] = base64.StdEncoding.EncodeToString(v)
	}

	respondJSON(w, http.StatusOK, map[string]any{
		"name":      secret.Name,
		"namespace": secret.Namespace,
		"type":      string(secret.Type),
		"data":      data,
	})
}
