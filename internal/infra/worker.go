package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kunstructured "k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"

	"github.com/flexinfer/flexdeck/internal/cache"
	"github.com/flexinfer/flexdeck/internal/config"
	"github.com/flexinfer/flexdeck/internal/k8s"
	"github.com/prometheus/client_golang/prometheus"
)

const (
	snapshotKey = "infra:snapshot"
	snapshotTTL = 90 * time.Second
)

// Worker is the InfraCacheWorker — a background goroutine that proactively
// pre-warms the Redis infra snapshot on a regular schedule when cache backing
// is available. It can still build snapshots in-memory without Redis.
type Worker struct {
	k8s   *k8s.Client
	cache *cache.Cache
	prom  *promClient
	cfg   *config.Config

	mu       sync.RWMutex
	compute  ComputeSnapshot
	storage  StorageSnapshot
	network  NetworkingSnapshot
	gitops   GitOpsSnapshot
	capacity CapacitySnapshot
}

// NewWorker creates an InfraCacheWorker.
func NewWorker(k8sClient *k8s.Client, c *cache.Cache, cfg *config.Config) *Worker {
	w := &Worker{
		k8s:   k8sClient,
		cache: c,
		cfg:   cfg,
	}
	if !cfg.Prom.Disabled && cfg.Prom.URL != "" {
		w.prom = newPromClient(cfg.Prom.URL)
	}
	return w
}

// Start launches all background tickers and blocks until ctx is cancelled.
func (w *Worker) Start(ctx context.Context) {
	slog.Info("infra cache worker started")

	// Warm all caches immediately on startup.
	w.runCompute(ctx)
	w.runStorage(ctx)
	w.runNetwork(ctx)
	w.runGitOps(ctx)
	w.runCapacity(ctx)
	w.mergeAndStore(ctx)

	computeTick := time.NewTicker(15 * time.Second)
	storageTick := time.NewTicker(30 * time.Second)
	networkTick := time.NewTicker(30 * time.Second)
	gitopsTick := time.NewTicker(30 * time.Second)
	capacityTick := time.NewTicker(60 * time.Second)
	mergeTick := time.NewTicker(30 * time.Second)
	defer computeTick.Stop()
	defer storageTick.Stop()
	defer networkTick.Stop()
	defer gitopsTick.Stop()
	defer capacityTick.Stop()
	defer mergeTick.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("infra cache worker stopped")
			return
		case <-computeTick.C:
			w.runCompute(ctx)
		case <-storageTick.C:
			w.runStorage(ctx)
		case <-networkTick.C:
			w.runNetwork(ctx)
		case <-gitopsTick.C:
			w.runGitOps(ctx)
		case <-capacityTick.C:
			w.runCapacity(ctx)
		case <-mergeTick.C:
			w.mergeAndStore(ctx)
		}
	}
}

// BuildSnapshot synchronously builds a full snapshot. Used as HTTP handler fallback
// when the worker has not yet written to Redis.
func (w *Worker) BuildSnapshot(ctx context.Context) (*InfraSnapshot, error) {
	w.runCompute(ctx)
	w.runStorage(ctx)
	w.runNetwork(ctx)
	w.runGitOps(ctx)
	w.runCapacity(ctx)

	w.mu.RLock()
	snap := w.assembleSnapshot()
	w.mu.RUnlock()
	return &snap, nil
}

// assembleSnapshot merges all sub-snapshots into a full InfraSnapshot.
// Must be called with w.mu held (at least RLock).
func (w *Worker) assembleSnapshot() InfraSnapshot {
	return InfraSnapshot{
		Compute:     w.compute,
		Storage:     w.storage,
		Networking:  w.network,
		GitOps:      w.gitops,
		Capacity:    w.capacity,
		LastUpdated: time.Now().UnixMilli(),
	}
}

// mergeAndStore assembles all sub-snapshots and writes infra:snapshot to Redis.
func (w *Worker) mergeAndStore(ctx context.Context) {
	if w.cache == nil {
		return
	}

	w.mu.RLock()
	snap := w.assembleSnapshot()
	w.mu.RUnlock()

	data, err := json.Marshal(snap)
	if err != nil {
		slog.Warn("infra worker: marshal snapshot", "error", err)
		return
	}
	w.cache.Set(ctx, snapshotKey, data, snapshotTTL)
}

// ---- Compute ticker ----

func (w *Worker) runCompute(ctx context.Context) {
	timer := prometheus.NewTimer(InfraSnapshotDuration.WithLabelValues("compute"))
	defer timer.ObserveDuration()

	nodeList, err := w.k8s.GetNodes(ctx)
	if err != nil {
		slog.Warn("infra worker: get nodes", "error", err)
		InfraSnapshotErrors.WithLabelValues("compute").Inc()
		return
	}
	podList, err := w.k8s.GetPods(ctx, "")
	if err != nil {
		slog.Warn("infra worker: get pods", "error", err)
		return
	}

	// Count pods per node.
	podCounts := make(map[string]int, len(nodeList.Items))
	runningPods := 0
	for i := range podList.Items {
		p := &podList.Items[i]
		podCounts[p.Spec.NodeName]++
		if p.Status.Phase == corev1.PodRunning {
			runningPods++
		}
	}

	// Fetch Prometheus CPU/Mem/GPU metrics (best-effort).
	cpuByNode := map[string]float64{}
	memByNode := map[string]float64{}
	gpuVramPctByNode := map[string]float64{}
	gpuVramUsedByNode := map[string]int64{}
	gpuVramTotalByNode := map[string]int64{}

	if w.prom != nil {
		// node-exporter in the kube-prometheus-stack chart exposes `instance=<pod_ip>:9100`
		// with no node/nodename label, so `instance` cannot be mapped back to a K8s node
		// directly. Join through kube_pod_info (deduped per-pod) to pull the real `node`
		// label, then aggregate on it. Harvester's own job carries `node` natively but is
		// scraped separately and not displayed on this page.
		cpuByNode = w.queryNodeMetric(ctx,
			`100 - (avg by (node) (rate(node_cpu_seconds_total{mode="idle"}[2m]) * on (namespace, pod) group_left(node) (avg by (namespace, pod, node) (kube_pod_info))) * 100)`,
			"node")
		memByNode = w.queryNodeMetric(ctx,
			`avg by (node) ((1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * on (namespace, pod) group_left(node) (avg by (namespace, pod, node) (kube_pod_info))) * 100`,
			"node")

		if gpuPct, err := w.prom.QueryInstant(ctx, `amdgpu_vram_used_bytes / amdgpu_vram_total_bytes * 100`); err == nil {
			for _, s := range gpuPct {
				node := s.Metric["kubernetes_node"]
				if node == "" {
					node = stripPort(s.Metric["instance"])
				}
				gpuVramPctByNode[node] = s.Value
			}
		}
		if gpuUsed, err := w.prom.QueryInstant(ctx, `amdgpu_vram_used_bytes`); err == nil {
			for _, s := range gpuUsed {
				node := s.Metric["kubernetes_node"]
				if node == "" {
					node = stripPort(s.Metric["instance"])
				}
				gpuVramUsedByNode[node] = int64(s.Value / (1024 * 1024))
			}
		}
		if gpuTotal, err := w.prom.QueryInstant(ctx, `amdgpu_vram_total_bytes`); err == nil {
			for _, s := range gpuTotal {
				node := s.Metric["kubernetes_node"]
				if node == "" {
					node = stripPort(s.Metric["instance"])
				}
				gpuVramTotalByNode[node] = int64(s.Value / (1024 * 1024))
			}
		}
	}

	nodes := make([]NodeInfo, 0, len(nodeList.Items))
	readyNodes := 0
	var cpuSum, memSum float64
	var gpuPctSum float64
	gpuNodeCount := 0

	for i := range nodeList.Items {
		n := &nodeList.Items[i]
		status := "NotReady"
		var conditions []NodeCondition
		for _, c := range n.Status.Conditions {
			if c.Type == "Ready" && c.Status == "True" {
				status = "Ready"
				readyNodes++
			}
			conditions = append(conditions, NodeCondition{
				Type:    string(c.Type),
				Status:  string(c.Status),
				Message: c.Message,
			})
		}

		roles := extractNodeRoles(n.Labels)

		var memCapMi int64
		if memQ, ok := n.Status.Capacity[corev1.ResourceMemory]; ok {
			memCapMi = memQ.Value() / (1024 * 1024)
		}

		// Match Prometheus instance label to node by name, then by internal IP.
		cpuPct := cpuByNode[n.Name]
		memPct := memByNode[n.Name]
		gpuPct := gpuVramPctByNode[n.Name]
		for _, addr := range n.Status.Addresses {
			if addr.Type == "InternalIP" {
				ip := addr.Address
				if cpuPct == 0 {
					if v, ok := cpuByNode[ip]; ok {
						cpuPct = v
					}
				}
				if memPct == 0 {
					if v, ok := memByNode[ip]; ok {
						memPct = v
					}
				}
				if gpuPct == 0 {
					if v, ok := gpuVramPctByNode[ip]; ok {
						gpuPct = v
					}
				}
			}
		}

		cpuSum += cpuPct
		memSum += memPct
		if gpuPct > 0 {
			gpuPctSum += gpuPct
			gpuNodeCount++
		}

		nodes = append(nodes, NodeInfo{
			Name:           n.Name,
			Status:         status,
			Roles:          roles,
			Labels:         n.Labels,
			Conditions:     conditions,
			MemCapacityMi:  memCapMi,
			CpuPct:         cpuPct,
			MemPct:         memPct,
			GpuVramPct:     gpuPct,
			GpuVramUsedMi:  gpuVramUsedByNode[n.Name],
			GpuVramTotalMi: gpuVramTotalByNode[n.Name],
			PodCount:       podCounts[n.Name],
		})
	}

	// Detect OOMKilled containers across all pods.
	var oomKilledPods []OOMKilledPod
	for i := range podList.Items {
		p := &podList.Items[i]
		for _, cs := range p.Status.ContainerStatuses {
			if cs.LastTerminationState.Terminated != nil &&
				cs.LastTerminationState.Terminated.Reason == "OOMKilled" {
				lastOOM := ""
				if !cs.LastTerminationState.Terminated.FinishedAt.IsZero() {
					lastOOM = cs.LastTerminationState.Terminated.FinishedAt.Format(time.RFC3339)
				}
				oomKilledPods = append(oomKilledPods, OOMKilledPod{
					Name:         p.Name,
					Namespace:    p.Namespace,
					Container:    cs.Name,
					RestartCount: cs.RestartCount,
					LastOOM:      lastOOM,
					NodeName:     p.Spec.NodeName,
				})
			}
		}
	}

	total := float64(len(nodeList.Items))
	var clusterCPU, clusterMem, clusterGPU float64
	if total > 0 {
		clusterCPU = cpuSum / total
		clusterMem = memSum / total
	}
	if gpuNodeCount > 0 {
		clusterGPU = gpuPctSum / float64(gpuNodeCount)
	}

	snap := ComputeSnapshot{
		Nodes:          nodes,
		ClusterCpuPct:  clusterCPU,
		ClusterMemPct:  clusterMem,
		GpuVramPct:     clusterGPU,
		TotalNodes:     len(nodeList.Items),
		ReadyNodes:     readyNodes,
		TotalPods:      len(podList.Items),
		RunningPods:    runningPods,
		OOMKilledPods:  oomKilledPods,
		OOMKilledCount: len(oomKilledPods),
	}
	w.mu.Lock()
	w.compute = snap
	w.mu.Unlock()
}

// ---- Storage ticker ----

func (w *Worker) runStorage(ctx context.Context) {
	timer := prometheus.NewTimer(InfraSnapshotDuration.WithLabelValues("storage"))
	defer timer.ObserveDuration()

	pvcList, err := w.k8s.GetPVCs(ctx, "")
	if err != nil {
		slog.Warn("infra worker: get pvcs", "error", err)
		InfraSnapshotErrors.WithLabelValues("storage").Inc()
		return
	}

	// Fetch Longhorn metrics (best-effort).
	longhornActual := map[string]int64{}
	longhornRobust := map[string]string{}
	if w.prom != nil {
		if samples, err := w.prom.QueryInstant(ctx, `longhorn_volume_actual_size_bytes`); err == nil {
			for _, s := range samples {
				if vol := s.Metric["volume"]; vol != "" {
					longhornActual[vol] = int64(s.Value)
				}
			}
		}
		if samples, err := w.prom.QueryInstant(ctx, `longhorn_volume_robustness`); err == nil {
			for _, s := range samples {
				if vol := s.Metric["volume"]; vol != "" {
					longhornRobust[vol] = s.Metric["robustness"]
				}
			}
		}
	}

	pvcs := make([]PVCInfo, 0, len(pvcList.Items))
	var totalGi, usedGi float64
	degraded := 0

	for i := range pvcList.Items {
		pvc := &pvcList.Items[i]
		capStr := ""
		capGi := 0.0
		if req, ok := pvc.Spec.Resources.Requests[corev1.ResourceStorage]; ok {
			capStr = req.String()
			capGi = float64(req.Value()) / (1024 * 1024 * 1024)
			totalGi += capGi
		}

		volName := pvc.Spec.VolumeName
		robustness := longhornRobust[volName]
		if robustness == "" {
			robustness = longhornRobust[pvc.Name]
		}
		if robustness == "degraded" || robustness == "faulted" {
			degraded++
		}
		actualBytes := longhornActual[volName]
		if actualBytes == 0 {
			actualBytes = longhornActual[pvc.Name]
		}
		usedGi += float64(actualBytes) / (1024 * 1024 * 1024)

		sc := ""
		if pvc.Spec.StorageClassName != nil {
			sc = *pvc.Spec.StorageClassName
		}
		pvcs = append(pvcs, PVCInfo{
			Name:                pvc.Name,
			Namespace:           pvc.Namespace,
			StorageClass:        sc,
			Capacity:            capStr,
			CapacityGi:          capGi,
			Phase:               string(pvc.Status.Phase),
			VolumeName:          volName,
			LonghornActualBytes: actualBytes,
			LonghornRobustness:  robustness,
		})
	}

	snap := StorageSnapshot{
		PVCs:            pvcs,
		TotalCapacityGi: totalGi,
		UsedCapacityGi:  usedGi,
		DegradedVolumes: degraded,
		TotalVolumes:    len(pvcList.Items),
	}
	w.mu.Lock()
	w.storage = snap
	w.mu.Unlock()
}

// ---- Network ticker ----

func (w *Worker) runNetwork(ctx context.Context) {
	timer := prometheus.NewTimer(InfraSnapshotDuration.WithLabelValues("network"))
	defer timer.ObserveDuration()

	ingressList, err := w.k8s.GetIngresses(ctx, "")
	if err != nil {
		slog.Warn("infra worker: get ingresses", "error", err)
		InfraSnapshotErrors.WithLabelValues("network").Inc()
		return
	}
	npList, err := w.k8s.GetNetworkPolicies(ctx, "")
	if err != nil {
		slog.Warn("infra worker: get network policies", "error", err)
		return
	}
	podList, err := w.k8s.GetPods(ctx, "")
	if err != nil {
		slog.Warn("infra worker: get pods (network)", "error", err)
		return
	}

	// Namespaces that have at least one NetworkPolicy.
	coveredNs := make(map[string]bool, len(npList.Items))
	for i := range npList.Items {
		coveredNs[npList.Items[i].Namespace] = true
	}

	// Identify pod namespaces with no network policy.
	podNs := make(map[string]bool)
	for i := range podList.Items {
		podNs[podList.Items[i].Namespace] = true
	}
	var policyGaps []string
	for ns := range podNs {
		if !coveredNs[ns] {
			policyGaps = append(policyGaps, ns)
		}
	}
	sort.Strings(policyGaps)

	// Fetch nginx metrics (best-effort).
	rpsMap := map[string]float64{}
	p95Map := map[string]float64{}
	p99Map := map[string]float64{}
	errRateMap := map[string]float64{}

	if w.prom != nil {
		if samples, err := w.prom.QueryInstant(ctx,
			`sum by (ingress,namespace) (rate(nginx_ingress_controller_requests[5m]))`); err == nil {
			for _, s := range samples {
				rpsMap[ingressKey(s.Metric["namespace"], s.Metric["ingress"])] += s.Value
			}
		}
		if samples, err := w.prom.QueryInstant(ctx,
			`histogram_quantile(0.95, sum by (ingress,namespace,le) (rate(nginx_ingress_controller_request_duration_seconds_bucket[5m]))) * 1000`); err == nil {
			for _, s := range samples {
				p95Map[ingressKey(s.Metric["namespace"], s.Metric["ingress"])] = s.Value
			}
		}
		if samples, err := w.prom.QueryInstant(ctx,
			`histogram_quantile(0.99, sum by (ingress,namespace,le) (rate(nginx_ingress_controller_request_duration_seconds_bucket[5m]))) * 1000`); err == nil {
			for _, s := range samples {
				p99Map[ingressKey(s.Metric["namespace"], s.Metric["ingress"])] = s.Value
			}
		}
		if samples, err := w.prom.QueryInstant(ctx,
			`sum by (ingress,namespace) (rate(nginx_ingress_controller_requests{status=~"5.."}[5m])) / sum by (ingress,namespace) (rate(nginx_ingress_controller_requests[5m]))`); err == nil {
			for _, s := range samples {
				errRateMap[ingressKey(s.Metric["namespace"], s.Metric["ingress"])] = s.Value
			}
		}
	}

	ingresses := make([]IngressInfo, 0, len(ingressList.Items))
	var totalRps, p99Sum, errSum float64
	p99Count, errCount := 0, 0

	for i := range ingressList.Items {
		ing := &ingressList.Items[i]
		var hosts []string
		for _, rule := range ing.Spec.Rules {
			if rule.Host != "" {
				hosts = append(hosts, rule.Host)
			}
		}
		key := ingressKey(ing.Namespace, ing.Name)
		rps := rpsMap[key]
		p99 := p99Map[key]
		er := errRateMap[key]
		totalRps += rps
		if p99 > 0 {
			p99Sum += p99
			p99Count++
		}
		if er > 0 {
			errSum += er
			errCount++
		}
		ingresses = append(ingresses, IngressInfo{
			Name:      ing.Name,
			Namespace: ing.Namespace,
			Hosts:     hosts,
			Rps:       rps,
			P95Ms:     p95Map[key],
			P99Ms:     p99,
			ErrorRate: er,
		})
	}

	var avgP99, avgErr float64
	if p99Count > 0 {
		avgP99 = p99Sum / float64(p99Count)
	}
	if errCount > 0 {
		avgErr = errSum / float64(errCount)
	}

	snap := NetworkingSnapshot{
		Ingresses:  ingresses,
		PolicyGaps: policyGaps,
		TotalRps:   totalRps,
		P99Ms:      avgP99,
		ErrorRate:  avgErr,
	}
	w.mu.Lock()
	w.network = snap
	w.mu.Unlock()
}

// ---- GitOps ticker ----

var (
	ksGVR = schema.GroupVersionResource{Group: "kustomize.toolkit.fluxcd.io", Version: "v1", Resource: "kustomizations"}
	hrGVR = schema.GroupVersionResource{Group: "helm.toolkit.fluxcd.io", Version: "v2", Resource: "helmreleases"}
	grGVR = schema.GroupVersionResource{Group: "source.toolkit.fluxcd.io", Version: "v1", Resource: "gitrepositories"}
	reGVR = schema.GroupVersionResource{Group: "source.toolkit.fluxcd.io", Version: "v1", Resource: "helmrepositories"}
)

func (w *Worker) runGitOps(ctx context.Context) {
	timer := prometheus.NewTimer(InfraSnapshotDuration.WithLabelValues("gitops"))
	defer timer.ObserveDuration()

	dynClient, err := dynamic.NewForConfig(w.k8s.Config())
	if err != nil {
		slog.Warn("infra worker: dynamic client", "error", err)
		InfraSnapshotErrors.WithLabelValues("gitops").Inc()
		return
	}

	ksList, _ := dynClient.Resource(ksGVR).Namespace("").List(ctx, metav1.ListOptions{})
	hrList, _ := dynClient.Resource(hrGVR).Namespace("").List(ctx, metav1.ListOptions{})
	grList, _ := dynClient.Resource(grGVR).Namespace("").List(ctx, metav1.ListOptions{})
	reList, _ := dynClient.Resource(reGVR).Namespace("").List(ctx, metav1.ListOptions{})

	// Fetch gotk reconcile duration from Prometheus (best-effort).
	reconcileLag := map[string]float64{}
	if w.prom != nil {
		if samples, err := w.prom.QueryInstant(ctx, `gotk_reconcile_duration_seconds`); err == nil {
			for _, s := range samples {
				key := fmt.Sprintf("%s/%s/%s", s.Metric["kind"], s.Metric["namespace"], s.Metric["name"])
				reconcileLag[key] = s.Value
			}
		}
	}

	var kustomizations, helmReleases []FluxResourceInfo
	driftCount, suspendedCount := 0, 0
	maxLag := 0.0

	if ksList != nil {
		for i := range ksList.Items {
			info := extractFluxResourceInfo(&ksList.Items[i], "Kustomization")
			lagKey := fmt.Sprintf("Kustomization/%s/%s", info.Namespace, info.Name)
			info.ReconcileLagSecs = reconcileLag[lagKey]
			if info.ReconcileLagSecs > maxLag {
				maxLag = info.ReconcileLagSecs
			}
			if !info.Ready && !info.Suspended {
				driftCount++
			}
			if info.Suspended {
				suspendedCount++
			}
			kustomizations = append(kustomizations, info)
		}
	}
	if hrList != nil {
		for i := range hrList.Items {
			info := extractFluxResourceInfo(&hrList.Items[i], "HelmRelease")
			lagKey := fmt.Sprintf("HelmRelease/%s/%s", info.Namespace, info.Name)
			info.ReconcileLagSecs = reconcileLag[lagKey]
			if info.ReconcileLagSecs > maxLag {
				maxLag = info.ReconcileLagSecs
			}
			if !info.Ready && !info.Suspended {
				driftCount++
			}
			if info.Suspended {
				suspendedCount++
			}
			helmReleases = append(helmReleases, info)
		}
	}

	var sources []FluxSourceInfo
	appendSources := func(list *kunstructured.UnstructuredList, kind string) {
		if list == nil {
			return
		}
		for i := range list.Items {
			item := &list.Items[i]
			ready := fluxItemReady(item)
			u, _, _ := kunstructured.NestedString(item.Object, "spec", "url")
			sources = append(sources, FluxSourceInfo{
				Name:      item.GetName(),
				Namespace: item.GetNamespace(),
				Kind:      kind,
				Ready:     ready,
				URL:       u,
			})
		}
	}
	appendSources(grList, "GitRepository")
	appendSources(reList, "HelmRepository")

	snap := GitOpsSnapshot{
		Kustomizations:      kustomizations,
		HelmReleases:        helmReleases,
		Sources:             sources,
		DriftCount:          driftCount,
		SuspendedCount:      suspendedCount,
		MaxReconcileLagSecs: maxLag,
	}
	w.mu.Lock()
	w.gitops = snap
	w.mu.Unlock()
}

// ---- Capacity ticker ----

func (w *Worker) runCapacity(ctx context.Context) {
	timer := prometheus.NewTimer(InfraSnapshotDuration.WithLabelValues("capacity"))
	defer timer.ObserveDuration()

	if w.prom == nil {
		return
	}

	end := time.Now()
	start := end.Add(-24 * time.Hour)

	// Disk availability (percent free) over 24h for trend.
	diskSeries, _ := w.prom.QueryRange(ctx,
		`node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} * 100`,
		start, end, "5m")

	// Current disk usage per node.
	diskNow, _ := w.prom.QueryInstant(ctx,
		`(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100`)
	diskByNode := map[string]float64{}
	for _, s := range diskNow {
		diskByNode[stripPort(s.Metric["instance"])] = s.Value
	}

	// Memory actual/requested per namespace.
	memActualSamples, _ := w.prom.QueryInstant(ctx,
		`sum by (namespace) (container_memory_working_set_bytes{container!=""})`)
	memReqSamples, _ := w.prom.QueryInstant(ctx,
		`sum by (namespace) (kube_pod_container_resource_requests{resource="memory"})`)
	cpuActualSamples, _ := w.prom.QueryInstant(ctx,
		`sum by (namespace) (rate(container_cpu_usage_seconds_total{container!=""}[5m])) * 1000`)
	cpuReqSamples, _ := w.prom.QueryInstant(ctx,
		`sum by (namespace) (kube_pod_container_resource_requests{resource="cpu"}) * 1000`)

	// Build pressure items from disk trends.
	var pressureItems []PressureItem
	for _, s := range diskSeries {
		if len(s.Timestamps) < 2 {
			continue
		}
		// Invert "% free" → "% used".
		usedYs := make([]float64, len(s.Values))
		for i, v := range s.Values {
			usedYs[i] = 100 - v
		}
		node := stripPort(s.Metric["instance"])
		eta := TimeToSaturation(s.Timestamps, usedYs, 90)
		currentDisk := diskByNode[node]
		slope, _ := linearRegression(s.Timestamps, usedYs)
		trend := "stable"
		if slope > 0.0001 {
			trend = "up"
		} else if slope < -0.0001 {
			trend = "down"
		}
		if currentDisk > 60 || trend == "up" {
			pressureItems = append(pressureItems, PressureItem{
				Resource:        "disk",
				Node:            node,
				Pct:             currentDisk,
				TrendDirection:  trend,
				EtaSaturateSecs: eta,
			})
		}
	}

	// Hot nodes summary (reuse from compute).
	w.mu.RLock()
	currentNodes := w.compute.Nodes
	w.mu.RUnlock()
	hotNodes := make([]HotNodeInfo, 0, len(currentNodes))
	for _, n := range currentNodes {
		hotNodes = append(hotNodes, HotNodeInfo{
			Name:    n.Name,
			CpuPct:  n.CpuPct,
			MemPct:  n.MemPct,
			DiskPct: diskByNode[n.Name],
		})
	}
	sort.Slice(hotNodes, func(i, j int) bool {
		return hotNodes[i].CpuPct+hotNodes[i].MemPct > hotNodes[j].CpuPct+hotNodes[j].MemPct
	})

	// Namespace efficiency.
	nsMemActual := map[string]float64{}
	nsMemReq := map[string]float64{}
	nsCpuActual := map[string]float64{}
	nsCpuReq := map[string]float64{}
	for _, s := range memActualSamples {
		nsMemActual[s.Metric["namespace"]] += s.Value / (1024 * 1024)
	}
	for _, s := range memReqSamples {
		nsMemReq[s.Metric["namespace"]] += s.Value / (1024 * 1024)
	}
	for _, s := range cpuActualSamples {
		nsCpuActual[s.Metric["namespace"]] += s.Value
	}
	for _, s := range cpuReqSamples {
		nsCpuReq[s.Metric["namespace"]] += s.Value
	}

	nsSet := make(map[string]bool)
	for ns := range nsMemReq {
		nsSet[ns] = true
	}
	for ns := range nsCpuReq {
		nsSet[ns] = true
	}
	efficiencyByNs := make([]NsEfficiency, 0, len(nsSet))
	for ns := range nsSet {
		efficiencyByNs = append(efficiencyByNs, NsEfficiency{
			Namespace:      ns,
			CpuRequested:   nsCpuReq[ns],
			CpuActual:      nsCpuActual[ns],
			MemRequestedMi: nsMemReq[ns],
			MemActualMi:    nsMemActual[ns],
		})
	}
	sort.Slice(efficiencyByNs, func(i, j int) bool {
		return efficiencyByNs[i].Namespace < efficiencyByNs[j].Namespace
	})

	snap := CapacitySnapshot{
		HotNodes:       hotNodes,
		PressureItems:  pressureItems,
		EfficiencyByNs: efficiencyByNs,
	}
	w.mu.Lock()
	w.capacity = snap
	w.mu.Unlock()
}

// ---- helpers ----

// queryNodeMetric fetches an instant query and returns a map of stripped node id → value.
func (w *Worker) queryNodeMetric(ctx context.Context, query, labelKey string) map[string]float64 {
	samples, err := w.prom.QueryInstant(ctx, query)
	if err != nil {
		return map[string]float64{}
	}
	out := make(map[string]float64, len(samples))
	for _, s := range samples {
		key := s.Metric[labelKey]
		if labelKey == "instance" {
			key = stripPort(key)
		}
		out[key] = s.Value
	}
	return out
}

// stripPort removes :port from an IP or hostname label (e.g. "10.0.0.1:9100" → "10.0.0.1").
func stripPort(s string) string {
	if idx := strings.LastIndex(s, ":"); idx > 0 {
		return s[:idx]
	}
	return s
}

func ingressKey(ns, name string) string {
	return url.QueryEscape(ns) + "/" + url.QueryEscape(name)
}

func extractNodeRoles(labels map[string]string) []string {
	var roles []string
	for k := range labels {
		if strings.HasPrefix(k, "node-role.kubernetes.io/") {
			roles = append(roles, strings.TrimPrefix(k, "node-role.kubernetes.io/"))
		}
	}
	sort.Strings(roles)
	return roles
}

// extractFluxResourceInfo reads common Flux resource fields from an unstructured object.
func extractFluxResourceInfo(obj *kunstructured.Unstructured, kind string) FluxResourceInfo {
	info := FluxResourceInfo{
		Name:      obj.GetName(),
		Namespace: obj.GetNamespace(),
		Kind:      kind,
	}

	info.Suspended, _, _ = kunstructured.NestedBool(obj.Object, "spec", "suspend")

	if srcRef, found, _ := kunstructured.NestedMap(obj.Object, "spec", "sourceRef"); found {
		sr := &FluxSourceRef{}
		sr.Kind, _, _ = kunstructured.NestedString(srcRef, "kind")
		sr.Name, _, _ = kunstructured.NestedString(srcRef, "name")
		sr.Namespace, _, _ = kunstructured.NestedString(srcRef, "namespace")
		if sr.Kind != "" || sr.Name != "" {
			info.SourceRef = sr
		}
	}

	if conds, found, _ := kunstructured.NestedSlice(obj.Object, "status", "conditions"); found {
		for _, c := range conds {
			cond, ok := c.(map[string]interface{})
			if !ok {
				continue
			}
			t, _, _ := kunstructured.NestedString(cond, "type")
			status, _, _ := kunstructured.NestedString(cond, "status")
			msg, _, _ := kunstructured.NestedString(cond, "message")
			ltt, _, _ := kunstructured.NestedString(cond, "lastTransitionTime")
			if t == "Ready" {
				info.Ready = status == "True"
				info.Message = msg
				info.LastApplied = ltt
			}
		}
	}

	return info
}

// fluxItemReady returns true if the unstructured Flux object has Ready=True.
func fluxItemReady(obj *kunstructured.Unstructured) bool {
	conds, _, _ := kunstructured.NestedSlice(obj.Object, "status", "conditions")
	for _, c := range conds {
		cond, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		t, _, _ := kunstructured.NestedString(cond, "type")
		s, _, _ := kunstructured.NestedString(cond, "status")
		if t == "Ready" {
			return s == "True"
		}
	}
	return false
}
