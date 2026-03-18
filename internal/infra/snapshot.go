package infra

// InfraSnapshot is the merged full-cluster state snapshot written to Redis by the worker.
type InfraSnapshot struct {
	Compute     ComputeSnapshot    `json:"compute"`
	Storage     StorageSnapshot    `json:"storage"`
	Networking  NetworkingSnapshot `json:"networking"`
	GitOps      GitOpsSnapshot     `json:"gitops"`
	Capacity    CapacitySnapshot   `json:"capacity"`
	LastUpdated int64              `json:"lastUpdated"` // unix millis
}

// --- Compute ---

// ComputeSnapshot holds per-node resource utilization and cluster-level KPIs.
type ComputeSnapshot struct {
	Nodes         []NodeInfo `json:"nodes"`
	ClusterCpuPct float64    `json:"clusterCpuPct"`
	ClusterMemPct float64    `json:"clusterMemPct"`
	GpuVramPct    float64    `json:"gpuVramPct"`
	TotalNodes    int        `json:"totalNodes"`
	ReadyNodes    int        `json:"readyNodes"`
	TotalPods     int        `json:"totalPods"`
	RunningPods   int        `json:"runningPods"`
}

// NodeInfo describes a single cluster node with live Prometheus metrics.
type NodeInfo struct {
	Name           string            `json:"name"`
	Status         string            `json:"status"` // "Ready" | "NotReady"
	Roles          []string          `json:"roles"`
	Labels         map[string]string `json:"labels,omitempty"`
	MemCapacityMi  int64             `json:"memCapacityMi"`
	CpuPct         float64           `json:"cpuPct"`
	MemPct         float64           `json:"memPct"`
	GpuVramPct     float64           `json:"gpuVramPct"`
	GpuVramUsedMi  int64             `json:"gpuVramUsedMi"`
	GpuVramTotalMi int64             `json:"gpuVramTotalMi"`
	PodCount       int               `json:"podCount"`
}

// --- Storage ---

// StorageSnapshot holds PVC/PV state and Longhorn volume health.
type StorageSnapshot struct {
	PVCs            []PVCInfo `json:"pvcs"`
	TotalCapacityGi float64   `json:"totalCapacityGi"`
	UsedCapacityGi  float64   `json:"usedCapacityGi"`
	DegradedVolumes int       `json:"degradedVolumes"`
	TotalVolumes    int       `json:"totalVolumes"`
}

// PVCInfo describes a single PersistentVolumeClaim.
type PVCInfo struct {
	Name                string  `json:"name"`
	Namespace           string  `json:"namespace"`
	StorageClass        string  `json:"storageClass,omitempty"`
	Capacity            string  `json:"capacity,omitempty"`
	CapacityGi          float64 `json:"capacityGi"`
	Phase               string  `json:"phase"`
	VolumeName          string  `json:"volumeName,omitempty"`
	LonghornActualBytes int64   `json:"longhornActualBytes"`
	LonghornRobustness  string  `json:"longhornRobustness,omitempty"` // healthy, degraded, faulted
}

// --- Networking ---

// NetworkingSnapshot holds ingress traffic metrics and network policy gaps.
type NetworkingSnapshot struct {
	Ingresses  []IngressInfo `json:"ingresses"`
	PolicyGaps []string      `json:"policyGaps"` // namespaces with no NetworkPolicy
	TotalRps   float64       `json:"totalRps"`
	P99Ms      float64       `json:"p99Ms"`
	ErrorRate  float64       `json:"errorRate"`
}

// IngressInfo describes a single Ingress with live nginx metrics.
type IngressInfo struct {
	Name      string   `json:"name"`
	Namespace string   `json:"namespace"`
	Hosts     []string `json:"hosts"`
	Rps       float64  `json:"rps"`
	P95Ms     float64  `json:"p95Ms"`
	P99Ms     float64  `json:"p99Ms"`
	ErrorRate float64  `json:"errorRate"`
}

// --- GitOps ---

// GitOpsSnapshot holds Flux reconciliation state and metrics.
type GitOpsSnapshot struct {
	Kustomizations      []FluxResourceInfo `json:"kustomizations"`
	HelmReleases        []FluxResourceInfo `json:"helmReleases"`
	Sources             []FluxSourceInfo   `json:"sources"`
	DriftCount          int                `json:"driftCount"`
	SuspendedCount      int                `json:"suspendedCount"`
	MaxReconcileLagSecs float64            `json:"maxReconcileLagSecs"`
}

// FluxResourceInfo describes a Flux Kustomization or HelmRelease.
type FluxResourceInfo struct {
	Name             string         `json:"name"`
	Namespace        string         `json:"namespace"`
	Kind             string         `json:"kind"`
	Ready            bool           `json:"ready"`
	Suspended        bool           `json:"suspended"`
	Message          string         `json:"message,omitempty"`
	LastApplied      string         `json:"lastApplied,omitempty"`
	ReconcileLagSecs float64        `json:"reconcileLagSecs"`
	SourceRef        *FluxSourceRef `json:"sourceRef,omitempty"`
}

// FluxSourceRef references the source of a Flux resource.
type FluxSourceRef struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace,omitempty"`
}

// FluxSourceInfo describes a Flux source (GitRepository, HelmRepository).
type FluxSourceInfo struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Kind      string `json:"kind"`
	Ready     bool   `json:"ready"`
	URL       string `json:"url,omitempty"`
}

// --- Capacity ---

// CapacitySnapshot holds saturation estimates derived from 24h Prometheus range queries.
type CapacitySnapshot struct {
	HotNodes       []HotNodeInfo  `json:"hotNodes"`
	PressureItems  []PressureItem `json:"pressureItems"`
	EfficiencyByNs []NsEfficiency `json:"efficiencyByNs"`
}

// HotNodeInfo is a concise saturation summary per node.
type HotNodeInfo struct {
	Name    string  `json:"name"`
	CpuPct  float64 `json:"cpuPct"`
	MemPct  float64 `json:"memPct"`
	DiskPct float64 `json:"diskPct"`
}

// PressureItem represents a trending resource with an estimated time-to-saturation.
type PressureItem struct {
	Resource        string  `json:"resource"` // "cpu" | "memory" | "disk" | "gpu"
	Node            string  `json:"node"`
	Pct             float64 `json:"pct"`
	TrendDirection  string  `json:"trendDirection"`  // "up" | "down" | "stable"
	EtaSaturateSecs float64 `json:"etaSaturateSecs"` // -1 if not converging
}

// NsEfficiency shows requested vs. actual resource usage per namespace.
type NsEfficiency struct {
	Namespace      string  `json:"namespace"`
	CpuRequested   float64 `json:"cpuRequested"` // millicores
	CpuActual      float64 `json:"cpuActual"`    // millicores
	MemRequestedMi float64 `json:"memRequestedMi"`
	MemActualMi    float64 `json:"memActualMi"`
}
